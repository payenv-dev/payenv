import type { PayenvError, PaymentStatus } from '@payenv/core';
import { type Json, toStatusResult } from './kkiapay.js';

/**
 * Verifies a Kkiapay webhook.
 *
 * Kkiapay sends the hash secret configured in its dashboard, as is, in the
 * `x-kkiapay-secret` header (it does not sign the body). Compare it in constant time,
 * and only trust the body as a hint: confirm with `payenv.confirm`.
 */
export function verifyKkiapayWebhook(
  secretHeader: string | null | undefined,
  secret: string,
): boolean {
  if (!secret || !secretHeader) return false;
  return constantTimeEqual(secretHeader, secret);
}

/** A Kkiapay webhook, normalized. */
export interface KkiapayWebhookEvent {
  /** Kkiapay's event name, e.g. `transaction.success`. Informational only. */
  name: string;
  /** The Kkiapay transaction id: pass it to `payenv.confirm`. */
  providerRef: string;
  /** The widget's `partnerId`: the payment's idempotency key when it was set by Payenv. */
  merchantReference?: string;
  status: PaymentStatus;
  error?: PayenvError;
}

/**
 * Parses a Kkiapay webhook body **after** {@link verifyKkiapayWebhook} succeeded.
 * Then call `payenv.confirm(event.merchantReference, event.providerRef)`, which
 * verifies the transaction with Kkiapay before updating the payment.
 */
export function parseKkiapayWebhook(
  rawBody: string,
  connectorId = 'kkiapay',
): KkiapayWebhookEvent | undefined {
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return undefined;
  }
  if (body === null || typeof body !== 'object') return undefined;
  const event = body as Json;
  const { transactionId } = event;
  if (typeof transactionId !== 'string' || transactionId === '') return undefined;

  // The documented field is spelled `isPaymentSucces`.
  const succeeded = event.isPaymentSucces ?? event.isPaymentSuccess;
  const result = toStatusResult(
    { ...event, status: succeeded === true ? 'SUCCESS' : succeeded === false ? 'FAILED' : '' },
    transactionId,
    connectorId,
  );
  if (!result.found) return undefined;
  return {
    name: typeof event.event === 'string' ? event.event : 'unknown',
    providerRef: transactionId,
    status: result.status,
    ...(result.merchantReference ? { merchantReference: result.merchantReference } : {}),
    ...(result.error ? { error: result.error } : {}),
  };
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index++) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
}
