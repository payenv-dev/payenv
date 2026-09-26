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

export interface FedaPayOptions {
  /** Secret API key (sandbox or live). Keep it in an environment variable. */
  secretKey: string;
  /** Defaults to `sandbox`. */
  environment?: FedaPayEnvironment;
  /**
   * Operators to expose, per country. Defaults to {@link DEFAULT_OPERATORS}. Only list
   * operators activated on your FedaPay merchant account (Dashboard → Payment methods).
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

type Json = Record<string, unknown>;

export function fedapay(options: FedaPayOptions): Connector {
  if (!options.secretKey) {
    throw new PayenvError('INVALID_REQUEST', 'FedaPay secretKey is required');
  }
  const id = options.id ?? 'fedapay';
  const baseUrl = BASE_URLS[options.environment ?? 'sandbox'];
  const operators = options.operators ?? DEFAULT_OPERATORS;
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
      const { status, error } = transactionStatus(transaction.status, id);
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

function transactionStatus(
  status: unknown,
  connectorId: string,
): { status: PaymentStatus; error?: PayenvError } {
  switch (status) {
    case 'pending':
      return { status: 'pending' };
    case 'approved':
    case 'transferred':
    case 'refunded':
      return { status: 'succeeded' };
    case 'declined':
      return {
        status: 'failed',
        error: new PayenvError('CUSTOMER_DECLINED', 'FedaPay transaction declined', {
          connectorId,
        }),
      };
    case 'canceled':
      return {
        status: 'canceled',
        error: new PayenvError('CUSTOMER_DECLINED', 'FedaPay transaction canceled', {
          connectorId,
        }),
      };
    case 'expired':
      return {
        status: 'expired',
        error: new PayenvError('CUSTOMER_TIMEOUT', 'FedaPay transaction expired', { connectorId }),
      };
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
