import type { PayenvError } from './errors.js';
import type {
  CountryCode,
  MobileMoneyNetwork,
  PaymentMethod,
  PaymentMethodType,
} from './method.js';
import type { CurrencyCode, Money } from './money.js';
import type { PaymentStatus } from './status.js';

export type Operation = 'collect';

export interface Customer {
  firstName?: string;
  lastName?: string;
  email?: string;
  /** E.164 phone number. */
  phone?: string;
}

export interface CollectRequest {
  amount: Money;
  method: PaymentMethod;
  customer?: Customer;
  description?: string;
  /**
   * Unique key chosen by the application (e.g. its order id). The same key always
   * returns the same payment and never creates a second charge.
   */
  idempotencyKey: string;
  metadata?: Readonly<Record<string, string>>;
}

/** What a connector declares it can serve. Omitted lists mean "any". */
export interface Capability {
  operation: Operation;
  method: PaymentMethodType;
  currencies: readonly CurrencyCode[];
  countries?: readonly CountryCode[];
  /** Only meaningful for `mobile_money`. */
  networks?: readonly MobileMoneyNetwork[];
}

/** An instruction the application must follow to complete the payment. */
export type NextAction =
  | { type: 'redirect'; url: string }
  | { type: 'customer_confirmation'; channel?: 'ussd' | 'sms' | 'app'; message?: string };

/**
 * Result of a provider call, normalized by the connector.
 *
 * When the outcome is uncertain but the provider's transaction id is known, return
 * `{ status: 'unknown', providerRef, error }` rather than throwing.
 */
export interface ProviderResult {
  status: PaymentStatus;
  /** The provider's identifier for this transaction. */
  providerRef?: string;
  nextAction?: NextAction;
  /** Required when `status` is `failed`, `canceled` or `expired`, to classify the failure. */
  error?: PayenvError;
  raw?: unknown;
}

/**
 * Result of a status lookup.
 *
 * `found: false` must only be returned when the provider **authoritatively**
 * confirms it has no record of the transaction (not on a transient error), because
 * Payenv will then consider it safe to try another connector.
 */
export type StatusResult = ({ found: true } & ProviderResult) | { found: false; raw?: unknown };

export interface AttemptContext {
  paymentId: string;
  attemptId: string;
  /**
   * Unique reference of this attempt. Connectors should send it to the provider as
   * the merchant reference, so the transaction can be found even if the call timed out.
   */
  reference: string;
  /** Idempotency key to forward to providers that support one (unique per attempt). */
  idempotencyKey: string;
  /** Aborted when the attempt times out. Pass it to `fetch`. */
  signal: AbortSignal;
  /**
   * Reports the provider's transaction id as soon as it is known, before the call
   * that could move money. If that call then times out, Payenv can still check
   * the status with the provider instead of leaving the payment `unknown`.
   */
  reportProviderRef(providerRef: string): void;
}

export interface StatusQuery {
  operation: Operation;
  reference: string;
  providerRef?: string;
}

export interface StatusContext {
  signal: AbortSignal;
}

/** An adapter for one payment aggregator. The only place with provider-specific code. */
export interface Connector {
  readonly id: string;
  capabilities(): readonly Capability[];
  collect(request: CollectRequest, context: AttemptContext): Promise<ProviderResult>;
  getStatus(query: StatusQuery, context: StatusContext): Promise<StatusResult>;
  /**
   * Maps an error thrown by `collect` / `getStatus` to a {@link PayenvError}.
   * Errors that are not mapped are treated as `ambiguous`.
   */
  mapError?(error: unknown): PayenvError;
}
