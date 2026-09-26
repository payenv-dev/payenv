import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyFedaPayWebhook } from '../src/index.js';

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
