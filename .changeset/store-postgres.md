---
'@payenv/store-postgres': minor
---

New package: PostgreSQL store. `createPostgresStore({ client: pool })` with `migrate()`,
an atomic `create` (one charge per idempotency key across servers), updates that never
move a settled payment back, `findByProviderRef` for webhooks and `listOpen` for
reconciliation jobs.
