/**
 * How the attempt engine may react to an error.
 *
 * - `safe_to_fallback` — the provider rejected the request before any money moved;
 *   another connector may be tried.
 * - `do_not_retry` — the outcome would be the same with another provider
 *   (customer declined, insufficient funds, invalid request…).
 * - `ambiguous` — the provider may have processed the request. Payenv must check
 *   the status with the same provider before doing anything else.
 */
export type RetryClass = 'safe_to_fallback' | 'do_not_retry' | 'ambiguous';

export type PayenvErrorCode =
  // safe_to_fallback
  | 'PROVIDER_UNAVAILABLE'
  | 'RATE_LIMITED'
  | 'ROUTE_UNSUPPORTED'
  | 'AUTHENTICATION_FAILED'
  // do_not_retry
  | 'INSUFFICIENT_FUNDS'
  | 'CUSTOMER_DECLINED'
  | 'CUSTOMER_TIMEOUT'
  | 'INVALID_PHONE'
  | 'LIMIT_EXCEEDED'
  | 'FRAUD_SUSPECTED'
  | 'INVALID_REQUEST'
  | 'NO_ROUTE'
  | 'IDEMPOTENCY_CONFLICT'
  | 'PAYMENT_NOT_FOUND'
  // ambiguous
  | 'TIMEOUT'
  | 'NETWORK_ERROR'
  | 'UNKNOWN_ERROR';

export const DEFAULT_RETRY_CLASS: Readonly<Record<PayenvErrorCode, RetryClass>> = {
  PROVIDER_UNAVAILABLE: 'safe_to_fallback',
  RATE_LIMITED: 'safe_to_fallback',
  ROUTE_UNSUPPORTED: 'safe_to_fallback',
  AUTHENTICATION_FAILED: 'safe_to_fallback',
  INSUFFICIENT_FUNDS: 'do_not_retry',
  CUSTOMER_DECLINED: 'do_not_retry',
  CUSTOMER_TIMEOUT: 'do_not_retry',
  INVALID_PHONE: 'do_not_retry',
  LIMIT_EXCEEDED: 'do_not_retry',
  FRAUD_SUSPECTED: 'do_not_retry',
  INVALID_REQUEST: 'do_not_retry',
  NO_ROUTE: 'do_not_retry',
  IDEMPOTENCY_CONFLICT: 'do_not_retry',
  PAYMENT_NOT_FOUND: 'do_not_retry',
  TIMEOUT: 'ambiguous',
  NETWORK_ERROR: 'ambiguous',
  UNKNOWN_ERROR: 'ambiguous',
};

export interface PayenvErrorOptions {
  /** Overrides the default retry class of the code. */
  retryClass?: RetryClass;
  /** Connector that produced the error, if any. */
  connectorId?: string;
  /** The provider's own error code (e.g. FedaPay's `INSUFFICIENT_FUND_ERROR`), for support and logs. */
  providerCode?: string;
  /** Original provider response or error, kept for debugging. Never shown to end users. */
  raw?: unknown;
  cause?: unknown;
}

export class PayenvError extends Error {
  override readonly name = 'PayenvError';
  readonly code: PayenvErrorCode;
  readonly retryClass: RetryClass;
  readonly connectorId: string | undefined;
  readonly providerCode: string | undefined;
  readonly raw: unknown;

  constructor(code: PayenvErrorCode, message: string, options: PayenvErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.code = code;
    this.retryClass = options.retryClass ?? DEFAULT_RETRY_CLASS[code];
    this.connectorId = options.connectorId;
    this.providerCode = options.providerCode;
    this.raw = options.raw;
  }

  /** A plain, serializable representation (without `raw`). */
  toJSON(): SerializedError {
    return {
      code: this.code,
      message: this.message,
      retryClass: this.retryClass,
      ...(this.connectorId === undefined ? {} : { connectorId: this.connectorId }),
      ...(this.providerCode === undefined ? {} : { providerCode: this.providerCode }),
    };
  }
}

export interface SerializedError {
  code: PayenvErrorCode;
  message: string;
  retryClass: RetryClass;
  connectorId?: string;
  providerCode?: string;
}

export function isPayenvError(value: unknown): value is PayenvError {
  return value instanceof PayenvError;
}
