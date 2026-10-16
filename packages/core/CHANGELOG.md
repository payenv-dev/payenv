# @payenv/core

## 0.3.0

### Minor Changes

- 5a1004c: CinetPay connector.
  
  - `@payenv/connector-cinetpay` (new): collections with CinetPay's API v1 in Benin, Burkina
    Faso, Côte d'Ivoire, Mali, Niger, Senegal, Togo, Cameroon and Guinea, by direct push
    (`mobile_money`) or CinetPay's hosted page (`hosted_page`, `redirect` next action). Status
    lookups by merchant reference, so a push that timed out is checked before any fallback.
  - `@payenv/core`: `refresh` keeps a payment's next action (e.g. a redirect URL) while the
    provider still reports `requires_action` without a new one.
- 2b7a7cd: Payouts.
  
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
