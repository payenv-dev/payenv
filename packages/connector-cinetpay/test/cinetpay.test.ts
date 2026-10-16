import {
  type AttemptContext,
  type CollectRequest,
  type Connector,
  createPayenv,
  PayenvError,
} from '@payenv/core';
import { describe, expect, it } from 'vitest';
import { cinetpay, merchantTransactionId, parseCinetPayWebhook } from '../src/index.js';

const BJ = { apiKey: 'sk_test_bj', apiPassword: 'pass_bj' };
const CI = { apiKey: 'sk_test_ci', apiPassword: 'pass_ci' };
const NOTIFY = 'https://shop.example/webhooks/cinetpay';

interface Call {
  method: string;
  path: string;
  token?: string;
  body?: Record<string, unknown>;
}

type Reply = { status?: number; body: unknown } | Error;

/**
 * A fake CinetPay API. Logins succeed for known keys; payment calls answer from the
 * given handlers. Payments looked up are taken from `payments`, per API key.
 */
function fakeCinetPay(
  handlers: {
    init?: (body: Record<string, unknown>, call: number) => Reply;
    payments?: Record<string, Record<string, Record<string, unknown>>>;
    lookup?: () => Reply;
    expiredOnce?: boolean;
  } = {},
) {
  const calls: Call[] = [];
  let inits = 0;
  let expired = handlers.expiredOnce ?? false;
  let logins = 0;
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const body = init?.body
      ? (JSON.parse(String(init.body)) as Record<string, unknown>)
      : undefined;
    const token = headers.Authorization?.replace(/^Bearer /, '');
    calls.push({
      method: init?.method ?? 'GET',
      path: url.pathname,
      ...(token ? { token } : {}),
      ...(body ? { body } : {}),
    });
    const reply = (value: Reply): Response => {
      if (value instanceof Error) throw value;
      return new Response(JSON.stringify(value.body), { status: value.status ?? 200 });
    };

    if (url.pathname === '/v1/oauth/login') {
      const key = String(body?.api_key);
      if (![BJ.apiKey, CI.apiKey].includes(key)) {
        return reply({
          status: 401,
          body: { code: 1005, status: 'INVALID_CREDENTIALS', description: 'invalid' },
        });
      }
      logins += 1;
      return reply({
        body: {
          code: 200,
          status: 'OK',
          access_token: `jwt_${key}_${logins}`,
          token_type: 'bearer',
          expires_in: 86400,
        },
      });
    }
    if (expired) {
      expired = false;
      return reply({
        status: 401,
        body: { code: 1003, status: 'EXPIRED_TOKEN', description: 'expired' },
      });
    }
    if (url.pathname === '/v1/payment' && init?.method === 'POST') {
      inits += 1;
      return reply(handlers.init?.(body ?? {}, inits) ?? initiated(body ?? {}));
    }
    if (url.pathname.startsWith('/v1/payment/')) {
      if (handlers.lookup) return reply(handlers.lookup());
      const identifier = decodeURIComponent(url.pathname.slice('/v1/payment/'.length));
      const key = token?.split('_').slice(1, 4).join('_') ?? '';
      const payment = handlers.payments?.[key]?.[identifier];
      return reply(
        payment
          ? { body: payment }
          : { status: 404, body: { code: 404, status: 'NOT_FOUND', description: 'not found' } },
      );
    }
    return reply({ status: 404, body: { message: 'no route' } });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

/** CinetPay's answer to a payment initialization (official SDK fixture). */
function initiated(body: Record<string, unknown>, details: Record<string, unknown> = {}) {
  return {
    body: {
      code: 200,
      status: 'OK',
      payment_token: 'tok_1',
      notify_token: 'notify_1',
      transaction_id: 'cp_1',
      merchant_transaction_id: body.merchant_transaction_id,
      payment_url: 'https://secure.sandbox.cinetpay.net/payment/abc123',
      details: {
        code: 2001,
        status: 'INITIATED',
        message: 'Confirmez le paiement sur votre téléphone',
        must_be_redirected: body.direct_pay !== true,
        ...details,
      },
    },
  };
}

function context(reference = 'att_6f1c2a4e-9b7d-4c1e-8a2f-0d3b5e7a9c11'): AttemptContext {
  return {
    paymentId: 'pay_1',
    attemptId: reference,
    reference,
    idempotencyKey: reference,
    signal: new AbortController().signal,
    reportProviderRef: () => {},
  };
}

function push(overrides: Partial<CollectRequest> = {}): CollectRequest {
  return {
    amount: { value: 5000, currency: 'XOF' },
    method: { type: 'mobile_money', network: 'mtn', country: 'BJ', phone: '+22997000000' },
    customer: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' },
    idempotencyKey: 'order_1',
    ...overrides,
  };
}

function hosted(overrides: Partial<CollectRequest> = {}): CollectRequest {
  return push({
    method: { type: 'hosted_page', country: 'CI', returnUrl: 'https://shop.example/done' },
    ...overrides,
  });
}

function connector(server: ReturnType<typeof fakeCinetPay>, extra = {}): Connector {
  return cinetpay({ credentials: { BJ, CI }, notifyUrl: NOTIFY, fetch: server.fetch, ...extra });
}

describe('cinetpay connector — setup', () => {
  it('requires credentials and a notification URL', () => {
    expect(() => cinetpay({ credentials: {}, notifyUrl: NOTIFY })).toThrow(PayenvError);
    expect(() =>
      cinetpay({ credentials: { BJ: { apiKey: 'sk', apiPassword: '' } }, notifyUrl: NOTIFY }),
    ).toThrow(/BJ/);
    expect(() => cinetpay({ credentials: { BJ }, notifyUrl: '' })).toThrow(/notifyUrl/);
  });

  it('only exposes the countries it has credentials for', () => {
    const capabilities = cinetpay({
      credentials: { BJ, CM: CI, CD: CI },
      notifyUrl: NOTIFY,
    }).capabilities();
    expect(capabilities).toEqual([
      {
        operation: 'collect',
        method: 'mobile_money',
        currencies: ['XOF'],
        countries: ['BJ'],
        networks: ['mtn', 'moov'],
      },
      { operation: 'collect', method: 'hosted_page', currencies: ['XOF'], countries: ['BJ'] },
      {
        operation: 'collect',
        method: 'mobile_money',
        currencies: ['XAF'],
        countries: ['CM'],
        networks: ['mtn'],
      },
      { operation: 'collect', method: 'hosted_page', currencies: ['XAF'], countries: ['CM'] },
    ]);
  });

  it('can offer the hosted page only, or push only', () => {
    expect(
      cinetpay({ credentials: { BJ }, notifyUrl: NOTIFY, methods: {} })
        .capabilities()
        .map((capability) => capability.method),
    ).toEqual(['hosted_page']);
    expect(
      cinetpay({ credentials: { BJ }, notifyUrl: NOTIFY, hostedPage: false })
        .capabilities()
        .map((capability) => capability.method),
    ).toEqual(['mobile_money']);
  });

  it('derives a merchant transaction id CinetPay accepts', () => {
    const id = merchantTransactionId('att_6f1c2a4e-9b7d-4c1e-8a2f-0d3b5e7a9c11');
    expect(id).toBe('1c2a4e9b7d4c1e8a2f0d3b5e7a9c11');
    expect(merchantTransactionId('order-42')).toBe('order42');
  });
});

describe('cinetpay connector — collect', () => {
  it('sends a direct push and waits for the customer', async () => {
    const server = fakeCinetPay();
    const result = await connector(server, {
      notifyUrl: (key: string) => `${NOTIFY}?key=${key}`,
    }).collect(push(), context());

    expect(server.calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'POST /v1/oauth/login',
      'POST /v1/payment',
    ]);
    expect(server.calls[0]?.body).toEqual({ api_key: 'sk_test_bj', api_password: 'pass_bj' });
    expect(server.calls[1]?.token).toBe('jwt_sk_test_bj_1');
    expect(server.calls[1]?.body).toEqual({
      currency: 'XOF',
      merchant_transaction_id: merchantTransactionId(context().reference),
      amount: 5000,
      lang: 'fr',
      designation: 'Payment order_1',
      client_email: 'ada@example.com',
      client_first_name: 'Ada',
      client_last_name: 'Lovelace',
      success_url: `${NOTIFY}?key=order_1`,
      failed_url: `${NOTIFY}?key=order_1`,
      notify_url: `${NOTIFY}?key=order_1`,
      channel: 'PUSH',
      client_phone_number: '+22997000000',
      payment_method: 'MTN_BJ',
      direct_pay: true,
    });
    expect(result).toMatchObject({
      status: 'requires_action',
      providerRef: 'cp_1',
      merchantReference: merchantTransactionId(context().reference),
      nextAction: {
        type: 'customer_confirmation',
        channel: 'ussd',
        message: 'Confirmez le paiement sur votre téléphone',
      },
    });
  });

  it('reuses the token across payments', async () => {
    const server = fakeCinetPay();
    const cp = connector(server);
    await cp.collect(push(), context('att_1'));
    await cp.collect(push(), context('att_2'));
    expect(server.calls.filter((call) => call.path === '/v1/oauth/login')).toHaveLength(1);
  });

  it('renews an expired token once and sends the payment again', async () => {
    const server = fakeCinetPay({ expiredOnce: true });
    const result = await connector(server).collect(push(), context());
    expect(result.status).toBe('requires_action');
    expect(server.calls.map((call) => call.path)).toEqual([
      '/v1/oauth/login',
      '/v1/payment',
      '/v1/oauth/login',
      '/v1/payment',
    ]);
    expect(server.calls[3]?.token).toBe('jwt_sk_test_bj_2');
  });

  it('redirects the customer to the hosted page', async () => {
    const server = fakeCinetPay();
    const result = await connector(server).collect(hosted(), context());

    const body = server.calls[1]?.body ?? {};
    expect(body).toMatchObject({
      success_url: 'https://shop.example/done',
      failed_url: 'https://shop.example/done',
    });
    expect(body).not.toHaveProperty('direct_pay');
    expect(body).not.toHaveProperty('payment_method');
    expect(server.calls[0]?.body).toMatchObject({ api_key: 'sk_test_ci' });
    expect(result).toMatchObject({
      status: 'requires_action',
      providerRef: 'cp_1',
      nextAction: {
        type: 'redirect',
        url: 'https://secure.sandbox.cinetpay.net/payment/abc123',
      },
    });
  });

  it('redirects a direct push when CinetPay asks for it', async () => {
    const server = fakeCinetPay({
      init: (body) => initiated(body, { must_be_redirected: true }),
    });
    const result = await connector(server).collect(push(), context());
    expect(result.nextAction).toMatchObject({ type: 'redirect' });
  });

  it('reports a direct push that already succeeded or failed', async () => {
    const succeeded = fakeCinetPay({
      init: (body) => initiated(body, { code: 100, status: 'SUCCESS' }),
    });
    expect((await connector(succeeded).collect(push(), context())).status).toBe('succeeded');

    const failed = fakeCinetPay({
      init: (body) => initiated(body, { code: 2010, status: 'FAILED', message: 'Refusé' }),
    });
    const result = await connector(failed).collect(push(), context());
    expect(result.status).toBe('failed');
    expect(result.error).toMatchObject({
      code: 'CUSTOMER_DECLINED',
      retryClass: 'do_not_retry',
      providerCode: 'FAILED',
    });
  });

  it.each([
    [
      'a network missing from its methods',
      push({ method: { ...push().method, network: 'orange' } as CollectRequest['method'] }),
    ],
    [
      'a country without credentials',
      push({ method: { ...push().method, country: 'SN' } as CollectRequest['method'] }),
    ],
    ['an amount below its minimum', push({ amount: { value: 50, currency: 'XOF' } })],
    ['a customer without a name', push({ customer: { email: 'ada@example.com' } })],
  ])('refuses %s without calling CinetPay', async (_, request) => {
    const server = fakeCinetPay();
    await expect(connector(server).collect(request, context())).rejects.toMatchObject({
      code: 'ROUTE_UNSUPPORTED',
      retryClass: 'safe_to_fallback',
    });
    expect(server.calls).toEqual([]);
  });

  it('can fall back when the credentials are refused', async () => {
    const server = fakeCinetPay();
    const cp = cinetpay({
      credentials: { BJ: { apiKey: 'sk_test_wrong', apiPassword: 'x' } },
      notifyUrl: NOTIFY,
      fetch: server.fetch,
    });
    await expect(cp.collect(push(), context())).rejects.toMatchObject({
      code: 'AUTHENTICATION_FAILED',
      retryClass: 'safe_to_fallback',
    });
  });

  it('never claims a direct push failed when the call did not complete', async () => {
    const server = fakeCinetPay({ init: () => new TypeError('fetch failed') });
    await expect(connector(server).collect(push(), context())).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
      retryClass: 'ambiguous',
    });
  });

  it('can fall back when a hosted page could not be created', async () => {
    const server = fakeCinetPay({ init: () => new TypeError('fetch failed') });
    await expect(connector(server).collect(hosted(), context())).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
      retryClass: 'safe_to_fallback',
    });
  });

  it.each([
    [{ status: 500, body: { code: -1, status: 'OPERATION_ERROR' } }, 'UNKNOWN_ERROR', 'ambiguous'],
    [
      { status: 409, body: { code: 1200, status: 'TRANSACTION_EXIST' } },
      'UNKNOWN_ERROR',
      'ambiguous',
    ],
    [
      { status: 400, body: { code: 1004, status: 'INVALID_PARAMS' } },
      'INVALID_REQUEST',
      'do_not_retry',
    ],
    [
      { status: 400, body: { code: 2006, status: 'USER_NOT_FOUND' } },
      'INVALID_PHONE',
      'do_not_retry',
    ],
    [
      { status: 403, body: { code: 2011, status: 'NOT_ALLOWED' } },
      'ROUTE_UNSUPPORTED',
      'safe_to_fallback',
    ],
    [{ status: 429, body: { message: 'slow down' } }, 'RATE_LIMITED', 'safe_to_fallback'],
  ])('maps the push answer %j', async (answer, code, retryClass) => {
    const server = fakeCinetPay({ init: () => answer });
    await expect(connector(server).collect(push(), context())).rejects.toMatchObject({
      code,
      retryClass,
    });
  });
});

describe('cinetpay connector — status', () => {
  const reference = 'att_6f1c2a4e-9b7d-4c1e-8a2f-0d3b5e7a9c11';
  const merchantId = merchantTransactionId(reference);
  const payment = (overrides: Record<string, unknown> = {}) => ({
    code: 100,
    status: 'SUCCESS',
    merchant_transaction_id: merchantId,
    transaction_id: 'cp_1',
    user: { name: 'Ada Lovelace', email: 'ada@example.com', phone_number: '+22997000000' },
    ...overrides,
  });
  const lookup = (cp: Connector, providerRef?: string) =>
    cp.getStatus(
      { operation: 'collect', reference, ...(providerRef ? { providerRef } : {}) },
      { signal: new AbortController().signal },
    );

  it('reads a payment by its merchant reference', async () => {
    const server = fakeCinetPay({ payments: { sk_test_bj: { [merchantId]: payment() } } });
    expect(await lookup(connector(server))).toMatchObject({
      found: true,
      status: 'succeeded',
      providerRef: 'cp_1',
      merchantReference: merchantId,
    });
    expect(server.calls.at(-1)?.path).toBe(`/v1/payment/${merchantId}`);
  });

  it('asks every country account before saying "not found"', async () => {
    const server = fakeCinetPay({ payments: { sk_test_ci: { cp_1: payment() } } });
    expect(await lookup(connector(server), 'cp_1')).toMatchObject({ status: 'succeeded' });

    const empty = fakeCinetPay();
    expect(await lookup(connector(empty))).toEqual({ found: false });
    expect(empty.calls.filter((call) => call.path.startsWith('/v1/payment/'))).toHaveLength(2);
  });

  it('asks the country of a payment it started first', async () => {
    const server = fakeCinetPay({ payments: { sk_test_ci: { [merchantId]: payment() } } });
    const cp = connector(server);
    await cp.collect(hosted(), context(reference));
    server.calls.length = 0;

    await lookup(cp);

    expect(server.calls.map((call) => call.token)).toEqual(['jwt_sk_test_ci_1']);
  });

  it.each([
    ['INITIATED', 2001, 'requires_action', undefined],
    ['PENDING', 2002, 'pending', undefined],
    ['FAILED', 2010, 'failed', 'CUSTOMER_DECLINED'],
    ['EXPIRED', 2003, 'expired', 'CUSTOMER_TIMEOUT'],
    ['INSUFFICIENT_BALANCE', 2005, 'failed', 'INSUFFICIENT_FUNDS'],
  ])('maps %s', async (status, code, expected, errorCode) => {
    const server = fakeCinetPay({ payments: { sk_test_bj: { cp_1: payment({ status, code }) } } });
    const result = await lookup(connector(server), 'cp_1');
    expect(result).toMatchObject({ found: true, status: expected });
    if (result.found) expect(result.error?.code).toBe(errorCode);
  });

  it('never reads an API error as "not found"', async () => {
    const down = fakeCinetPay({ lookup: () => ({ status: 503, body: { message: 'down' } }) });
    await expect(lookup(connector(down))).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });

    const bare404 = fakeCinetPay({ lookup: () => ({ status: 404, body: { message: 'nginx' } }) });
    await expect(lookup(connector(bare404))).rejects.toBeInstanceOf(PayenvError);
  });
});

describe('cinetpay connector — with Payenv', () => {
  const fast = { statusCheckDelaysMs: [0], attemptTimeoutMs: 200 };
  const backup = (): Connector => ({
    id: 'backup',
    capabilities: () => [
      {
        operation: 'collect',
        method: 'mobile_money',
        currencies: ['XOF'],
        countries: ['BJ'],
        networks: ['mtn'],
      },
    ],
    collect: async () => ({ status: 'pending', providerRef: 'b_1' }),
    getStatus: async () => ({ found: false }),
  });

  it('falls back only after CinetPay confirms it never received the push', async () => {
    const server = fakeCinetPay({ init: () => new TypeError('socket hang up') });
    const payenv = createPayenv({ connectors: [connector(server), backup()], ...fast });

    const payment = await payenv.collect(push());

    expect(payment.connectorId).toBe('backup');
    expect(payment.attempts.map((attempt) => attempt.outcome)).toEqual(['fell_back', 'accepted']);
    expect(server.calls.some((call) => call.path.startsWith('/v1/payment/'))).toBe(true);
  });

  it('keeps the payment when CinetPay has it after a timeout', async () => {
    let merchantId = '';
    const server = fakeCinetPay({
      init: (body) => {
        merchantId = String(body.merchant_transaction_id);
        return new TypeError('socket hang up');
      },
      lookup: () => ({
        body: {
          code: 2002,
          status: 'PENDING',
          merchant_transaction_id: merchantId,
          transaction_id: 'cp_9',
        },
      }),
    });
    const payenv = createPayenv({ connectors: [connector(server), backup()], ...fast });

    const payment = await payenv.collect(push());

    expect(payment.connectorId).toBe('cinetpay');
    expect(payment.status).toBe('pending');
    expect(payment.providerRef).toBe('cp_9');
  });

  it('keeps the hosted page URL until the customer pays', async () => {
    const server = fakeCinetPay({
      lookup: () => ({ body: { code: 2001, status: 'INITIATED', transaction_id: 'cp_1' } }),
    });
    const payenv = createPayenv({ connectors: [connector(server)], ...fast });
    const request = hosted();
    await payenv.collect(request);

    const refreshed = await payenv.refresh(request.idempotencyKey);

    expect(refreshed.status).toBe('requires_action');
    expect(refreshed.nextAction).toMatchObject({ type: 'redirect' });
  });
});

describe('cinetpay webhooks', () => {
  it('reads JSON and form-encoded notifications', () => {
    const json = JSON.stringify({
      notify_token: 'notify_1',
      merchant_transaction_id: 'abc',
      transaction_id: 'cp_1',
    });
    expect(parseCinetPayWebhook(json)).toEqual({ providerRef: 'cp_1', merchantReference: 'abc' });
    expect(parseCinetPayWebhook('transaction_id=cp_2&notify_token=x')).toEqual({
      providerRef: 'cp_2',
    });
  });

  it('ignores bodies that are not payment notifications', () => {
    expect(parseCinetPayWebhook('')).toBeUndefined();
    expect(parseCinetPayWebhook('{not json')).toBeUndefined();
    expect(parseCinetPayWebhook(JSON.stringify({ hello: 'world' }))).toBeUndefined();
  });
});
