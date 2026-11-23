import { type Operation, PayenvError, type Payment, type Store } from '@payenv/core';

/**
 * The only thing the store needs from a PostgreSQL client: a parameterized query.
 * A `pg` `Pool` or `Client` fits as is.
 */
export interface Queryable {
  query(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
}

export interface PostgresStoreOptions {
  /** A `pg` `Pool` (recommended), `Client`, or anything with the same `query` method. */
  client: Queryable;
  /** Table name, optionally schema-qualified. Defaults to `payenv_payments`. */
  table?: string;
}

export interface ListOpenOptions {
  /** Only payments not updated since this date (e.g. 5 minutes ago). */
  updatedBefore?: Date;
  /** Only this connector's payments. */
  connectorId?: string;
  /** Defaults to 100. */
  limit?: number;
}

export interface PostgresStore extends Store {
  /** Creates the table and its indexes if they do not exist. Safe to run at every start. */
  migrate(): Promise<void>;
  /**
   * Finds a payment from a provider's transaction id, e.g. the `providerRef` of a
   * webhook. Pass it to `payenv.refresh(payment.idempotencyKey)`.
   */
  findByProviderRef(connectorId: string, providerRef: string): Promise<Payment | undefined>;
  /**
   * Payments that are not settled yet (`pending`, `requires_action`, `unknown`), oldest
   * update first: call `payenv.refresh` on each of them to reconcile.
   */
  listOpen(options?: ListOpenOptions): Promise<Payment[]>;
}

/** Statuses a payment can still leave. */
const OPEN_STATUSES = ['created', 'pending', 'requires_action', 'unknown'] as const;
const TERMINAL_STATUSES = ['succeeded', 'failed', 'canceled', 'expired'] as const;

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;

/** SQL that creates the table and its indexes (what `migrate` runs). */
export function schemaSql(table = 'payenv_payments'): string {
  const name = quoteTable(table);
  const base = table.split('.').at(-1) as string;
  const index = (suffix: string) => quoteIdentifier(`${base}_${suffix}`.slice(0, 63));
  return `CREATE TABLE IF NOT EXISTS ${name} (
  idempotency_key text PRIMARY KEY,
  id text NOT NULL UNIQUE,
  operation text NOT NULL,
  status text NOT NULL,
  connector_id text,
  provider_ref text,
  payment jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS ${index('provider_ref_idx')} ON ${name} (connector_id, provider_ref);
CREATE INDEX IF NOT EXISTS ${index('open_idx')} ON ${name} (updated_at)
  WHERE status IN (${OPEN_STATUSES.map((status) => `'${status}'`).join(', ')});`;
}

/**
 * A PostgreSQL {@link Store}. Payments are kept whole in a `jsonb` column, with the fields
 * Payenv and your reconciliation jobs search on in their own indexed columns.
 *
 * - `create` relies on the primary key (`INSERT … ON CONFLICT DO NOTHING`): when two
 *   requests race with the same idempotency key, exactly one wins, across all instances.
 * - `update` never moves a payment out of a terminal status, even if two `refresh` calls
 *   race: the stale write is ignored.
 */
export function createPostgresStore(options: PostgresStoreOptions): PostgresStore {
  const { client } = options;
  if (!client || typeof client.query !== 'function') {
    throw new PayenvError('INVALID_REQUEST', 'A PostgreSQL client with a query method is required');
  }
  const table = options.table ?? 'payenv_payments';
  const name = quoteTable(table);
  const columns =
    'idempotency_key, id, operation, status, connector_id, provider_ref, payment, created_at, updated_at';

  return {
    async migrate() {
      await client.query(schemaSql(table));
    },

    async create(payment) {
      const result = await client.query(
        `INSERT INTO ${name} (${columns})
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (idempotency_key) DO NOTHING`,
        values(payment),
      );
      return result.rowCount === 1;
    },

    async get(idempotencyKey) {
      const result = await client.query(`SELECT payment FROM ${name} WHERE idempotency_key = $1`, [
        idempotencyKey,
      ]);
      return toPayment(result.rows[0]);
    },

    async update(payment) {
      // A row already in a terminal status only accepts writes that keep that status.
      const [key, , , status, connectorId, providerRef, json, , updatedAt] = values(payment);
      await client.query(
        `UPDATE ${name}
         SET status = $2, connector_id = $3, provider_ref = $4, payment = $5, updated_at = $6
         WHERE idempotency_key = $1
           AND (status NOT IN (${TERMINAL_STATUSES.map((each) => `'${each}'`).join(', ')})
                OR status = $2)`,
        [key, status, connectorId, providerRef, json, updatedAt],
      );
    },

    async findByProviderRef(connectorId, providerRef) {
      const result = await client.query(
        `SELECT payment FROM ${name}
         WHERE connector_id = $1 AND provider_ref = $2
         ORDER BY created_at DESC
         LIMIT 1`,
        [connectorId, providerRef],
      );
      return toPayment(result.rows[0]);
    },

    async listOpen(filters = {}) {
      const conditions = [`status IN (${OPEN_STATUSES.map((status) => `'${status}'`).join(', ')})`];
      const params: unknown[] = [];
      if (filters.updatedBefore) {
        params.push(filters.updatedBefore.toISOString());
        conditions.push(`updated_at < $${params.length}`);
      }
      if (filters.connectorId) {
        params.push(filters.connectorId);
        conditions.push(`connector_id = $${params.length}`);
      }
      params.push(filters.limit ?? 100);
      const result = await client.query(
        `SELECT payment FROM ${name}
         WHERE ${conditions.join(' AND ')}
         ORDER BY updated_at
         LIMIT $${params.length}`,
        params,
      );
      return result.rows.map((row) => toPayment(row) as Payment);
    },
  };
}

function values(payment: Payment): unknown[] {
  const operation: Operation = payment.operation;
  return [
    payment.idempotencyKey,
    payment.id,
    operation,
    payment.status,
    payment.connectorId ?? null,
    payment.providerRef ?? null,
    JSON.stringify(payment),
    payment.createdAt,
    payment.updatedAt,
  ];
}

function toPayment(row: Record<string, unknown> | undefined): Payment | undefined {
  if (!row) return undefined;
  // `pg` parses jsonb; other drivers may return the text.
  const payment = typeof row.payment === 'string' ? JSON.parse(row.payment) : row.payment;
  return payment as Payment;
}

function quoteTable(table: string): string {
  const parts = table.split('.');
  if (parts.length > 2 || !parts.every((part) => IDENTIFIER.test(part))) {
    throw new PayenvError(
      'INVALID_REQUEST',
      `Invalid table name "${table}" (letters, digits and underscores, optionally "schema.table")`,
    );
  }
  return parts.map(quoteIdentifier).join('.');
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier}"`;
}
