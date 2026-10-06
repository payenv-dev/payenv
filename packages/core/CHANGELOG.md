# @payenv/core

## 0.3.0

### Minor Changes

- 4daec16: Payouts.
  
  - `@payenv/core`: `payenv.payout({ amount, recipient, idempotencyKey })` sends money with the
    same guarantees as collections (idempotency, fallback only when it is proven that no money
    was sent). New error code `INSUFFICIENT_BALANCE`.
  - `@payenv/connector-fedapay`: payouts in Benin (MTN, Moov, Celtiis) and payout status
    lookups. "Opération non autorisée" with HTTP 403 now maps to `ROUTE_UNSUPPORTED`.

## 0.2.0

### Minor Changes

- a80b939: Kkiapay, and payments started by the customer in a widget.
  
  - `@payenv/core`: `nextAction.type === 'widget'`, `supportedWidgets` and
    `Capability.widget` for providers whose payments start in a widget; `payenv.confirm`
    verifies the provider transaction's merchant reference and amount before linking it.
    New error code `REFERENCE_MISMATCH`. `toE164` converts phone numbers typed by customers
    to E.164.
  - `@payenv/connector-kkiapay` (new): Kkiapay widget payments in Benin (MTN, Moov),
    server-side verification, webhook verification and parsing.

## 0.1.0

### Minor Changes

- First public pre-release.
  
  - `@payenv/core`: unified payment model, error taxonomy with retry classes and provider
    codes, capability-aware router, and the attempt engine that never falls back while a
    previous attempt could still succeed. Idempotency, `refresh`, lifecycle events, and an
    in-memory store.
  - `@payenv/connector-fedapay`: mobile money collections in Benin (MTN, Moov, Celtiis),
    status lookup with FedaPay's real error reasons, webhook verification and parsing.
    Verified in the sandbox and on live payments.
