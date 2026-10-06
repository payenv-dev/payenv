import {
  type Capability,
  type CollectRequest,
  type Connector,
  type CountryCode,
  type MobileMoneyNetwork,
  PayenvError,
  type PayenvErrorCode,
  type PaymentStatus,
  type PayoutRequest,
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

/**
 * FedaPay payout modes (verified on live payouts in Benin). They differ from the
 * collection slugs: MTN is `mtn` here, `mtn_open` for collections.
 */
export const DEFAULT_PAYOUT_OPERATORS: FedaPayOperators = {
  BJ: { mtn: 'mtn', moov: 'moov', celtiis: 'sbin' },
};

/** Sandbox payout modes, by analogy with collections (to verify: see QUIRKS.md). */
export const DEFAULT_SANDBOX_PAYOUT_OPERATORS: FedaPayOperators = {
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
  /**
   * Payout modes to expose, per country. Defaults to {@link DEFAULT_PAYOUT_OPERATORS} in
   * live mode and {@link DEFAULT_SANDBOX_PAYOUT_OPERATORS} in the sandbox. Pass `{}` to
   * disable payouts. Payouts must be enabled on your FedaPay account.
   */
  payoutOperators?: FedaPayOperators;
  /** Connector id used in routing and payments. Defaults to `fedapay`. */
  id?: string;
  /** Custom `fetch`, e.g. for tests or proxies. Defaults to the global `fetch`. */
  fetch?: typeof fetch;
}

const BASE_URLS: Record<FedaPayEnvironment, string> = {
  sandbox: 'https://sandbox-api.fedapay.com/v1',
  live: 'https://api.fedapay.com/v1',
};

/**
 * Steps of a collection (create → token → push) and of a payout (payout → send).
 * Money can only move once `push` or `send` is reached.
 */
type Step = 'create' | 'token' | 'push' | 'payout' | 'send' | 'status';

const BEFORE_MONEY: ReadonlySet<Step> = new Set(['create', 'token', 'payout']);

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
  const payoutOperators =
    options.payoutOperators ??
    (environment === 'live' ? DEFAULT_PAYOUT_OPERATORS : DEFAULT_SANDBOX_PAYOUT_OPERATORS);
  const doFetch = options.fetch ?? globalThis.fetch;

  const routes = (operation: 'collect' | 'payout', table: FedaPayOperators): Capability[] =>
    Object.entries(table).map(([country, networks]) => ({
      operation,
      method: 'mobile_money',
      currencies: ['XOF'],
      countries: [country],
      networks: Object.keys(networks),
    }));
  const capabilities = [...routes('collect', operators), ...routes('payout', payoutOperators)];

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
    // Before the push (or the payout send), money cannot move.
    const beforeMoney = BEFORE_MONEY.has(step);

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

    async payout(request, context): Promise<ProviderResult> {
      const { recipient } = request;
      const mode = payoutOperators[recipient.country]?.[recipient.network];
      if (!mode) {
        throw new PayenvError(
          'ROUTE_UNSUPPORTED',
          `FedaPay payout mode not configured for ${recipient.network} / ${recipient.country}`,
          { connectorId: id },
        );
      }

      // 1. Create the payout. Nothing is sent yet.
      let payoutId: string;
      try {
        const data = await call(
          'payout',
          'POST',
          '/payouts',
          context.signal,
          payoutBody(request, mode),
        );
        const payout = unwrap(data, 'payout');
        if (payout.id === undefined || payout.id === null) {
          throw new PayenvError('PROVIDER_UNAVAILABLE', 'FedaPay returned no payout id', {
            connectorId: id,
            raw: data,
          });
        }
        payoutId = String(payout.id);
      } catch (thrown) {
        throw toError('payout', thrown);
      }
      context.reportProviderRef(payoutId);

      // 2. Start it. From here on, money may leave the merchant's balance.
      try {
        const data = await call('send', 'PUT', '/payouts/start', context.signal, {
          payouts: [{ id: payoutId }],
        });
        return { status: 'pending', providerRef: payoutId, raw: data };
      } catch (thrown) {
        const error = toError('send', thrown);
        if (error.retryClass !== 'ambiguous') throw error;
        return { status: 'unknown', providerRef: payoutId, error, raw: error.raw };
      }
    },

    async getStatus(query, context): Promise<StatusResult> {
      if (query.providerRef === undefined) {
        // Without the transaction id we cannot prove anything: stay ambiguous.
        throw new PayenvError('UNKNOWN_ERROR', 'FedaPay status lookup needs the transaction id', {
          connectorId: id,
        });
      }
      const resource = query.operation === 'payout' ? 'payout' : 'transaction';
      let data: Json;
      try {
        data = await call('status', 'GET', `/${resource}s/${query.providerRef}`, context.signal);
      } catch (thrown) {
        throw toError('status', thrown);
      }
      const { status, error } =
        resource === 'payout'
          ? payoutStatus(unwrap(data, 'payout'), id)
          : transactionStatus(unwrap(data, 'transaction'), id);
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

function payoutBody(request: PayoutRequest, mode: string): Json {
  const { customer, recipient, amount } = request;
  const fedapayCustomer: Json = {
    // The money is sent to this phone number.
    phone_number: { number: recipient.phone, country: recipient.country },
  };
  if (customer?.firstName) fedapayCustomer.firstname = customer.firstName;
  if (customer?.lastName) fedapayCustomer.lastname = customer.lastName;
  if (customer?.email) fedapayCustomer.email = customer.email;
  return {
    amount: amount.value,
    currency: { iso: amount.currency },
    mode,
    customer: fedapayCustomer,
    ...(request.description ? { description: request.description } : {}),
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
  const providerCode = errorCode(lastErrorCode);
  const reason = (fallback: PayenvErrorCode, what: string) =>
    failure('transaction', what, fallback, lastErrorCode, lastErrorMessage, connectorId);

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

/** Maps a FedaPay payout to a Payenv status. Statuses to verify: see QUIRKS.md. */
export function payoutStatus(
  payout: Json,
  connectorId: string,
): { status: PaymentStatus; error?: PayenvError } {
  const { status, last_error_code: lastErrorCode, last_error_message: lastErrorMessage } = payout;
  const reason = (fallback: PayenvErrorCode, what: string) =>
    failure('payout', what, fallback, lastErrorCode, lastErrorMessage, connectorId);
  switch (status) {
    case 'sent':
      return { status: 'succeeded' };
    // Created, scheduled or being processed: never guessed as failed.
    case 'pending':
    case 'scheduled':
    case 'started':
    case 'processing':
      return { status: 'pending' };
    case 'failed':
    case 'declined':
      return { status: 'failed', error: reason('UNKNOWN_ERROR', String(status)) };
    case 'canceled':
      return { status: 'canceled', error: reason('UNKNOWN_ERROR', 'canceled') };
    default:
      return { status: 'unknown' };
  }
}

function errorCode(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** A failure reason: FedaPay's own code when it gives one, a sensible default otherwise. */
function failure(
  resource: 'transaction' | 'payout',
  what: string,
  fallback: PayenvErrorCode,
  lastErrorCode: unknown,
  lastErrorMessage: unknown,
  connectorId: string,
): PayenvError {
  const providerCode = errorCode(lastErrorCode);
  const code = (providerCode ? FEDAPAY_ERROR_CODES[providerCode] : undefined) ?? fallback;
  const detail = providerCode
    ? ` — ${FEDAPAY_ERROR_MESSAGES[providerCode] ?? 'FedaPay error'} (${providerCode})`
    : '';
  // Reported after the fact: never a reason to try another provider automatically.
  return new PayenvError(code, `FedaPay ${resource} ${what}${detail}`, {
    connectorId,
    retryClass: 'do_not_retry',
    ...(providerCode ? { providerCode } : {}),
    // Raw operator output (often a SOAP dump): kept for debugging, never serialized.
    raw: { last_error_code: lastErrorCode, last_error_message: lastErrorMessage },
  });
}

function httpCode(
  error: FedaPayHttpError,
  beforeMoney: boolean,
): { code: PayenvErrorCode; retryClass?: 'safe_to_fallback' | 'do_not_retry' | 'ambiguous' } {
  const { status } = error;
  const message = (providerMessage(error.body) ?? '').toLowerCase();

  // "Opération non autorisée" (also sent with HTTP 403): the operator, or payouts, are not
  // enabled on the merchant account. Another provider may serve it.
  if (status < 500 && (message.includes('non autoris') || message.includes('not authorized'))) {
    return { code: 'ROUTE_UNSUPPORTED' };
  }
  if (status === 401 || status === 403) return { code: 'AUTHENTICATION_FAILED' };
  if (status === 429) return { code: 'RATE_LIMITED' };
  if (status >= 500) {
    return beforeMoney ? { code: 'PROVIDER_UNAVAILABLE' } : { code: 'NETWORK_ERROR' };
  }
  // 4xx: the request was rejected, nothing was processed.
  if (
    (error.step === 'payout' || error.step === 'send') &&
    (message.includes('solde insuffisant') || message.includes('insufficient balance'))
  ) {
    // The merchant's FedaPay balance: another provider's balance may suffice.
    return { code: 'INSUFFICIENT_BALANCE' };
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
