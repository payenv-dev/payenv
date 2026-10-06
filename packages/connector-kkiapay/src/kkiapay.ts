import {
  type Capability,
  type Connector,
  type CountryCode,
  type MobileMoneyNetwork,
  PayenvError,
  type PayenvErrorCode,
  type PaymentStatus,
  type ProviderResult,
  type StatusResult,
} from '@payenv/core';

export type KkiapayEnvironment = 'sandbox' | 'live';

/** Mobile money networks to expose, per country. */
export type KkiapayRoutes = Readonly<Record<CountryCode, readonly MobileMoneyNetwork[]>>;

/** Networks with Kkiapay sandbox test numbers in Benin. Add others with the `routes` option. */
export const DEFAULT_ROUTES: KkiapayRoutes = { BJ: ['mtn', 'moov'] };

export interface KkiapayOptions {
  /** Public API key. Sent to the front end to open the widget. */
  publicKey: string;
  /** Private API key. Server-side only. */
  privateKey: string;
  /** Secret API key. Server-side only. */
  secretKey: string;
  /** Defaults to `sandbox`. */
  environment?: KkiapayEnvironment;
  /** Defaults to {@link DEFAULT_ROUTES}. */
  routes?: KkiapayRoutes;
  /** Connector id used in routing and payments. Defaults to `kkiapay`. */
  id?: string;
  /** Custom `fetch`, e.g. for tests or proxies. Defaults to the global `fetch`. */
  fetch?: typeof fetch;
}

/** The widget name to list in `supportedWidgets` when the front end can open Kkiapay. */
export const KKIAPAY_WIDGET = 'kkiapay';

const BASE_URLS: Record<KkiapayEnvironment, string> = {
  sandbox: 'https://api-sandbox.kkiapay.me',
  live: 'https://api.kkiapay.me',
};

export type Json = Record<string, unknown>;

/**
 * Kkiapay connector.
 *
 * Kkiapay payments start in its widget, in the customer's browser or app: `collect`
 * returns a `widget` next action with everything the front end needs. Once the widget
 * reports a transaction id, call `payenv.confirm(idempotencyKey, transactionId)`: the
 * transaction is verified server-side with your private keys.
 *
 * The widget's `partnerId` is set to the payment's idempotency key, so Kkiapay webhooks
 * can be matched to payments directly.
 */
export function kkiapay(options: KkiapayOptions): Connector {
  for (const key of ['publicKey', 'privateKey', 'secretKey'] as const) {
    if (!options[key]) throw new PayenvError('INVALID_REQUEST', `Kkiapay ${key} is required`);
  }
  const id = options.id ?? 'kkiapay';
  const environment = options.environment ?? 'sandbox';
  const baseUrl = BASE_URLS[environment];
  const routes = options.routes ?? DEFAULT_ROUTES;
  const doFetch = options.fetch ?? globalThis.fetch;

  const capabilities: Capability[] = Object.entries(routes).map(([country, networks]) => ({
    operation: 'collect',
    method: 'mobile_money',
    currencies: ['XOF'],
    countries: [country],
    networks,
    widget: KKIAPAY_WIDGET,
  }));

  return {
    id,
    capabilities: () => capabilities,

    async collect(request): Promise<ProviderResult> {
      const { method, customer } = request;
      if (method.type !== 'mobile_money') {
        throw new PayenvError('ROUTE_UNSUPPORTED', 'Kkiapay connector only supports mobile money', {
          connectorId: id,
        });
      }
      const name = [customer?.firstName, customer?.lastName].filter(Boolean).join(' ');
      // Nothing is sent to Kkiapay here: the customer starts the payment in the widget.
      return {
        status: 'requires_action',
        merchantReference: request.idempotencyKey,
        nextAction: {
          type: 'widget',
          provider: KKIAPAY_WIDGET,
          params: {
            key: options.publicKey,
            amount: request.amount.value,
            sandbox: environment === 'sandbox',
            partnerId: request.idempotencyKey,
            phone: method.phone.replace(/^\+/, ''),
            paymentmethod: 'momo',
            countries: [method.country],
            ...(name ? { name } : {}),
            ...(customer?.email ? { email: customer.email } : {}),
          },
        },
      };
    },

    async getStatus(query, context): Promise<StatusResult> {
      if (query.providerRef === undefined) {
        // Kkiapay transactions can only be looked up by their id.
        throw new PayenvError('UNKNOWN_ERROR', 'Kkiapay status lookup needs the transaction id', {
          connectorId: id,
        });
      }
      let response: Response;
      try {
        response = await doFetch(`${baseUrl}/api/v1/transactions/status`, {
          method: 'POST',
          signal: context.signal,
          headers: {
            'x-api-key': options.publicKey,
            'x-private-key': options.privateKey,
            'x-secret-key': options.secretKey,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({ transactionId: query.providerRef }),
        });
      } catch (thrown) {
        throw new PayenvError('NETWORK_ERROR', 'Kkiapay status lookup failed', {
          connectorId: id,
          cause: thrown,
        });
      }
      const data = await readJson(response);
      // Verified in the sandbox: HTTP 400 with { "status": "TRANSACTION_NOT_FOUND" }.
      // Only this explicit answer counts as "not found", whatever the HTTP status.
      if (data.status === 'TRANSACTION_NOT_FOUND') return { found: false, raw: data };
      if (!response.ok) {
        throw new PayenvError(
          response.status === 401 || response.status === 403
            ? 'AUTHENTICATION_FAILED'
            : 'PROVIDER_UNAVAILABLE',
          `Kkiapay status lookup failed with HTTP ${response.status}`,
          { connectorId: id, raw: data },
        );
      }
      return toStatusResult(data, query.providerRef, id);
    },
  };
}

/** Maps a Kkiapay transaction (status lookup or webhook) to a Payenv status result. */
export function toStatusResult(
  transaction: Json,
  providerRef: string,
  connectorId: string,
): StatusResult {
  const { status, error } = transactionStatus(transaction, connectorId);
  const partnerId = transaction.partnerId;
  const amount = transaction.amount;
  return {
    found: true,
    status,
    providerRef,
    ...(typeof partnerId === 'string' && partnerId !== '' ? { merchantReference: partnerId } : {}),
    ...(typeof amount === 'number' ? { amount: { value: amount, currency: 'XOF' } } : {}),
    ...(error ? { error } : {}),
    raw: transaction,
  };
}

/** Kkiapay `failureCode` values (sandbox scenarios and documentation), mapped to Payenv codes. */
const FAILURE_CODES: Readonly<Record<string, PayenvErrorCode>> = {
  insufficient_fund: 'INSUFFICIENT_FUNDS',
  payment_declined: 'CUSTOMER_DECLINED',
  card_declined: 'CUSTOMER_DECLINED',
  card_fraudulent: 'FRAUD_SUSPECTED',
  processing_error: 'UNKNOWN_ERROR',
  transaction_error: 'UNKNOWN_ERROR',
};

function transactionStatus(
  transaction: Json,
  connectorId: string,
): { status: PaymentStatus; error?: PayenvError } {
  const status = typeof transaction.status === 'string' ? transaction.status.toUpperCase() : '';
  switch (status) {
    case 'SUCCESS':
      return { status: 'succeeded' };
    case 'PENDING':
      return { status: 'pending' };
    case 'FAILED': {
      const failureCode =
        typeof transaction.failureCode === 'string' && transaction.failureCode !== ''
          ? transaction.failureCode
          : undefined;
      const failureMessage =
        typeof transaction.failureMessage === 'string' ? transaction.failureMessage : undefined;
      const code = (failureCode ? FAILURE_CODES[failureCode] : undefined) ?? 'CUSTOMER_DECLINED';
      return {
        status: 'failed',
        error: new PayenvError(
          code,
          `Kkiapay transaction failed${failureMessage ? ` — ${failureMessage}` : ''}${
            failureCode ? ` (${failureCode})` : ''
          }`,
          {
            connectorId,
            // The customer was involved: another provider would not change the outcome.
            retryClass: 'do_not_retry',
            ...(failureCode ? { providerCode: failureCode } : {}),
          },
        ),
      };
    }
    default:
      return { status: 'unknown' };
  }
}

async function readJson(response: Response): Promise<Json> {
  const text = await response.text();
  try {
    const data: unknown = text ? JSON.parse(text) : {};
    return data !== null && typeof data === 'object' ? (data as Json) : { value: data };
  } catch {
    return { raw: text };
  }
}
