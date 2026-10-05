import {
  type Capability,
  type CollectRequest,
  type Connector,
  type CountryCode,
  type MobileMoneyNetwork,
  PayenvError,
  type PayenvErrorCode,
  type PaymentStatus,
  type ProviderResult,
  type StatusResult,
} from '@payenv/core';

export type FedaPayEnvironment = 'sandbox' | 'live';

/** FedaPay collection slugs, per country and Payenv network. */
export type FedaPayOperators = Readonly<
  Record<CountryCode, Readonly<Partial<Record<MobileMoneyNetwork, string>>>>
>;

/**
 * Operators verified against the live API (Benin).
 * Other countries can be added with the `operators` option.
 */
export const DEFAULT_OPERATORS: FedaPayOperators = {
  BJ: { mtn: 'mtn_open', moov: 'moov', celtiis: 'sbin' },
};

/**
 * The FedaPay sandbox no longer has per-operator test servers: every push goes to the
 * single `momo_test` mode. Test numbers 64000001 and 66000001 succeed; any other
 * number simulates a failed payment.
 */
export const DEFAULT_SANDBOX_OPERATORS: FedaPayOperators = {
  BJ: { mtn: 'momo_test', moov: 'momo_test', celtiis: 'momo_test' },
};

export interface FedaPayOptions {
  /** Secret API key (sandbox or live). Keep it in an environment variable. */
  secretKey: string;
  /** Defaults to `sandbox`. */
  environment?: FedaPayEnvironment;
  /**
   * Operators to expose, per country. Defaults to {@link DEFAULT_OPERATORS} in live mode
   * and {@link DEFAULT_SANDBOX_OPERATORS} in the sandbox. Only list operators activated
   * on your FedaPay merchant account (Dashboard → Payment methods).
   */
  operators?: FedaPayOperators;
  /** Connector id used in routing and payments. Defaults to `fedapay`. */
  id?: string;
  /** Custom `fetch`, e.g. for tests or proxies. Defaults to the global `fetch`. */
  fetch?: typeof fetch;
}

const BASE_URLS: Record<FedaPayEnvironment, string> = {
  sandbox: 'https://sandbox-api.fedapay.com/v1',
  live: 'https://api.fedapay.com/v1',
};

/** Steps of a collection. Money can only move once the `push` step is reached. */
type Step = 'create' | 'token' | 'push' | 'status';

class FedaPayHttpError extends Error {
  constructor(
    readonly step: Step,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`FedaPay ${step} failed with HTTP ${status}: ${providerMessage(body) ?? 'no message'}`);
  }
}

export type Json = Record<string, unknown>;

export function fedapay(options: FedaPayOptions): Connector {
  if (!options.secretKey) {
    throw new PayenvError('INVALID_REQUEST', 'FedaPay secretKey is required');
  }
  const id = options.id ?? 'fedapay';
  const environment = options.environment ?? 'sandbox';
  const baseUrl = BASE_URLS[environment];
  const operators =
    options.operators ?? (environment === 'live' ? DEFAULT_OPERATORS : DEFAULT_SANDBOX_OPERATORS);
  const doFetch = options.fetch ?? globalThis.fetch;

  const capabilities: Capability[] = Object.entries(operators).map(([country, networks]) => ({
    operation: 'collect',
    method: 'mobile_money',
    currencies: ['XOF'],
    countries: [country],
    networks: Object.keys(networks),
  }));

  async function call(step: Step, method: string, path: string, signal: AbortSignal, body?: Json) {
    const init: RequestInit = {
      method,
      signal,
      headers: {
        Authorization: `Bearer ${options.secretKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    };
    if (body !== undefined) init.body = JSON.stringify(body);
    const response = await doFetch(`${baseUrl}${path}`, init);
    const text = await response.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }
    if (!response.ok) throw new FedaPayHttpError(step, response.status, data);
    return (data ?? {}) as Json;
  }

  function toError(step: Step, thrown: unknown): PayenvError {
    if (thrown instanceof PayenvError) return thrown;
    // Before the push, no customer prompt exists: money cannot move.
    const beforeMoney = step === 'create' || step === 'token';

    if (thrown instanceof FedaPayHttpError) {
      const code = httpCode(thrown, beforeMoney);
      return new PayenvError(code.code, thrown.message, {
        connectorId: id,
        raw: thrown.body,
        ...(code.retryClass ? { retryClass: code.retryClass } : {}),
      });
    }
    const message = thrown instanceof Error ? thrown.message : String(thrown);
    return beforeMoney
      ? new PayenvError('PROVIDER_UNAVAILABLE', `FedaPay unreachable (${step}): ${message}`, {
          connectorId: id,
          cause: thrown,
        })
      : new PayenvError('NETWORK_ERROR', `FedaPay ${step} did not complete: ${message}`, {
          connectorId: id,
          cause: thrown,
        });
  }

  return {
    id,
    capabilities: () => capabilities,

    async collect(request, context): Promise<ProviderResult> {
      const { method } = request;
      if (method.type !== 'mobile_money') {
        throw new PayenvError('ROUTE_UNSUPPORTED', 'FedaPay connector only supports mobile money', {
          connectorId: id,
        });
      }
      const operator = operators[method.country]?.[method.network];
      if (!operator) {
        throw new PayenvError(
          'ROUTE_UNSUPPORTED',
          `FedaPay operator not configured for ${method.network} / ${method.country}`,
          { connectorId: id },
        );
      }

      // 1. Create the transaction. No customer prompt exists yet.
      let transactionId: string;
      try {
        const data = await call(
          'create',
          'POST',
          '/transactions',
          context.signal,
          transactionBody(request, context.reference),
        );
        const transaction = unwrap(data, 'transaction');
        if (transaction.id === undefined || transaction.id === null) {
          throw new PayenvError('PROVIDER_UNAVAILABLE', 'FedaPay returned no transaction id', {
            connectorId: id,
            raw: data,
          });
        }
        transactionId = String(transaction.id);
      } catch (thrown) {
        throw toError('create', thrown);
      }
      context.reportProviderRef(transactionId);

      // 2. Get a payment token for the transaction.
      let token: string;
      try {
        const data = await call(
          'token',
          'POST',
          `/transactions/${transactionId}/token`,
          context.signal,
          {},
        );
        if (typeof data.token !== 'string' || data.token === '') {
          throw new PayenvError('PROVIDER_UNAVAILABLE', 'FedaPay returned no payment token', {
            connectorId: id,
          });
        }
        token = data.token;
      } catch (thrown) {
        throw toError('token', thrown);
      }

      // 3. Send the mobile money push. From here on, money may move.
      try {
        const data = await call('push', 'POST', `/${operator}`, context.signal, { token });
        const intent = unwrap(data, 'payment_intent');
        return {
          status: pushStatus(intent.status),
          providerRef: transactionId,
          nextAction: { type: 'customer_confirmation', channel: 'ussd' },
          raw: data,
        };
      } catch (thrown) {
        const error = toError('push', thrown);
        if (error.retryClass !== 'ambiguous') throw error;
        return { status: 'unknown', providerRef: transactionId, error, raw: error.raw };
      }
    },

    async getStatus(query, context): Promise<StatusResult> {
      if (query.providerRef === undefined) {
        // Without the transaction id we cannot prove anything: stay ambiguous.
        throw new PayenvError('UNKNOWN_ERROR', 'FedaPay status lookup needs the transaction id', {
          connectorId: id,
        });
      }
      let data: Json;
      try {
        data = await call('status', 'GET', `/transactions/${query.providerRef}`, context.signal);
      } catch (thrown) {
        throw toError('status', thrown);
      }
      const transaction = unwrap(data, 'transaction');
      const { status, error } = transactionStatus(transaction, id);
      return {
        found: true,
        status,
        providerRef: query.providerRef,
        ...(error ? { error } : {}),
        raw: data,
      };
    },
  };
}

function transactionBody(request: CollectRequest, reference: string): Json {
  const { customer, method, amount } = request;
  const body: Json = {
    description: request.description ?? `Payment ${reference}`,
    amount: amount.value,
    currency: { iso: amount.currency },
  };
  const fedapayCustomer: Json = {};
  if (customer?.firstName) fedapayCustomer.firstname = customer.firstName;
  if (customer?.lastName) fedapayCustomer.lastname = customer.lastName;
  if (customer?.email) fedapayCustomer.email = customer.email;
  if (method.type === 'mobile_money') {
    // The push is sent to the phone number stored on the transaction's customer.
    fedapayCustomer.phone_number = { number: method.phone, country: method.country };
  }
  body.customer = fedapayCustomer;
  return body;
}

/** FedaPay wraps resources under `v1/<name>`, sometimes `<name>`, sometimes not at all. */
function unwrap(data: Json, name: string): Json {
  const wrapped = data[`v1/${name}`] ?? data[name];
  return wrapped !== null && typeof wrapped === 'object' ? (wrapped as Json) : data;
}

function pushStatus(status: unknown): PaymentStatus {
  if (status === 'approved' || status === 'transferred') return 'succeeded';
  // The customer still has to confirm with their PIN.
  return 'pending';
}

/**
 * FedaPay `last_error_code` values observed on live transactions, mapped to Payenv codes.
 * Unmapped codes are still exposed as `providerCode`.
 */
const FEDAPAY_ERROR_CODES: Readonly<Record<string, PayenvErrorCode>> = {
  INSUFFICIENT_FUND_ERROR: 'INSUFFICIENT_FUNDS',
  // Seen live: FedaPay queried the operator, which still answered "Initiated".
  // It means "no final status from the operator", not that a service is down.
  API_ERROR: 'UNKNOWN_ERROR',
};

const FEDAPAY_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  // MTN's own reason is LOW_BALANCE_OR_PAYEE_LIMIT_REACHED_OR_NOT_ALLOWED.
  INSUFFICIENT_FUND_ERROR: 'Insufficient funds, or an operator limit was reached',
  API_ERROR: 'FedaPay could not get a final status from the operator',
};

/** Maps a FedaPay transaction (API response or webhook entity) to a Payenv status. */
export function transactionStatus(
  transaction: Json,
  connectorId: string,
): { status: PaymentStatus; error?: PayenvError } {
  const {
    status,
    last_error_code: lastErrorCode,
    last_error_message: lastErrorMessage,
  } = transaction;
  const providerCode =
    typeof lastErrorCode === 'string' && lastErrorCode !== '' ? lastErrorCode : undefined;

  /** The failure reason: FedaPay's own code when it gives one, a sensible default otherwise. */
  const reason = (fallback: PayenvErrorCode, what: string) => {
    const code = (providerCode ? FEDAPAY_ERROR_CODES[providerCode] : undefined) ?? fallback;
    const detail = providerCode
      ? ` — ${FEDAPAY_ERROR_MESSAGES[providerCode] ?? 'FedaPay error'} (${providerCode})`
      : '';
    // The customer was involved: another provider would not change the outcome.
    return new PayenvError(code, `FedaPay transaction ${what}${detail}`, {
      connectorId,
      retryClass: 'do_not_retry',
      ...(providerCode ? { providerCode } : {}),
      // Raw operator output (often a SOAP dump): kept for debugging, never serialized.
      raw: { last_error_code: lastErrorCode, last_error_message: lastErrorMessage },
    });
  };

  switch (status) {
    case 'pending':
      // FedaPay may record an error while keeping the transaction pending (seen live:
      // the customer canceled the USSD prompt on Celtiis, the operator still answered
      // "Initiated"). The status stays pending (never guessed) and the reason is exposed.
      // FedaPay schedules an expiration job for pending transactions.
      return providerCode
        ? { status: 'pending', error: reason('UNKNOWN_ERROR', 'still pending after an error') }
        : { status: 'pending' };
    case 'approved':
    case 'transferred':
    case 'refunded':
      return { status: 'succeeded' };
    case 'declined':
      return { status: 'failed', error: reason('CUSTOMER_DECLINED', 'declined') };
    case 'canceled':
      return { status: 'canceled', error: reason('CUSTOMER_DECLINED', 'canceled') };
    case 'expired':
      return { status: 'expired', error: reason('CUSTOMER_TIMEOUT', 'expired') };
    default:
      return { status: 'unknown' };
  }
}

function httpCode(
  error: FedaPayHttpError,
  beforeMoney: boolean,
): { code: PayenvErrorCode; retryClass?: 'safe_to_fallback' | 'do_not_retry' | 'ambiguous' } {
  const { status } = error;
  const message = (providerMessage(error.body) ?? '').toLowerCase();

  if (status === 401 || status === 403) return { code: 'AUTHENTICATION_FAILED' };
  if (status === 429) return { code: 'RATE_LIMITED' };
  if (status >= 500) {
    return beforeMoney ? { code: 'PROVIDER_UNAVAILABLE' } : { code: 'NETWORK_ERROR' };
  }
  // 4xx: the request was rejected, nothing was processed.
  if (message.includes('non autoris') || message.includes('not authorized')) {
    // Operator not activated on the merchant account: another provider may serve it.
    return { code: 'ROUTE_UNSUPPORTED' };
  }
  if (status === 404 && error.step === 'status') {
    // Not authoritative enough to claim "no money moved".
    return { code: 'UNKNOWN_ERROR' };
  }
  return { code: 'INVALID_REQUEST' };
}

function providerMessage(body: unknown): string | undefined {
  if (body === null || typeof body !== 'object') return undefined;
  const { message, error } = body as Json;
  if (typeof message === 'string') return message;
  if (typeof error === 'string') return error;
  return undefined;
}
