import { describe, expect, it } from 'vitest';
import {
  type AttemptContext,
  type Capability,
  type Connector,
  createPayenv,
  PayenvError,
  type PayoutRequest,
  type ProviderResult,
  type StatusQuery,
  type StatusResult,
} from '../src/index.js';
import { MTN_BJ_XOF, mtnRequest, pending } from './helpers.js';

const fast = { statusCheckDelaysMs: [0], attemptTimeoutMs: 50 };
const PAYOUT_ROUTE: Capability = { ...MTN_BJ_XOF, operation: 'payout' };

interface PayoutConnector extends Connector {
  payoutCalls: AttemptContext[];
  statusQueries: StatusQuery[];
}

function payoutConnector(
  id: string,
  payout: (context: AttemptContext) => Promise<ProviderResult>,
  getStatus: (query: StatusQuery) => Promise<StatusResult> = async () => ({ found: false }),
): PayoutConnector {
  const connector: PayoutConnector = {
    id,
    payoutCalls: [],
    statusQueries: [],
    capabilities: () => [MTN_BJ_XOF, PAYOUT_ROUTE],
    collect: pending,
    async payout(_request, context) {
      connector.payoutCalls.push(context);
      return payout(context);
    },
    async getStatus(query) {
      connector.statusQueries.push(query);
      return getStatus(query);
    },
  };
  return connector;
}

let counter = 0;
function payoutRequest(overrides: Partial<PayoutRequest> = {}): PayoutRequest {
  counter += 1;
  return {
    amount: { value: 2000, currency: 'XOF' },
    recipient: { type: 'mobile_money', network: 'mtn', country: 'BJ', phone: '+22990000000' },
    customer: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' },
    idempotencyKey: `payout_${counter}`,
    ...overrides,
  };
}

const sent = async (): Promise<ProviderResult> => ({ status: 'pending', providerRef: 'po_1' });

describe('payouts', () => {
  it('are sent through the connector payout method', async () => {
    const a = payoutConnector('a', sent);
    const payment = await createPayenv({ connectors: [a], ...fast }).payout(payoutRequest());

    expect(payment).toMatchObject({ operation: 'payout', status: 'pending', providerRef: 'po_1' });
    expect(payment.method).toMatchObject({ type: 'mobile_money', phone: '+22990000000' });
    expect(a.payoutCalls).toHaveLength(1);
  });

  it('never use connectors that cannot send payouts', async () => {
    const collectOnly: Connector = {
      id: 'collect-only',
      // Even if it wrongly declares a payout route, it has no payout method.
      capabilities: () => [MTN_BJ_XOF, PAYOUT_ROUTE],
      collect: pending,
      getStatus: async () => ({ found: false }),
    };
    const payenv = createPayenv({ connectors: [collectOnly], ...fast });
    await expect(payenv.payout(payoutRequest())).rejects.toMatchObject({ code: 'NO_ROUTE' });
  });

  it('fall back when the merchant balance at the first provider is insufficient', async () => {
    const empty = payoutConnector('empty', async () => {
      throw new PayenvError('INSUFFICIENT_BALANCE', 'Solde insuffisant');
    });
    const funded = payoutConnector('funded', sent);
    const payment = await createPayenv({ connectors: [empty, funded], ...fast }).payout(
      payoutRequest(),
    );

    expect(payment.connectorId).toBe('funded');
    expect(payment.attempts.map((attempt) => attempt.outcome)).toEqual(['fell_back', 'accepted']);
  });

  it('never send twice when the provider does not answer (double-payout protection)', async () => {
    const slow = payoutConnector(
      'slow',
      (context) => {
        context.reportProviderRef('po_42');
        return new Promise(() => {}); // the "send" call never answers
      },
      async (query) => ({ found: true, status: 'pending', providerRef: query.providerRef }),
    );
    const other = payoutConnector('other', sent);
    const payment = await createPayenv({ connectors: [slow, other], ...fast }).payout(
      payoutRequest(),
    );

    expect(payment.status).toBe('pending');
    expect(payment.connectorId).toBe('slow');
    expect(slow.statusQueries[0]).toMatchObject({ operation: 'payout', providerRef: 'po_42' });
    expect(other.payoutCalls).toHaveLength(0);
  });

  it('are idempotent', async () => {
    const a = payoutConnector('a', sent);
    const payenv = createPayenv({ connectors: [a], ...fast });
    const request = payoutRequest();

    const [first, second] = await Promise.all([payenv.payout(request), payenv.payout(request)]);

    expect(second.id).toBe(first.id);
    expect(a.payoutCalls).toHaveLength(1);
  });

  it('cannot reuse the key of a collection', async () => {
    const payenv = createPayenv({ connectors: [payoutConnector('a', sent)], ...fast });
    const collected = mtnRequest({ amount: { value: 2000, currency: 'XOF' } });
    await payenv.collect(collected);

    await expect(
      payenv.payout(payoutRequest({ idempotencyKey: collected.idempotencyKey })),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });

  it('are refreshed with a payout status lookup', async () => {
    const a = payoutConnector('a', sent, async () => ({ found: true, status: 'succeeded' }));
    const payenv = createPayenv({ connectors: [a], ...fast });
    const request = payoutRequest();
    await payenv.payout(request);

    expect((await payenv.refresh(request.idempotencyKey)).status).toBe('succeeded');
    expect(a.statusQueries.at(-1)?.operation).toBe('payout');
  });

  it('cannot be confirmed like widget collections', async () => {
    const payenv = createPayenv({ connectors: [payoutConnector('a', sent)], ...fast });
    const request = payoutRequest();
    await payenv.payout(request);
    await expect(payenv.confirm(request.idempotencyKey, 'po_x')).rejects.toBeInstanceOf(
      PayenvError,
    );
  });
});
