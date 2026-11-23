# @payenv/store-postgres

PostgreSQL store for [Payenv](https://github.com/payenv-dev/payenv). Use it in production
instead of the default in-memory store, so idempotency survives restarts and is shared by
all your app servers.

> 🚧 Pre-release (`0.x`). The API may change.

```sh
npm install @payenv/store-postgres pg
```

```ts
import pg from 'pg';
import { createPayenv } from '@payenv/core';
import { createPostgresStore } from '@payenv/store-postgres';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const store = createPostgresStore({ client: pool });
await store.migrate(); // creates the table if needed; safe at every start

const payenv = createPayenv({ connectors, store });
```

## Guarantees

- **One charge per idempotency key, across servers.** `create` relies on the table's
  primary key (`INSERT … ON CONFLICT DO NOTHING`): when two servers receive the same order
  at the same time, exactly one starts the payment; the other gets the same payment back.
- **Settled payments stay settled.** If two `refresh` calls race, a slower one can no
  longer write `pending` over `succeeded`: a payment in a terminal status only accepts
  writes that keep that status.
- **Values are always sent as query parameters.** The table name is checked to be a plain
  identifier (optionally `schema.table`).

## Webhooks and reconciliation

Two helpers beyond the `Store` interface:

```ts
// A webhook gives you the provider's transaction id: find the payment, then refresh it.
const payment = await store.findByProviderRef('fedapay', event.providerRef);
if (payment) await payenv.refresh(payment.idempotencyKey);

// A periodic job: reconcile payments that are not settled yet (pending, unknown…).
for (const open of await store.listOpen({ updatedBefore: new Date(Date.now() - 5 * 60_000) })) {
  await payenv.refresh(open.idempotencyKey);
}
```

## Schema

One table (default `payenv_payments`). The whole payment is kept in a `jsonb` column; the
fields used for lookups have their own indexed columns:

| Column | Type | |
|---|---|---|
| `idempotency_key` | `text` | Primary key |
| `id` | `text` | Payenv payment id, unique |
| `operation`, `status` | `text` | `collect` / `payout`; current status |
| `connector_id`, `provider_ref` | `text` | Indexed together, for webhooks |
| `payment` | `jsonb` | The full `Payment` |
| `created_at`, `updated_at` | `timestamptz` | Partial index on open payments |

Prefer your own migration tool? `schemaSql(table)` returns the SQL that `migrate()` runs.

## Options

| Option | Default | Description |
|---|---|---|
| `client` | — | A `pg` `Pool` (recommended) or `Client`, or anything with `query(text, values)`. Required. |
| `table` | `'payenv_payments'` | Table name, optionally `schema.table`. |

Other drivers work through a small adapter returning `{ rows, rowCount }`. Tested with
PostgreSQL 16; only features available since PostgreSQL 9.5 are used.

License: Apache-2.0
