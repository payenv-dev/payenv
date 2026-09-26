import { createPayenv } from '@payenv/core';
import { describe, expect, it } from 'vitest';
import { fedapay } from '../src/index.js';

// Opt-in: runs only when sandbox credentials are set in a local .env file.
// See .env.example at the repository root. Never use live keys here.
const secretKey = process.env.FEDAPAY_SANDBOX_SECRET_KEY;
const phone = process.env.FEDAPAY_SANDBOX_PHONE;

describe.skipIf(!secretKey || !phone)('fedapay sandbox (real API)', () => {
  it('sends an MTN push and reads the status back', { timeout: 60_000 }, async () => {
    const connector = fedapay({ secretKey: secretKey as string, environment: 'sandbox' });
    const payenv = createPayenv({ connectors: [connector] });
    const idempotencyKey = `sandbox_${Date.now()}`;

    const payment = await payenv.collect({
      amount: { value: 100, currency: 'XOF' },
      method: { type: 'mobile_money', network: 'mtn', country: 'BJ', phone: phone as string },
      customer: { firstName: 'Payenv', lastName: 'Sandbox', email: 'sandbox@example.com' },
      description: 'Payenv sandbox test',
      idempotencyKey,
    });

    expect(payment.error).toBeUndefined();
    expect(['pending', 'succeeded']).toContain(payment.status);
    expect(payment.providerRef).toBeDefined();

    const refreshed = await payenv.refresh(idempotencyKey);
    expect(refreshed.status).not.toBe('unknown');
  });
});
