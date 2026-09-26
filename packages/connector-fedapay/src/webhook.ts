export interface VerifyWebhookOptions {
  /** Maximum age of the signature, in seconds. Defaults to 300 (5 minutes). */
  toleranceSeconds?: number;
  /** Current time in milliseconds. Defaults to `Date.now()`. */
  now?: number;
}

/**
 * Verifies a FedaPay webhook signature.
 *
 * Header `x-fedapay-signature`: `t=<unix timestamp>,s=<hex signature>`, where the
 * signature is `HMAC-SHA256(secret, "<timestamp>.<raw body>")`.
 *
 * Pass the **raw, unparsed** request body: re-serialized JSON will not match.
 */
export async function verifyFedaPayWebhook(
  rawBody: string,
  signatureHeader: string | null | undefined,
  secret: string,
  options: VerifyWebhookOptions = {},
): Promise<boolean> {
  if (!secret || !signatureHeader) return false;

  const parts = new Map<string, string>();
  for (const part of signatureHeader.split(',')) {
    const separator = part.indexOf('=');
    if (separator > 0) parts.set(part.slice(0, separator).trim(), part.slice(separator + 1).trim());
  }
  const timestamp = parts.get('t');
  const signature = parts.get('s');
  if (!timestamp || !signature || !/^\d+$/.test(timestamp)) return false;

  const tolerance = options.toleranceSeconds ?? 300;
  const nowSeconds = (options.now ?? Date.now()) / 1000;
  if (Math.abs(nowSeconds - Number(timestamp)) > tolerance) return false;

  const expected = await hmacSha256Hex(secret, `${timestamp}.${rawBody}`);
  return constantTimeEqual(expected, signature.toLowerCase());
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  );
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index++) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
}
