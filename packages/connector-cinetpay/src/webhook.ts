/** A CinetPay notification, normalized. */
export interface CinetPayWebhookEvent {
  /** CinetPay's transaction id: the payment's `providerRef`. */
  providerRef: string;
  /** The attempt's `merchant_transaction_id`, when present. */
  merchantReference?: string;
}

/**
 * Parses the body CinetPay posts to `notifyUrl` (JSON or form-encoded).
 * Returns `undefined` when it is not a payment notification.
 *
 * The body carries no status and is not signed: treat it only as a signal to call
 * `payenv.refresh(idempotencyKey)`, which asks CinetPay for the authoritative status.
 * Give `notifyUrl` as a function to receive the idempotency key in the URL.
 */
export function parseCinetPayWebhook(rawBody: string): CinetPayWebhookEvent | undefined {
  const body = parseBody(rawBody);
  if (!body) return undefined;
  const providerRef = nonEmpty(body.transaction_id);
  if (!providerRef) return undefined;
  const merchantReference = nonEmpty(body.merchant_transaction_id);
  return { providerRef, ...(merchantReference ? { merchantReference } : {}) };
}

function parseBody(rawBody: string): Record<string, unknown> | undefined {
  const text = rawBody.trim();
  if (text.startsWith('{')) {
    try {
      const data: unknown = JSON.parse(text);
      return data !== null && typeof data === 'object'
        ? (data as Record<string, unknown>)
        : undefined;
    } catch {
      return undefined;
    }
  }
  if (text === '') return undefined;
  return Object.fromEntries(new URLSearchParams(text));
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}
