import { describe, expect, it } from 'vitest';
import { createMemoryStore, createPayenv, PayenvError, priority } from '../src/index.js';
import { fakeConnector, mtnRequest, pending } from './helpers.js';

const fast = { statusCheckDelaysMs: [0], attemptTimeoutMs: 50 };

describe('idempotency', () => {
  it('returns the same payment for the same key without charging again', async () => {
    const a = fakeConnector('a', pending);
    const payenv = createPayenv({ connectors: [a], ...fast });
    const request = mtnRequest();

    const first = await payenv.collect(request);
    const second = await payenv.collect(request);

    expect(second.id).toBe(first.id);
    expect(a.collectCalls).toHaveLength(1);
  });

  it('charges only once when two calls race with the same key', async () => {
    const a = fakeConnector('a', pending);
    const payenv = createPayenv({ connectors: [a], ...fast });
    const request = mtnRequest();

    const [first, second] = await Promise.all([payenv.collect(request), payenv.collect(request)]);

    expect(second.id).toBe(first.id);
    expect(a.collectCalls).toHaveLength(1);
  });

  it('rejects a reused key with a different amount', async () => {
    const payenv = createPayenv({ connectors: [fakeConnector('a', pending)], ...fast });
    const request = mtnRequest();
    await payenv.collect(request);

    await expect(
      payenv.collect({ ...request, amount: { value: 9000, currency: 'XOF' } }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });

  it('gives each attempt a unique reference and idempotency key', async () => {
    const a = fakeConnector('a', async () => {
      throw new PayenvError('PROVIDER_UNAVAILABLE', 'down');
    });
    const b = fakeConnector('b', pending);
    await createPayenv({ connectors: [a, b], ...fast }).collect(mtnRequest());

    const [first] = a.collectCalls;
    const [second] = b.collectCalls;
    expect(first?.reference).not.toBe(second?.reference);
    expect(first?.idempotencyKey).not.toBe(second?.idempotencyKey);
  });
});

describe('routing', () => {
  it('skips connectors that do not support the route', async () => {
    const cardOnly = fakeConnector('cards', pending, undefined, [
      { operation: 'collect', method: 'card', currencies: ['XOF'] },
    ]);
    const momo = fakeConnector('momo', pending);
    const payment = await createPayenv({ connectors: [cardOnly, momo], ...fast }).collect(
      mtnRequest(),
    );

    expect(payment.connectorId).toBe('momo');
    expect(cardOnly.collectCalls).toHaveLength(0);
  });

  it('throws NO_ROUTE when no connector supports the network', async () => {
    const payenv = createPayenv({ connectors: [fakeConnector('a', pending)], ...fast });
    await expect(
      payenv.collect(
        mtnRequest({
          method: { type: 'mobile_money', network: 'wave', country: 'SN', phone: '+221770000000' },
        }),
      ),
    ).rejects.toMatchObject({ code: 'NO_ROUTE' });
  });

  it('follows the priority order', async () => {
    const a = fakeConnector('a', pending);
    const b = fakeConnector('b', pending);
    const payment = await createPayenv({
      connectors: [a, b],
      routing: priority(['b', 'a']),
      ...fast,
    }).collect(mtnRequest());

    expect(payment.connectorId).toBe('b');
  });
});

describe('validation', () => {
  const payenv = createPayenv({ connectors: [fakeConnector('a', pending)], ...fast });

  it('rejects non-integer amounts', async () => {
    await expect(
      payenv.collect(mtnRequest({ amount: { value: 12.5, currency: 'XOF' } })),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('rejects phones that are not E.164', async () => {
    await expect(
      payenv.collect(
        mtnRequest({
          method: { type: 'mobile_money', network: 'mtn', country: 'BJ', phone: '90000000' },
        }),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_PHONE' });
  });

  it('rejects duplicate connector ids', () => {
    expect(() =>
      createPayenv({ connectors: [fakeConnector('a', pending), fakeConnector('a', pending)] }),
    ).toThrow(PayenvError);
  });
});

describe('refresh', () => {
  it('updates a pending payment from the provider', async () => {
    let status: 'pending' | 'succeeded' = 'pending';
    const a = fakeConnector('a', pending, async () => ({ found: true, status }));
    const payenv = createPayenv({ connectors: [a], store: createMemoryStore(), ...fast });
    const request = mtnRequest();
    await payenv.collect(request);

    status = 'succeeded';
    const refreshed = await payenv.refresh(request.idempotencyKey);

    expect(refreshed.status).toBe('succeeded');
    expect((await payenv.getPayment(request.idempotencyKey))?.status).toBe('succeeded');
  });

  it('updates the attempt outcome when a pending payment is declined', async () => {
    const a = fakeConnector('a', pending, async () => ({
      found: true,
      status: 'failed',
      error: new PayenvError('CUSTOMER_DECLINED', 'declined'),
    }));
    const payenv = createPayenv({ connectors: [a], ...fast });
    const request = mtnRequest();
    expect((await payenv.collect(request)).attempts[0]?.outcome).toBe('accepted');

    const refreshed = await payenv.refresh(request.idempotencyKey);

    expect(refreshed.status).toBe('failed');
    expect(refreshed.error?.code).toBe('CUSTOMER_DECLINED');
    expect(refreshed.attempts[0]).toMatchObject({ status: 'failed', outcome: 'failed' });
  });

  it('marks an unresolved attempt as accepted once the provider confirms it', async () => {
    let checks = 0;
    const a = fakeConnector(
      'a',
      async () => {
        throw new PayenvError('TIMEOUT', 'timeout');
      },
      async () => {
        checks += 1;
        return checks === 1
          ? { found: true, status: 'unknown' }
          : { found: true, status: 'succeeded' };
      },
    );
    const payenv = createPayenv({ connectors: [a], ...fast });
    const request = mtnRequest();
    expect((await payenv.collect(request)).attempts[0]?.outcome).toBe('unresolved');

    const refreshed = await payenv.refresh(request.idempotencyKey);

    expect(refreshed.status).toBe('succeeded');
    expect(refreshed.attempts[0]?.outcome).toBe('accepted');
    expect(refreshed.error).toBeUndefined();
  });

  it('shows a provider error on a payment that stays pending', async () => {
    const a = fakeConnector('a', pending, async () => ({
      found: true,
      status: 'pending',
      error: new PayenvError('PROVIDER_UNAVAILABLE', 'operator error', {
        providerCode: 'API_ERROR',
      }),
    }));
    const payenv = createPayenv({ connectors: [a], ...fast });
    const request = mtnRequest();
    await payenv.collect(request);

    const refreshed = await payenv.refresh(request.idempotencyKey);

    expect(refreshed.status).toBe('pending');
    expect(refreshed.error).toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
      providerCode: 'API_ERROR',
    });
  });

  it('never changes a terminal payment', async () => {
    const a = fakeConnector(
      'a',
      async () => ({ status: 'succeeded' }),
      async () => ({ found: true, status: 'failed' }),
    );
    const payenv = createPayenv({ connectors: [a], ...fast });
    const request = mtnRequest();
    await payenv.collect(request);

    expect((await payenv.refresh(request.idempotencyKey)).status).toBe('succeeded');
    expect(a.statusCalls).toHaveLength(0);
  });

  it('ignores errors thrown by event handlers', async () => {
    const payenv = createPayenv({
      connectors: [fakeConnector('a', pending)],
      ...fast,
      onEvent: () => {
        throw new Error('bad handler');
      },
    });
    expect((await payenv.collect(mtnRequest())).status).toBe('pending');
  });
});
