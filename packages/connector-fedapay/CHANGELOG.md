# @payenv/connector-fedapay

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

### Patch Changes

- Updated dependencies [a80b939]
  - @payenv/core@0.2.0

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

### Patch Changes

- Updated dependencies
  - @payenv/core@0.1.0
