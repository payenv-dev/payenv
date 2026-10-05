import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseFedaPayWebhook, verifyFedaPayWebhook } from '../src/index.js';

const secret = 'whsec_test';
const body = '{"name":"transaction.approved","entity":{"id":1234}}';
const now = 1_790_000_000_000;
const timestamp = String(Math.floor(now / 1000));

function sign(payload: string, t = timestamp, key = secret) {
  return `t=${t},s=${createHmac('sha256', key).update(`${t}.${payload}`).digest('hex')}`;
}

describe('verifyFedaPayWebhook', () => {
  it('accepts a valid signature', async () => {
    expect(await verifyFedaPayWebhook(body, sign(body), secret, { now })).toBe(true);
  });

  it('rejects a modified body', async () => {
    expect(await verifyFedaPayWebhook(`${body} `, sign(body), secret, { now })).toBe(false);
  });

  it('rejects a signature made with another secret', async () => {
    expect(await verifyFedaPayWebhook(body, sign(body, timestamp, 'other'), secret, { now })).toBe(
      false,
    );
  });

  it('rejects signatures older than the tolerance (replay protection)', async () => {
    const old = String(Number(timestamp) - 301);
    expect(await verifyFedaPayWebhook(body, sign(body, old), secret, { now })).toBe(false);
  });

  it.each([undefined, null, '', 'garbage', 't=abc,s=00', `s=${'0'.repeat(64)}`])(
    'rejects malformed header %s',
    async (header) => {
      expect(await verifyFedaPayWebhook(body, header, secret, { now })).toBe(false);
    },
  );

  it('rejects everything when the secret is missing', async () => {
    expect(await verifyFedaPayWebhook(body, sign(body), '', { now })).toBe(false);
  });
});

// Shape of a live `transaction.canceled` webhook (2026-10-05), with the account,
// the payer's phone number and tokens removed.
const canceledWebhook = {
  name: 'transaction.canceled',
  object: 'transaction',
  object_id: 113507195,
  account: { id: 1, klass: 'v1/account' },
  entity: {
    id: 113507195,
    reference: 'trx_test',
    amount: 100,
    status: 'canceled',
    mode: 'mtn_open',
    last_error_code: 'INSUFFICIENT_FUND_ERROR',
    last_error_message:
      '{"status":"FAILED","reason":"LOW_BALANCE_OR_PAYEE_LIMIT_REACHED_OR_NOT_ALLOWED"}',
    metadata: { expire_schedule_jobid: 'job_1' },
    expired_at: null,
  },
};

describe('parseFedaPayWebhook', () => {
  it('normalizes a canceled transaction (live shape)', () => {
    const event = parseFedaPayWebhook(JSON.stringify(canceledWebhook));
    expect(event).toMatchObject({
      name: 'transaction.canceled',
      providerRef: '113507195',
      status: 'canceled',
    });
    expect(event?.error?.toJSON()).toMatchObject({
      code: 'INSUFFICIENT_FUNDS',
      providerCode: 'INSUFFICIENT_FUND_ERROR',
    });
  });

  it('derives the status from the transaction, not from the event name', () => {
    const approved = {
      ...canceledWebhook,
      name: 'transaction.some_future_name',
      entity: { ...canceledWebhook.entity, status: 'approved', last_error_code: null },
    };
    const event = parseFedaPayWebhook(JSON.stringify(approved));
    expect(event).toMatchObject({ status: 'succeeded', providerRef: '113507195' });
    expect(event?.error).toBeUndefined();
  });

  it.each([
    'not json',
    'null',
    JSON.stringify({ name: 'payout.sent', object: 'payout', entity: { id: 1 } }),
    JSON.stringify({ name: 'transaction.created', object: 'transaction' }),
  ])('ignores bodies that are not transaction events: %s', (body) => {
    expect(parseFedaPayWebhook(body)).toBeUndefined();
  });
});
