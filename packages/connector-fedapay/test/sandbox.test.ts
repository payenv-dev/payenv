import { createPayenv } from '@payenv/core';
import { describe, expect, it } from 'vitest';
import { fedapay } from '../src/index.js';

// Opt-in: runs only when sandbox credentials are set in a local .env file.
// See .env.example at the repository root. Never use live keys here.
const secretKey = process.env.FEDAPAY_SANDBOX_SECRET_KEY;
const phone = process.env.FEDAPAY_SANDBOX_PHONE;
const network = process.env.FEDAPAY_SANDBOX_NETWORK || 'mtn';

describe.skipIf(!secretKey || !phone)('fedapay sandbox (real API)', () => {
  it(`sends a ${network} push and reads the status back`, { timeout: 60_000 }, async () => {
    const connector = fedapay({ secretKey: secretKey as string, environment: 'sandbox' });
    const payenv = createPayenv({ connectors: [connector] });
    const idempotencyKey = `sandbox_${Date.now()}`;

    const payment = await payenv.collect({
      amount: { value: 100, currency: 'XOF' },
      method: { type: 'mobile_money', network, country: 'BJ', phone: phone as string },
      customer: { firstName: 'Payenv', lastName: 'Sandbox', email: 'sandbox@example.com' },
      description: 'Payenv sandbox test',
      idempotencyKey,
    });

    if (payment.error?.code === 'ROUTE_UNSUPPORTED') {
      throw new Error(
        `"${network}" is not activated on this FedaPay sandbox account. Activate it in ` +
          'Dashboard (sandbox mode) → Configuration → Payment methods, or set ' +
          'FEDAPAY_SANDBOX_NETWORK to an activated operator (mtn, moov, celtiis).',
      );
    }
    expect(payment.error).toBeUndefined();
    expect(['pending', 'succeeded']).toContain(payment.status);
    expect(payment.providerRef).toBeDefined();

    const refreshed = await payenv.refresh(idempotencyKey);
    expect(refreshed.status).not.toBe('unknown');
  });
});
