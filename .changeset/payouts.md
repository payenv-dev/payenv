---
'@payenv/core': minor
'@payenv/connector-fedapay': minor
---

Payouts.

- `@payenv/core`: `payenv.payout({ amount, recipient, idempotencyKey })` sends money with the
  same guarantees as collections (idempotency, fallback only when it is proven that no money
  was sent). New error code `INSUFFICIENT_BALANCE`.
- `@payenv/connector-fedapay`: payouts in Benin (MTN, Moov, Celtiis) and payout status
  lookups. "Opération non autorisée" with HTTP 403 now maps to `ROUTE_UNSUPPORTED`.
