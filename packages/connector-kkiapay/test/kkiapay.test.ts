import { type CollectRequest, createPayenv, PayenvError } from '@payenv/core';
import { describe, expect, it } from 'vitest';
import {
  KKIAPAY_WIDGET,
  kkiapay,
  parseKkiapayWebhook,
  verifyKkiapayWebhook,
} from '../src/index.js';

const keys = { publicKey: 'pk_test', privateKey: 'tpk_test', secretKey: 'tsk_test' };

interface Call {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

/** A fake Kkiapay status API answering from a table of transactions. */
function fakeKkiapay(transactions: Record<string, Record<string, unknown>>) {
  const calls: Call[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { transactionId: string };
    calls.push({ url: String(input), headers: init?.headers as Record<string, string>, body });
    const transaction = transactions[body.transactionId];
    return transaction
      ? new Response(JSON.stringify(transaction), { status: 200 })
      : new Response(JSON.stringify({ reason: 'Transaction Not Found' }), { status: 404 });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

function request(overrides: Partial<CollectRequest> = {}): CollectRequest {
  return {
    amount: { value: 5000, currency: 'XOF' },
    method: { type: 'mobile_money', network: 'mtn', country: 'BJ', phone: '+22961000000' },
    customer: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' },
    idempotencyKey: 'order_1',
    supportedWidgets: [KKIAPAY_WIDGET],
    ...overrides,
  };
}

/** Shape of a Kkiapay status response (documentation), for the given payment. */
function transaction(overrides: Record<string, unknown> = {}) {
  return {
    performed_at: '2026-10-05T15:01:49.499Z',
    type: 'DEBIT',
    status: 'SUCCESS',
    source: 'MOBILE_MONEY',
    source_common_name: 'mtn-benin',
    amount: 5000,
    fees: 95,
    failureCode: '',
    failureMessage: '',
    partnerId: 'order_1',
    feeSupportedBy: 'customer',
    transactionId: 'kk_1',
    ...overrides,
  };
}

describe('kkiapay connector — collect', () => {
  it('returns the widget parameters, without calling Kkiapay', async () => {
    const server = fakeKkiapay({});
    const connector = kkiapay({ ...keys, fetch: server.fetch });

    const result = await connector.collect(request(), {
      paymentId: 'pay_1',
      attemptId: 'att_1',
      reference: 'att_1',
      idempotencyKey: 'att_1',
      signal: new AbortController().signal,
      reportProviderRef: () => {},
    });

    expect(result).toEqual({
      status: 'requires_action',
      merchantReference: 'order_1',
      nextAction: {
        type: 'widget',
        provider: 'kkiapay',
        params: {
          key: 'pk_test',
          amount: 5000,
          sandbox: true,
          partnerId: 'order_1',
          phone: '22961000000',
          paymentmethod: 'momo',
          countries: ['BJ'],
          name: 'Ada Lovelace',
          email: 'ada@example.com',
        },
      },
    });
    expect(server.calls).toHaveLength(0);
  });

  it('never exposes the private or secret keys to the front end', async () => {
    const payenv = createPayenv({ connectors: [kkiapay(keys)] });
    const payment = await payenv.collect(request());
    const exposed = JSON.stringify(payment.nextAction);
    expect(exposed).not.toContain('tpk_test');
    expect(exposed).not.toContain('tsk_test');
  });

  it('is only routed when the front end can open the Kkiapay widget', async () => {
    const payenv = createPayenv({ connectors: [kkiapay(keys)] });
    await expect(payenv.collect(request({ supportedWidgets: [] }))).rejects.toMatchObject({
      code: 'NO_ROUTE',
    });
  });
});

describe('kkiapay connector — confirm through Payenv', () => {
  it('confirms a genuine transaction', async () => {
    const server = fakeKkiapay({ kk_1: transaction() });
    const payenv = createPayenv({ connectors: [kkiapay({ ...keys, fetch: server.fetch })] });
    await payenv.collect(request());

    const payment = await payenv.confirm('order_1', 'kk_1');

    expect(payment.status).toBe('succeeded');
    expect(payment.providerRef).toBe('kk_1');
    expect(server.calls[0]).toMatchObject({
      url: 'https://api-sandbox.kkiapay.me/api/v1/transactions/status',
      body: { transactionId: 'kk_1' },
      headers: { 'x-api-key': 'pk_test', 'x-private-key': 'tpk_test', 'x-secret-key': 'tsk_test' },
    });
  });

  it('rejects a transaction made for another order (fraud attempt)', async () => {
    const server = fakeKkiapay({ kk_other: transaction({ partnerId: 'order_999' }) });
    const payenv = createPayenv({ connectors: [kkiapay({ ...keys, fetch: server.fetch })] });
    await payenv.collect(request());

    await expect(payenv.confirm('order_1', 'kk_other')).rejects.toMatchObject({
      code: 'REFERENCE_MISMATCH',
    });
  });

  it('rejects a transaction for a smaller amount (fraud attempt)', async () => {
    const server = fakeKkiapay({ kk_cheap: transaction({ amount: 100 }) });
    const payenv = createPayenv({ connectors: [kkiapay({ ...keys, fetch: server.fetch })] });
    await payenv.collect(request());

    await expect(payenv.confirm('order_1', 'kk_cheap')).rejects.toMatchObject({
      code: 'REFERENCE_MISMATCH',
    });
  });

  it('rejects an unknown transaction id', async () => {
    const payenv = createPayenv({
      connectors: [kkiapay({ ...keys, fetch: fakeKkiapay({}).fetch })],
    });
    await payenv.collect(request());
    await expect(payenv.confirm('order_1', 'kk_bogus')).rejects.toMatchObject({
      code: 'PAYMENT_NOT_FOUND',
    });
  });

  it.each([
    ['insufficient_fund', 'INSUFFICIENT_FUNDS'],
    ['payment_declined', 'CUSTOMER_DECLINED'],
    ['processing_error', 'UNKNOWN_ERROR'],
  ])('maps a failed transaction (%s → %s)', async (failureCode, code) => {
    const server = fakeKkiapay({
      kk_1: transaction({ status: 'FAILED', failureCode, failureMessage: failureCode }),
    });
    const payenv = createPayenv({ connectors: [kkiapay({ ...keys, fetch: server.fetch })] });
    await payenv.collect(request());

    const payment = await payenv.confirm('order_1', 'kk_1');

    expect(payment.status).toBe('failed');
    expect(payment.error).toMatchObject({ code, providerCode: failureCode });
  });

  it('is the fallback when a server-push provider is down', async () => {
    const down = {
      id: 'push',
      capabilities: () =>
        kkiapay(keys)
          .capabilities()
          .map(({ widget, ...route }) => route),
      async collect(): Promise<never> {
        throw new PayenvError('PROVIDER_UNAVAILABLE', 'down');
      },
      async getStatus() {
        return { found: false as const };
      },
    };
    const server = fakeKkiapay({ kk_1: transaction() });
    const payenv = createPayenv({
      connectors: [down, kkiapay({ ...keys, fetch: server.fetch })],
      statusCheckDelaysMs: [0],
    });

    const started = await payenv.collect(request());
    expect(started).toMatchObject({ connectorId: 'kkiapay', status: 'requires_action' });
    expect(started.nextAction?.type).toBe('widget');

    expect((await payenv.confirm('order_1', 'kk_1')).status).toBe('succeeded');
  });
});

describe('kkiapay webhooks', () => {
  it('verifies the shared secret header', () => {
    expect(verifyKkiapayWebhook('my_hash_secret', 'my_hash_secret')).toBe(true);
    expect(verifyKkiapayWebhook('wrong', 'my_hash_secret')).toBe(false);
    expect(verifyKkiapayWebhook(undefined, 'my_hash_secret')).toBe(false);
    expect(verifyKkiapayWebhook('anything', '')).toBe(false);
  });

  it('parses a successful payment (documented shape)', () => {
    const event = parseKkiapayWebhook(
      JSON.stringify({
        transactionId: '3iH6wjHJ3',
        isPaymentSucces: true,
        account: '22996000000',
        method: 'MOBILE_MONEY',
        amount: 1000,
        fees: 19,
        partnerId: 'order_1',
        performedAt: '2024-03-20T08:55:22.883Z',
        event: 'transaction.success',
      }),
    );
    expect(event).toEqual({
      name: 'transaction.success',
      providerRef: '3iH6wjHJ3',
      merchantReference: 'order_1',
      status: 'succeeded',
    });
  });

  it('parses a failed payment with its reason', () => {
    const event = parseKkiapayWebhook(
      JSON.stringify({
        transactionId: 'erjEU5P9o',
        isPaymentSucces: false,
        failureCode: 'processing_error',
        failureMessage: 'processing_error',
        partnerId: 'order_1',
        event: 'transaction.failed',
      }),
    );
    expect(event).toMatchObject({ status: 'failed', merchantReference: 'order_1' });
    expect(event?.error?.providerCode).toBe('processing_error');
  });

  it.each(['not json', 'null', JSON.stringify({ event: 'transaction.success' })])(
    'ignores invalid bodies: %s',
    (body) => {
      expect(parseKkiapayWebhook(body)).toBeUndefined();
    },
  );
});
