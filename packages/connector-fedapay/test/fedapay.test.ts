import {
  type AttemptContext,
  type CollectRequest,
  type Connector,
  createPayenv,
  type ProviderResult,
} from '@payenv/core';
import { describe, expect, it } from 'vitest';
import { fedapay } from '../src/index.js';

type Handler = (body: unknown) => { status: number; json?: unknown } | Promise<never>;

interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

function fakeFedaPay(routes: Record<string, Handler>) {
  const calls: Call[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const path = url.replace(/^https:\/\/[^/]+\/v1/, '');
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ method, url, headers: init?.headers as Record<string, string>, body });
    const handler = routes[`${method} ${path}`];
    if (!handler) return new Response(JSON.stringify({ message: 'Not found' }), { status: 404 });
    const result = await handler(body);
    return new Response(result.json === undefined ? '' : JSON.stringify(result.json), {
      status: result.status,
    });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const happyRoutes: Record<string, Handler> = {
  'POST /transactions': () => ({
    status: 200,
    json: { 'v1/transaction': { id: 1234, reference: 'trx_abc', status: 'pending' } },
  }),
  'POST /transactions/1234/token': () => ({ status: 200, json: { token: 'jwt_token', url: 'x' } }),
  'POST /mtn_open': () => ({
    status: 200,
    json: { 'v1/payment_intent': { id: 9, status: 'pending' } },
  }),
};

function request(overrides: Partial<CollectRequest> = {}): CollectRequest {
  return {
    amount: { value: 5000, currency: 'XOF' },
    method: { type: 'mobile_money', network: 'mtn', country: 'BJ', phone: '+22990000000' },
    customer: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' },
    idempotencyKey: 'order_1',
    ...overrides,
  };
}

function context(): AttemptContext & { reported: string[] } {
  const reported: string[] = [];
  return {
    paymentId: 'pay_1',
    attemptId: 'att_1',
    reference: 'att_1',
    idempotencyKey: 'att_1',
    signal: new AbortController().signal,
    reportProviderRef: (ref) => reported.push(ref),
    reported,
  };
}

describe('fedapay connector — collect', () => {
  it('creates the transaction, gets a token, then sends the push', async () => {
    const server = fakeFedaPay(happyRoutes);
    const connector = fedapay({
      secretKey: 'sk_live_test',
      environment: 'live',
      fetch: server.fetch,
    });
    const ctx = context();

    const result = await connector.collect(request(), ctx);

    expect(server.calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      'POST https://api.fedapay.com/v1/transactions',
      'POST https://api.fedapay.com/v1/transactions/1234/token',
      'POST https://api.fedapay.com/v1/mtn_open',
    ]);
    expect(server.calls[0]?.body).toEqual({
      description: 'Payment att_1',
      amount: 5000,
      currency: { iso: 'XOF' },
      customer: {
        firstname: 'Ada',
        lastname: 'Lovelace',
        email: 'ada@example.com',
        phone_number: { number: '+22990000000', country: 'BJ' },
      },
    });
    expect(server.calls[2]?.body).toEqual({ token: 'jwt_token' });
    expect(server.calls[0]?.headers.Authorization).toBe('Bearer sk_live_test');
    expect(result).toMatchObject({
      status: 'pending',
      providerRef: '1234',
      nextAction: { type: 'customer_confirmation', channel: 'ussd' },
    });
    expect(ctx.reported).toEqual(['1234']);
  });

  it('uses the sandbox by default and sends every push to momo_test', async () => {
    const server = fakeFedaPay({
      ...happyRoutes,
      'POST /momo_test': () => ({
        status: 200,
        json: { 'v1/payment_intent': { status: 'pending' } },
      }),
    });
    const connector = fedapay({ secretKey: 'sk', fetch: server.fetch });
    await connector.collect(request(), context());

    expect(server.calls.map((call) => call.url)).toEqual([
      'https://sandbox-api.fedapay.com/v1/transactions',
      'https://sandbox-api.fedapay.com/v1/transactions/1234/token',
      'https://sandbox-api.fedapay.com/v1/momo_test',
    ]);
    // Same capabilities as live: application code doesn't change between environments.
    expect(connector.capabilities()).toEqual(
      fedapay({ secretKey: 'sk', environment: 'live' }).capabilities(),
    );
  });

  it('maps Payenv networks to FedaPay slugs', async () => {
    const server = fakeFedaPay({
      ...happyRoutes,
      'POST /sbin': () => ({ status: 200, json: { 'v1/payment_intent': { status: 'pending' } } }),
    });
    await fedapay({ secretKey: 'sk', environment: 'live', fetch: server.fetch }).collect(
      request({
        method: { type: 'mobile_money', network: 'celtiis', country: 'BJ', phone: '+22990000000' },
      }),
      context(),
    );
    expect(server.calls[2]?.url).toMatch(/\/v1\/sbin$/);
  });

  it('declares only configured operators as capabilities', () => {
    const connector = fedapay({ secretKey: 'sk', operators: { BJ: { mtn: 'mtn_open' } } });
    expect(connector.capabilities()).toEqual([
      {
        operation: 'collect',
        method: 'mobile_money',
        currencies: ['XOF'],
        countries: ['BJ'],
        networks: ['mtn'],
      },
    ]);
  });
});

describe('fedapay connector — errors before the push are safe to fall back', () => {
  it.each([
    [503, 'PROVIDER_UNAVAILABLE'],
    [401, 'AUTHENTICATION_FAILED'],
    [429, 'RATE_LIMITED'],
  ])('HTTP %i on create → %s', async (status, code) => {
    const server = fakeFedaPay({ 'POST /transactions': () => ({ status, json: {} }) });
    await expect(
      fedapay({ secretKey: 'sk', environment: 'live', fetch: server.fetch }).collect(
        request(),
        context(),
      ),
    ).rejects.toMatchObject({ code, retryClass: 'safe_to_fallback' });
  });

  it('network failure on token → PROVIDER_UNAVAILABLE', async () => {
    const server = fakeFedaPay({
      ...happyRoutes,
      'POST /transactions/1234/token': () => Promise.reject(new TypeError('fetch failed')),
    });
    await expect(
      fedapay({ secretKey: 'sk', environment: 'live', fetch: server.fetch }).collect(
        request(),
        context(),
      ),
    ).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE', retryClass: 'safe_to_fallback' });
  });

  it('operator not activated on the account → ROUTE_UNSUPPORTED', async () => {
    const server = fakeFedaPay({
      ...happyRoutes,
      'POST /mtn_open': () => ({ status: 400, json: { message: 'Opération non autorisée' } }),
    });
    await expect(
      fedapay({ secretKey: 'sk', environment: 'live', fetch: server.fetch }).collect(
        request(),
        context(),
      ),
    ).rejects.toMatchObject({ code: 'ROUTE_UNSUPPORTED', retryClass: 'safe_to_fallback' });
  });
});

describe('fedapay connector — errors during the push are ambiguous', () => {
  it.each([
    ['HTTP 502', () => ({ status: 502, json: {} })],
    ['network failure', () => Promise.reject(new TypeError('socket hang up'))],
  ] as const)('%s on push → unknown with the transaction id', async (_label, handler) => {
    const server = fakeFedaPay({ ...happyRoutes, 'POST /mtn_open': handler as Handler });
    const result = await fedapay({
      secretKey: 'sk',
      environment: 'live',
      fetch: server.fetch,
    }).collect(request(), context());
    expect(result.status).toBe('unknown');
    expect(result.providerRef).toBe('1234');
    expect(result.error?.retryClass).toBe('ambiguous');
  });
});

describe('fedapay connector — status', () => {
  it.each([
    ['pending', 'pending', undefined],
    ['approved', 'succeeded', undefined],
    ['declined', 'failed', 'CUSTOMER_DECLINED'],
    ['canceled', 'canceled', 'CUSTOMER_DECLINED'],
    ['expired', 'expired', 'CUSTOMER_TIMEOUT'],
    ['something_new', 'unknown', undefined],
  ])('FedaPay "%s" → %s', async (fedapayStatus, status, code) => {
    const server = fakeFedaPay({
      'GET /transactions/1234': () => ({
        status: 200,
        json: { 'v1/transaction': { id: 1234, status: fedapayStatus } },
      }),
    });
    const result = await fedapay({
      secretKey: 'sk',
      environment: 'live',
      fetch: server.fetch,
    }).getStatus(
      { operation: 'collect', reference: 'att_1', providerRef: '1234' },
      { signal: new AbortController().signal },
    );
    expect(result).toMatchObject({ found: true, status });
    if (result.found) expect(result.error?.code).toBe(code);
  });

  // Reproduces live transactions observed on 2026-10-05 (personal data removed).
  const lookup = async (transaction: Record<string, unknown>) => {
    const server = fakeFedaPay({
      'GET /transactions/1234': () => ({ status: 200, json: { 'v1/transaction': transaction } }),
    });
    return fedapay({ secretKey: 'sk', environment: 'live', fetch: server.fetch }).getStatus(
      { operation: 'collect', reference: 'att_1', providerRef: '1234' },
      { signal: new AbortController().signal },
    );
  };

  it('exposes the real reason of a canceled payment (insufficient funds, MTN live)', async () => {
    const result = await lookup({
      id: 1234,
      status: 'canceled',
      mode: 'mtn_open',
      last_error_code: 'INSUFFICIENT_FUND_ERROR',
    });
    expect(result).toMatchObject({ found: true, status: 'canceled' });
    if (!result.found) throw new Error('expected found');
    expect(result.error?.toJSON()).toEqual({
      code: 'INSUFFICIENT_FUNDS',
      message:
        'FedaPay transaction canceled — The customer has insufficient funds (INSUFFICIENT_FUND_ERROR)',
      retryClass: 'do_not_retry',
      connectorId: 'fedapay',
      providerCode: 'INSUFFICIENT_FUND_ERROR',
    });
  });

  it('keeps a pending payment pending but exposes why (Celtiis live)', async () => {
    const operatorDump = '{"Envelope"=>{"Body"=>{"TransactionStatus"=>"Initiated"}}}';
    const result = await lookup({
      id: 1234,
      status: 'pending',
      mode: 'sbin',
      last_error_code: 'API_ERROR',
      last_error_message: operatorDump,
      metadata: { expire_schedule_jobid: 'job_1' },
      expired_at: null,
    });
    expect(result).toMatchObject({ found: true, status: 'pending' });
    if (!result.found) throw new Error('expected found');
    expect(result.error?.code).toBe('UNKNOWN_ERROR');
    expect(result.error?.providerCode).toBe('API_ERROR');
    expect(result.error?.message).toContain('could not get a final status from the operator');
    // The raw operator dump is available for debugging but never serialized.
    expect(result.error?.raw).toMatchObject({ last_error_message: operatorDump });
    expect(JSON.stringify(result.error)).not.toContain('Envelope');
  });

  it('keeps unknown FedaPay error codes visible as providerCode', async () => {
    const result = await lookup({ id: 1234, status: 'declined', last_error_code: 'NEW_CODE' });
    if (!result.found) throw new Error('expected found');
    expect(result.error).toMatchObject({ code: 'CUSTOMER_DECLINED', providerCode: 'NEW_CODE' });
  });

  it('reports no error on a plain pending payment', async () => {
    const result = await lookup({ id: 1234, status: 'pending', last_error_code: null });
    if (!result.found) throw new Error('expected found');
    expect(result.error).toBeUndefined();
  });

  it('never claims "not found" without a transaction id', async () => {
    const server = fakeFedaPay({});
    await expect(
      fedapay({ secretKey: 'sk', environment: 'live', fetch: server.fetch }).getStatus(
        { operation: 'collect', reference: 'att_1' },
        { signal: new AbortController().signal },
      ),
    ).rejects.toBeDefined();
    expect(server.calls).toHaveLength(0);
  });
});

describe('fedapay connector — inside Payenv', () => {
  const backup = (): Connector & { calls: number } => {
    const connector = {
      id: 'backup',
      calls: 0,
      capabilities: () => fedapay({ secretKey: 'sk' }).capabilities(),
      async collect(): Promise<ProviderResult> {
        connector.calls += 1;
        return { status: 'pending', providerRef: 'backup_1' };
      },
      async getStatus() {
        return { found: false as const };
      },
    };
    return connector;
  };

  it('falls back to the next connector when FedaPay is down before the push', async () => {
    const server = fakeFedaPay({ 'POST /transactions': () => ({ status: 503, json: {} }) });
    const other = backup();
    const payenv = createPayenv({
      connectors: [fedapay({ secretKey: 'sk', environment: 'live', fetch: server.fetch }), other],
      statusCheckDelaysMs: [0],
    });

    const payment = await payenv.collect(request({ idempotencyKey: 'fallback_1' }));

    expect(payment.connectorId).toBe('backup');
    expect(other.calls).toBe(1);
  });

  it('does not fall back when the push outcome is unknown and FedaPay says pending', async () => {
    const server = fakeFedaPay({
      ...happyRoutes,
      'POST /mtn_open': () => ({ status: 504, json: {} }),
      'GET /transactions/1234': () => ({
        status: 200,
        json: { 'v1/transaction': { id: 1234, status: 'pending' } },
      }),
    });
    const other = backup();
    const payenv = createPayenv({
      connectors: [fedapay({ secretKey: 'sk', environment: 'live', fetch: server.fetch }), other],
      statusCheckDelaysMs: [0],
    });

    const payment = await payenv.collect(request({ idempotencyKey: 'ambiguous_1' }));

    expect(payment.status).toBe('pending');
    expect(payment.connectorId).toBe('fedapay');
    expect(payment.providerRef).toBe('1234');
    expect(other.calls).toBe(0);
  });
});
