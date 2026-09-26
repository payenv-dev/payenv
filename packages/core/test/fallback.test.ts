import { describe, expect, it } from 'vitest';
import { createPayenv, PayenvError, type ProviderResult, type StatusResult } from '../src/index.js';
import { fakeConnector, mtnRequest, pending } from './helpers.js';

const fast = { statusCheckDelaysMs: [0, 0, 0], attemptTimeoutMs: 50 };

describe('safe fallback', () => {
  it('uses the first connector when it accepts the payment', async () => {
    const a = fakeConnector('a', pending);
    const b = fakeConnector('b', pending);
    const payenv = createPayenv({ connectors: [a, b], ...fast });

    const payment = await payenv.collect(mtnRequest());

    expect(payment.status).toBe('pending');
    expect(payment.connectorId).toBe('a');
    expect(payment.nextAction).toEqual({ type: 'customer_confirmation', channel: 'ussd' });
    expect(b.collectCalls).toHaveLength(0);
  });

  it('falls back when the provider rejects before any money moved', async () => {
    const a = fakeConnector('a', async () => {
      throw new PayenvError('PROVIDER_UNAVAILABLE', 'down');
    });
    const b = fakeConnector('b', pending);
    const events: string[] = [];
    const payenv = createPayenv({
      connectors: [a, b],
      ...fast,
      onEvent: (event) => events.push(event.type),
    });

    const payment = await payenv.collect(mtnRequest());

    expect(payment.status).toBe('pending');
    expect(payment.connectorId).toBe('b');
    expect(payment.attempts.map((attempt) => attempt.outcome)).toEqual(['fell_back', 'accepted']);
    expect(events).toContain('fallback');
  });

  it('falls back when the provider reports a failed status with a safe reason', async () => {
    const a = fakeConnector('a', async () => ({
      status: 'failed',
      error: new PayenvError('ROUTE_UNSUPPORTED', 'MTN not enabled on this account'),
    }));
    const b = fakeConnector('b', pending);
    const payment = await createPayenv({ connectors: [a, b], ...fast }).collect(mtnRequest());

    expect(payment.connectorId).toBe('b');
    expect(payment.status).toBe('pending');
  });

  it('does not fall back when another provider would not change the outcome', async () => {
    const a = fakeConnector('a', async () => ({
      status: 'failed',
      error: new PayenvError('INSUFFICIENT_FUNDS', 'Solde insuffisant'),
    }));
    const b = fakeConnector('b', pending);
    const payment = await createPayenv({ connectors: [a, b], ...fast }).collect(mtnRequest());

    expect(payment.status).toBe('failed');
    expect(payment.error?.code).toBe('INSUFFICIENT_FUNDS');
    expect(b.collectCalls).toHaveLength(0);
  });

  it('does not fall back on a failure without a reason', async () => {
    const a = fakeConnector('a', async () => ({ status: 'failed' }));
    const b = fakeConnector('b', pending);
    const payment = await createPayenv({ connectors: [a, b], ...fast }).collect(mtnRequest());

    expect(payment.status).toBe('failed');
    expect(b.collectCalls).toHaveLength(0);
  });

  it('returns failed with the last error when every connector fell back', async () => {
    const down = async (): Promise<ProviderResult> => {
      throw new PayenvError('PROVIDER_UNAVAILABLE', 'down');
    };
    const payment = await createPayenv({
      connectors: [fakeConnector('a', down), fakeConnector('b', down)],
      ...fast,
    }).collect(mtnRequest());

    expect(payment.status).toBe('failed');
    expect(payment.error?.code).toBe('PROVIDER_UNAVAILABLE');
    expect(payment.attempts).toHaveLength(2);
  });
});

describe('ambiguous attempts (double-charge protection)', () => {
  const timeout = async (): Promise<ProviderResult> => {
    throw new PayenvError('TIMEOUT', 'socket timeout');
  };

  it('checks the status with the same provider and keeps the payment if it exists', async () => {
    const a = fakeConnector('a', timeout, async () => ({ found: true, status: 'pending' }));
    const b = fakeConnector('b', pending);
    const payment = await createPayenv({ connectors: [a, b], ...fast }).collect(mtnRequest());

    expect(payment.status).toBe('pending');
    expect(payment.connectorId).toBe('a');
    expect(a.statusCalls).toHaveLength(1);
    expect(b.collectCalls).toHaveLength(0);
  });

  it('treats unexpected exceptions as ambiguous', async () => {
    const a = fakeConnector(
      'a',
      async () => {
        throw new Error('ECONNRESET');
      },
      async () => ({ found: true, status: 'succeeded' }),
    );
    const b = fakeConnector('b', pending);
    const payment = await createPayenv({ connectors: [a, b], ...fast }).collect(mtnRequest());

    expect(payment.status).toBe('succeeded');
    expect(b.collectCalls).toHaveLength(0);
  });

  it('falls back only once the provider confirms it has no record', async () => {
    const a = fakeConnector('a', timeout, async () => ({ found: false }));
    const b = fakeConnector('b', pending);
    const payment = await createPayenv({ connectors: [a, b], ...fast }).collect(mtnRequest());

    expect(payment.connectorId).toBe('b');
    expect(a.statusCalls).toHaveLength(1);
  });

  it('keeps checking while the status stays unknown, then returns unknown', async () => {
    const a = fakeConnector('a', timeout, async () => ({ found: true, status: 'unknown' }));
    const b = fakeConnector('b', pending);
    const payment = await createPayenv({ connectors: [a, b], ...fast }).collect(mtnRequest());

    expect(payment.status).toBe('unknown');
    expect(a.statusCalls).toHaveLength(3);
    expect(b.collectCalls).toHaveLength(0);
  });

  it('returns unknown, without falling back, when status checks keep failing', async () => {
    const a = fakeConnector('a', timeout, async () => {
      throw new Error('still down');
    });
    const b = fakeConnector('b', pending);
    const payment = await createPayenv({ connectors: [a, b], ...fast }).collect(mtnRequest());

    expect(payment.status).toBe('unknown');
    expect(payment.error?.code).toBe('TIMEOUT');
    expect(b.collectCalls).toHaveLength(0);
  });

  it('treats a provider call that exceeds the timeout as ambiguous and aborts it', async () => {
    let signal: AbortSignal | undefined;
    const a = fakeConnector(
      'a',
      (_request, context) => {
        signal = context.signal;
        return new Promise(() => {});
      },
      async () => ({ found: true, status: 'pending' }),
    );
    const b = fakeConnector('b', pending);
    const payment = await createPayenv({ connectors: [a, b], ...fast }).collect(mtnRequest());

    expect(signal?.aborted).toBe(true);
    expect(payment.status).toBe('pending');
    expect(b.collectCalls).toHaveLength(0);
  });

  it('checks the status by provider ref reported before the call timed out', async () => {
    const a = fakeConnector(
      'a',
      (_request, context) => {
        context.reportProviderRef('tx_42');
        return new Promise(() => {});
      },
      async (query) =>
        query.providerRef === 'tx_42' ? { found: true, status: 'pending' } : { found: false },
    );
    const b = fakeConnector('b', pending);
    const payment = await createPayenv({ connectors: [a, b], ...fast }).collect(mtnRequest());

    expect(a.statusCalls[0]?.providerRef).toBe('tx_42');
    expect(payment.status).toBe('pending');
    expect(payment.providerRef).toBe('tx_42');
    expect(b.collectCalls).toHaveLength(0);
  });

  it('never starts a new attempt while a previous one could still succeed (randomized)', async () => {
    // `proven` tells, independently of the engine, whether the provider proved that
    // no money moved. The engine's own labels are deliberately not trusted here.
    type Outcome = { proven: boolean; run: () => Promise<ProviderResult> };
    type Status = { proven: boolean; run: () => Promise<StatusResult> };

    const outcomes: Outcome[] = [
      { proven: false, run: pending },
      { proven: false, run: async () => ({ status: 'succeeded' }) },
      { proven: false, run: async () => ({ status: 'unknown' }) },
      { proven: false, run: async () => ({ status: 'failed' }) },
      {
        proven: false,
        run: async () => ({ status: 'failed', error: new PayenvError('CUSTOMER_DECLINED', 'no') }),
      },
      {
        proven: true,
        run: async () => ({ status: 'failed', error: new PayenvError('RATE_LIMITED', 'slow') }),
      },
      {
        proven: true,
        run: async () => {
          throw new PayenvError('PROVIDER_UNAVAILABLE', 'down');
        },
      },
      {
        proven: false,
        run: async () => {
          throw new PayenvError('TIMEOUT', 'timeout');
        },
      },
      {
        proven: false,
        run: async () => {
          throw new Error('boom');
        },
      },
    ];
    const statuses: Status[] = [
      { proven: true, run: async () => ({ found: false }) },
      { proven: false, run: async () => ({ found: true, status: 'pending' }) },
      { proven: false, run: async () => ({ found: true, status: 'unknown' }) },
      { proven: false, run: async () => ({ found: true, status: 'succeeded' }) },
      {
        proven: true,
        run: async () => ({
          found: true,
          status: 'failed',
          error: new PayenvError('PROVIDER_UNAVAILABLE', 'rejected'),
        }),
      },
      {
        proven: false,
        run: async () => {
          throw new Error('status down');
        },
      },
    ];

    let seed = 42;
    const random = (max: number) => {
      seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
      return seed % max;
    };
    const pick = <T>(items: readonly T[]): T => items[random(items.length)] as T;

    let fallbacksSeen = 0;
    for (let run = 0; run < 500; run++) {
      const provenSafe = new Map<string, boolean>();
      const connectors = ['a', 'b', 'c'].map((id) =>
        fakeConnector(
          id,
          () => {
            const outcome = pick(outcomes);
            provenSafe.set(id, outcome.proven);
            return outcome.run();
          },
          () => {
            const status = pick(statuses);
            if (status.proven) provenSafe.set(id, true);
            return status.run();
          },
        ),
      );
      const payment = await createPayenv({ connectors, ...fast }).collect(mtnRequest());

      // Every connector followed by another attempt must have proven no money moved.
      for (const attempt of payment.attempts.slice(0, -1)) {
        expect(provenSafe.get(attempt.connectorId)).toBe(true);
        fallbacksSeen += 1;
      }
      for (const connector of connectors) {
        expect(connector.collectCalls.length).toBeLessThanOrEqual(1);
      }
    }
    // Make sure the randomized scenarios actually exercise fallbacks.
    expect(fallbacksSeen).toBeGreaterThan(50);
  });
});
