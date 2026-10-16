import { describe, expect, it } from 'vitest';
import { cinetpay } from '../src/index.js';

// Opt-in: runs only when CinetPay sandbox credentials are set in a local .env file.
// Côte d'Ivoire has documented sandbox test numbers (see QUIRKS.md).
const apiKey = process.env.CINETPAY_SANDBOX_API_KEY_CI;
const apiPassword = process.env.CINETPAY_SANDBOX_API_PASSWORD_CI;

const configured = Boolean(apiKey && apiPassword);

describe.skipIf(!configured)('cinetpay sandbox (real API)', () => {
  const connector = () =>
    cinetpay({
      credentials: { CI: { apiKey: apiKey as string, apiPassword: apiPassword as string } },
      notifyUrl: 'https://example.com/payenv/cinetpay',
      methods: { CI: { mtn: 'MTN_CI' } },
    });
  const context = (reference: string) => ({
    paymentId: 'sandbox',
    attemptId: reference,
    reference,
    idempotencyKey: reference,
    signal: AbortSignal.timeout(30_000),
    reportProviderRef: () => {},
  });
  const customer = { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' };

  it('reports an unknown payment as not found', { timeout: 60_000 }, async () => {
    const result = await connector().getStatus(
      { operation: 'collect', reference: `payenv_unknown_${Date.now()}` },
      { signal: AbortSignal.timeout(30_000) },
    );
    expect(result).toEqual({ found: false });
  });

  it('pushes to a test number and reads the payment back', { timeout: 60_000 }, async () => {
    const reference = `att_${Date.now()}`;
    const cp = connector();
    const result = await cp.collect(
      {
        amount: { value: 100, currency: 'XOF' },
        // Succeeds after 3 seconds.
        method: { type: 'mobile_money', network: 'mtn', country: 'CI', phone: '+2250707070701' },
        customer,
        idempotencyKey: reference,
      },
      context(reference),
    );
    expect(['requires_action', 'pending', 'succeeded']).toContain(result.status);

    const status = await cp.getStatus(
      { operation: 'collect', reference },
      { signal: AbortSignal.timeout(30_000) },
    );
    expect(status).toMatchObject({ found: true, merchantReference: result.merchantReference });
  });
});
