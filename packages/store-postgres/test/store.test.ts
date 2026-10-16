import { type Connector, createPayenv, type Payment } from '@payenv/core';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPostgresStore, type Queryable, schemaSql } from '../src/index.js';

// Database tests are opt-in: set PAYENV_TEST_DATABASE_URL (a throwaway database).
const databaseUrl = process.env.PAYENV_TEST_DATABASE_URL;

let counter = 0;

function payment(overrides: Partial<Payment> = {}): Payment {
  counter += 1;
  const at = new Date(Date.UTC(2026, 9, 16, 12, 0, counter)).toISOString();
  return {
    id: `pay_${counter}`,
    idempotencyKey: `order_${counter}_${Math.random().toString(36).slice(2)}`,
    operation: 'collect',
    status: 'pending',
    amount: { value: 5000, currency: 'XOF' },
    method: { type: 'mobile_money', network: 'mtn', country: 'BJ', phone: '+22990000000' },
    connectorId: 'fedapay',
    providerRef: `prov_${counter}`,
    attempts: [],
    fingerprint: 'fp',
    createdAt: at,
    updatedAt: at,
    ...overrides,
  };
}

describe('postgres store — without a database', () => {
  const fake = (rows: Record<string, unknown>[] = []) => {
    const calls: { text: string; values: unknown[] | undefined }[] = [];
    const client: Queryable = {
      async query(text, values) {
        calls.push({ text, values });
        return { rows, rowCount: rows.length };
      },
    };
    return { client, calls };
  };

  it('refuses table names that are not plain identifiers', () => {
    const { client } = fake();
    expect(() => createPostgresStore({ client, table: 'payments; drop table x' })).toThrow(
      /Invalid table name/,
    );
    expect(() => createPostgresStore({ client, table: 'a.b.c' })).toThrow(/Invalid table name/);
    expect(() => createPostgresStore({ client, table: 'billing.payments' })).not.toThrow();
  });

  it('quotes the table and its indexes in the schema', () => {
    const sql = schemaSql('billing.payments');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "billing"."payments"');
    expect(sql).toContain('"payments_provider_ref_idx" ON "billing"."payments"');
  });

  it('reads payments returned as JSON text by other drivers', async () => {
    const stored = payment();
    const { client } = fake([{ payment: JSON.stringify(stored) }]);
    expect(await createPostgresStore({ client }).get(stored.idempotencyKey)).toEqual(stored);
  });

  it('sends values as parameters, never in the SQL text', async () => {
    const stored = payment({ idempotencyKey: "o'; drop table x; --" });
    const { client, calls } = fake();
    await createPostgresStore({ client }).create(stored);
    expect(calls[0]?.text).not.toContain('drop table');
    expect(calls[0]?.values?.[0]).toBe(stored.idempotencyKey);
  });
});

describe.skipIf(!databaseUrl)('postgres store — real database', () => {
  let pool: pg.Pool;
  const tables: string[] = [];

  async function freshStore() {
    const table = `payenv_test_${Date.now()}_${tables.length}`;
    tables.push(table);
    const store = createPostgresStore({ client: pool, table });
    await store.migrate();
    return store;
  }

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: databaseUrl, max: 20 });
  });

  afterAll(async () => {
    for (const table of tables) await pool.query(`DROP TABLE IF EXISTS "${table}"`);
    await pool.end();
  });

  it('migrates more than once', async () => {
    const store = await freshStore();
    await expect(store.migrate()).resolves.toBeUndefined();
  });

  it('stores and reads a payment unchanged', async () => {
    const store = await freshStore();
    const stored = payment({ metadata: { cart: '42' }, customer: { firstName: 'Ada' } });
    expect(await store.create(stored)).toBe(true);
    expect(await store.get(stored.idempotencyKey)).toEqual(stored);
    expect(await store.get('missing')).toBeUndefined();
  });

  it('lets exactly one of many concurrent creates win', async () => {
    const store = await freshStore();
    const key = 'order_race';
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        store.create(payment({ idempotencyKey: key, id: `pay_race_${index}` })),
      ),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('updates a payment and its indexed columns', async () => {
    const store = await freshStore();
    const stored = payment({ providerRef: undefined });
    await store.create(stored);
    await store.update({ ...stored, status: 'succeeded', providerRef: 'prov_late' });

    expect((await store.get(stored.idempotencyKey))?.status).toBe('succeeded');
    expect((await store.findByProviderRef('fedapay', 'prov_late'))?.id).toBe(stored.id);
  });

  it('never moves a settled payment back, even with a stale write', async () => {
    const store = await freshStore();
    const stored = payment();
    await store.create(stored);
    await store.update({ ...stored, status: 'succeeded' });

    await store.update({ ...stored, status: 'pending' }); // a slower refresh, read earlier

    expect((await store.get(stored.idempotencyKey))?.status).toBe('succeeded');
  });

  it('finds a payment from a provider reference', async () => {
    const store = await freshStore();
    const stored = payment({ connectorId: 'kkiapay', providerRef: 'kk_1' });
    await store.create(stored);

    expect((await store.findByProviderRef('kkiapay', 'kk_1'))?.idempotencyKey).toBe(
      stored.idempotencyKey,
    );
    expect(await store.findByProviderRef('fedapay', 'kk_1')).toBeUndefined();
  });

  it('lists open payments to reconcile, oldest first', async () => {
    const store = await freshStore();
    const old = payment({ status: 'unknown', updatedAt: '2026-10-01T00:00:00.000Z' });
    const recent = payment({ status: 'pending', updatedAt: '2026-10-16T00:00:00.000Z' });
    const other = payment({ status: 'requires_action', connectorId: 'cinetpay' });
    const settled = payment({ status: 'failed' });
    for (const each of [recent, settled, other, old]) await store.create(each);

    const open = await store.listOpen();
    expect(open.map((each) => each.id)).toEqual([old.id, recent.id, other.id]);
    expect(
      (await store.listOpen({ updatedBefore: new Date('2026-10-10') })).map((each) => each.id),
    ).toEqual([old.id]);
    expect((await store.listOpen({ connectorId: 'cinetpay' })).map((each) => each.id)).toEqual([
      other.id,
    ]);
    expect(await store.listOpen({ limit: 1 })).toHaveLength(1);
  });

  it('charges once when two servers receive the same order', async () => {
    let charges = 0;
    const connector: Connector = {
      id: 'acme',
      capabilities: () => [
        { operation: 'collect', method: 'mobile_money', currencies: ['XOF'], countries: ['BJ'] },
      ],
      async collect() {
        charges += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { status: 'pending', providerRef: `acme_${charges}` };
      },
      getStatus: async () => ({ found: false }),
    };
    const store = await freshStore();
    // Two Payenv instances sharing one database, like two app servers.
    const [a, b] = [
      createPayenv({ connectors: [connector], store }),
      createPayenv({ connectors: [connector], store }),
    ];
    const request = {
      amount: { value: 5000, currency: 'XOF' },
      method: { type: 'mobile_money', network: 'mtn', country: 'BJ', phone: '+22990000000' },
      idempotencyKey: 'order_shared',
    } as const;

    const [first, second] = await Promise.all([a.collect(request), b.collect(request)]);

    expect(charges).toBe(1);
    expect(first.id).toBe(second.id);
    expect((await store.get('order_shared'))?.status).toBe('pending');
  });
});
