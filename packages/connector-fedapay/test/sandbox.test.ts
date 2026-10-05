import { createPayenv, isTerminal, type Payenv, type Payment } from '@payenv/core';
import { describe, expect, it } from 'vitest';
import { fedapay } from '../src/index.js';

// Opt-in: runs only when a sandbox key is set in a local .env file.
// See .env.example at the repository root. Never use live keys here.
const secretKey = process.env.FEDAPAY_SANDBOX_SECRET_KEY;

// FedaPay sandbox (`momo_test` mode): 64000001 and 66000001 succeed, any other
// number simulates a failed payment. https://docs.fedapay.com/fr/integration-api/sending-requests
const SUCCESS_PHONE = '+22964000001';
const FAILURE_PHONE = '+22964000009';

async function collect(payenv: Payenv, phone: string): Promise<Payment> {
  const payment = await payenv.collect({
    amount: { value: 100, currency: 'XOF' },
    method: { type: 'mobile_money', network: 'mtn', country: 'BJ', phone },
    customer: { firstName: 'Payenv', lastName: 'Sandbox', email: 'sandbox@example.com' },
    description: 'Payenv sandbox test',
    idempotencyKey: `sandbox_${Date.now()}_${phone}`,
  });
  expect(payment.error).toBeUndefined();
  expect(payment.providerRef).toBeDefined();
  return payment;
}

/** Refreshes until the payment reaches a terminal status, or gives up. */
async function settle(payenv: Payenv, payment: Payment): Promise<Payment> {
  let current = payment;
  for (let check = 0; check < 15 && !isTerminal(current.status); check++) {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    current = await payenv.refresh(current.idempotencyKey);
  }
  return current;
}

describe.skipIf(!secretKey)('fedapay sandbox (real API)', () => {
  const payenv = () => createPayenv({ connectors: [fedapay({ secretKey: secretKey as string })] });

  it('a success test number ends as succeeded', { timeout: 60_000 }, async () => {
    const client = payenv();
    const payment = await collect(client, SUCCESS_PHONE);
    expect(['pending', 'succeeded']).toContain(payment.status);
    expect((await settle(client, payment)).status).toBe('succeeded');
  });

  it('any other number ends as failed', { timeout: 60_000 }, async () => {
    const client = payenv();
    const payment = await collect(client, FAILURE_PHONE);
    const settled = await settle(client, payment);
    expect(settled.status).toBe('failed');
    expect(settled.error?.code).toBe('CUSTOMER_DECLINED');
  });
});
