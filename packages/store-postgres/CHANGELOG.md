# @payenv/store-postgres

## 0.3.0

### Minor Changes

- e3a9dc9: New package: PostgreSQL store. `createPostgresStore({ client: pool })` with `migrate()`,
  an atomic `create` (one charge per idempotency key across servers), updates that never
  move a settled payment back, `findByProviderRef` for webhooks and `listOpen` for
  reconciliation jobs.

### Patch Changes

- Updated dependencies [5a1004c]
- Updated dependencies [2b7a7cd]
  - @payenv/core@0.3.0
