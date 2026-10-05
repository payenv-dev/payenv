import { describe, expect, it } from 'vitest';
import {
  type Capability,
  createPayenv,
  PayenvError,
  type ProviderResult,
  type StatusResult,
} from '../src/index.js';
import { fakeConnector, MTN_BJ_XOF, mtnRequest, pending } from './helpers.js';

const fast = { statusCheckDelaysMs: [0], attemptTimeoutMs: 50 };
const WIDGET_ROUTE: Capability = { ...MTN_BJ_XOF, widget: 'acme' };

/** A connector whose payments start in the "acme" widget, like Kkiapay. */
function widgetConnector(
  transaction: (providerRef: string) => StatusResult = () => ({ found: false }),
) {
  return fakeConnector(
    'acme',
    async (request): Promise<ProviderResult> => ({
      status: 'requires_action',
      merchantReference: request.idempotencyKey,
      nextAction: { type: 'widget', provider: 'acme', params: { amount: request.amount.value } },
    }),
    async (query) => transaction(query.providerRef ?? ''),
    [WIDGET_ROUTE],
  );
}

/** What the provider reports for a genuine transaction of this payment. */
const genuine =
  (key: string, value = 5000) =>
  (providerRef: string): StatusResult => ({
    found: true,
    status: 'succeeded',
    providerRef,
    merchantReference: key,
    amount: { value, currency: 'XOF' },
  });

describe('widget routes', () => {
  it('are not used unless the front end supports the widget', async () => {
    const payenv = createPayenv({ connectors: [widgetConnector()], ...fast });
    await expect(payenv.collect(mtnRequest())).rejects.toMatchObject({ code: 'NO_ROUTE' });
  });

  it('return a widget action when the front end supports it', async () => {
    const acme = widgetConnector();
    const payenv = createPayenv({ connectors: [acme], ...fast });
    const request = mtnRequest({ supportedWidgets: ['acme'] });

    const payment = await payenv.collect(request);

    expect(payment.status).toBe('requires_action');
    expect(payment.nextAction).toEqual({
      type: 'widget',
      provider: 'acme',
      params: { amount: 5000 },
    });
    expect(payment.attempts[0]?.merchantReference).toBe(request.idempotencyKey);
    // Nothing to look up until the customer completes the widget.
    expect((await payenv.refresh(request.idempotencyKey)).status).toBe('requires_action');
    expect(acme.statusCalls).toHaveLength(0);
  });

  it('are a fallback when a server-push provider fails safely', async () => {
    const down = fakeConnector('push', async () => {
      throw new PayenvError('PROVIDER_UNAVAILABLE', 'down');
    });
    const payenv = createPayenv({ connectors: [down, widgetConnector()], ...fast });

    const payment = await payenv.collect(mtnRequest({ supportedWidgets: ['acme'] }));

    expect(payment.connectorId).toBe('acme');
    expect(payment.status).toBe('requires_action');
    expect(payment.attempts.map((attempt) => attempt.outcome)).toEqual(['fell_back', 'accepted']);
  });

  it('come after server-push providers when both work', async () => {
    const push = fakeConnector('push', pending);
    const payenv = createPayenv({ connectors: [push, widgetConnector()], ...fast });
    const payment = await payenv.collect(mtnRequest({ supportedWidgets: ['acme'] }));
    expect(payment.connectorId).toBe('push');
  });
});

describe('confirm', () => {
  async function started(transaction?: (providerRef: string) => StatusResult) {
    const request = mtnRequest({ supportedWidgets: ['acme'] });
    const payenv = createPayenv({
      connectors: [widgetConnector(transaction ?? genuine(request.idempotencyKey))],
      ...fast,
    });
    await payenv.collect(request);
    return { payenv, key: request.idempotencyKey };
  }

  it('links the provider transaction and updates the status', async () => {
    const { payenv, key } = await started();

    const payment = await payenv.confirm(key, 'tx_1');

    expect(payment.status).toBe('succeeded');
    expect(payment.providerRef).toBe('tx_1');
    expect(payment.attempts[0]).toMatchObject({ providerRef: 'tx_1', outcome: 'accepted' });
    expect(payment.nextAction).toBeUndefined();
  });

  it('is idempotent with the same transaction', async () => {
    const { payenv, key } = await started();
    await payenv.confirm(key, 'tx_1');
    expect((await payenv.confirm(key, 'tx_1')).status).toBe('succeeded');
  });

  it('rejects a transaction of another payment (fraud attempt)', async () => {
    const { payenv, key } = await started(genuine('someone_elses_order'));

    await expect(payenv.confirm(key, 'tx_other')).rejects.toMatchObject({
      code: 'REFERENCE_MISMATCH',
    });
    const payment = await payenv.getPayment(key);
    expect(payment?.status).toBe('requires_action');
    expect(payment?.providerRef).toBeUndefined();
  });

  it('rejects a transaction for a smaller amount (fraud attempt)', async () => {
    const request = mtnRequest({ supportedWidgets: ['acme'] });
    const payenv = createPayenv({
      connectors: [widgetConnector(genuine(request.idempotencyKey, 100))],
      ...fast,
    });
    await payenv.collect(request);

    await expect(payenv.confirm(request.idempotencyKey, 'tx_cheap')).rejects.toMatchObject({
      code: 'REFERENCE_MISMATCH',
    });
    expect((await payenv.getPayment(request.idempotencyKey))?.status).toBe('requires_action');
  });

  it('rejects a transaction the provider does not know', async () => {
    const { payenv, key } = await started(() => ({ found: false }));
    await expect(payenv.confirm(key, 'tx_bogus')).rejects.toMatchObject({
      code: 'PAYMENT_NOT_FOUND',
    });
    expect((await payenv.getPayment(key))?.status).toBe('requires_action');
  });

  it('rejects a second, different transaction once linked', async () => {
    const { payenv, key } = await started();
    await payenv.confirm(key, 'tx_1');
    await expect(payenv.confirm(key, 'tx_2')).rejects.toMatchObject({
      code: 'REFERENCE_MISMATCH',
    });
  });

  it('refuses payments whose connector attached no merchant reference', async () => {
    const payenv = createPayenv({
      connectors: [fakeConnector('push', async () => ({ status: 'requires_action' }))],
      ...fast,
    });
    const request = mtnRequest();
    await payenv.collect(request);
    await expect(payenv.confirm(request.idempotencyKey, 'tx_1')).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
  });
});
