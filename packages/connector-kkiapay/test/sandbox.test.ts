import { describe, expect, it } from 'vitest';
import { kkiapay } from '../src/index.js';

// Opt-in: runs only when Kkiapay sandbox keys are set in a local .env file.
// Kkiapay payments start in the widget, so a transaction id can only come from a real
// widget payment (e.g. the demo): set KKIAPAY_SANDBOX_TRANSACTION_ID to check it.
const publicKey = process.env.KKIAPAY_SANDBOX_PUBLIC_KEY;
const privateKey = process.env.KKIAPAY_SANDBOX_PRIVATE_KEY;
const secretKey = process.env.KKIAPAY_SANDBOX_SECRET_KEY;
const transactionId = process.env.KKIAPAY_SANDBOX_TRANSACTION_ID;

const configured = Boolean(publicKey && privateKey && secretKey);

describe.skipIf(!configured)('kkiapay sandbox (real API)', () => {
  const connector = () =>
    kkiapay({
      publicKey: publicKey as string,
      privateKey: privateKey as string,
      secretKey: secretKey as string,
    });
  const lookup = (providerRef: string) =>
    connector().getStatus(
      { operation: 'collect', reference: 'sandbox', providerRef },
      { signal: AbortSignal.timeout(20_000) },
    );

  it('reports an unknown transaction id as not found', { timeout: 30_000 }, async () => {
    expect(await lookup(`payenv_unknown_${Date.now()}`)).toMatchObject({ found: false });
  });

  it.skipIf(!transactionId)('reads a real widget transaction', { timeout: 30_000 }, async () => {
    const result = await lookup(transactionId as string);
    expect(result.found).toBe(true);
    if (!result.found) return;
    expect(['succeeded', 'failed', 'pending']).toContain(result.status);
    expect(result.amount?.currency).toBe('XOF');
  });
});
