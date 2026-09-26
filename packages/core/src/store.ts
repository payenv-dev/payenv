import type { Payment } from './payment.js';

/**
 * Persistence used by Payenv for payments and attempts. The application owns it.
 *
 * `create` must be atomic: when two calls race with the same idempotency key,
 * exactly one of them returns `true`. This is what prevents duplicate charges
 * under concurrency.
 */
export interface Store {
  /** Inserts the payment if no payment has this idempotency key. Returns `false` otherwise. */
  create(payment: Payment): Promise<boolean>;
  get(idempotencyKey: string): Promise<Payment | undefined>;
  update(payment: Payment): Promise<void>;
}

/** In-memory store for development and tests. Data is lost on restart. */
export function createMemoryStore(): Store {
  const payments = new Map<string, Payment>();
  return {
    async create(payment) {
      if (payments.has(payment.idempotencyKey)) return false;
      payments.set(payment.idempotencyKey, structuredClone(payment));
      return true;
    },
    async get(idempotencyKey) {
      const payment = payments.get(idempotencyKey);
      return payment && structuredClone(payment);
    },
    async update(payment) {
      payments.set(payment.idempotencyKey, structuredClone(payment));
    },
  };
}
