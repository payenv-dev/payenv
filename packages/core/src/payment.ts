import type { Customer, NextAction, Operation } from './connector.js';
import type { SerializedError } from './errors.js';
import type { PaymentMethod } from './method.js';
import type { Money } from './money.js';
import type { PaymentStatus } from './status.js';

/** How the attempt engine concluded an attempt. */
export type AttemptOutcome =
  /** The provider accepted the payment (pending, requires action, or succeeded). */
  | 'accepted'
  /** Proven that no money moved; another connector was (or could be) tried. */
  | 'fell_back'
  /** Failed for a reason another provider would not change. */
  | 'failed'
  /** Could not determine whether money moved. */
  | 'unresolved';

export interface Attempt {
  id: string;
  connectorId: string;
  reference: string;
  status: PaymentStatus;
  outcome?: AttemptOutcome;
  providerRef?: string;
  /** Merchant reference sent to the provider, when the connector reports one. */
  merchantReference?: string;
  error?: SerializedError;
  startedAt: string;
  endedAt?: string;
}

export interface Payment {
  id: string;
  idempotencyKey: string;
  operation: Operation;
  status: PaymentStatus;
  amount: Money;
  method: PaymentMethod;
  customer?: Customer;
  description?: string;
  metadata?: Readonly<Record<string, string>>;
  /** Connector currently holding the payment (the last attempt). */
  connectorId?: string;
  providerRef?: string;
  nextAction?: NextAction;
  error?: SerializedError;
  attempts: Attempt[];
  /** Fingerprint of the request, used to detect idempotency key reuse with different data. */
  fingerprint: string;
  createdAt: string;
  updatedAt: string;
}
