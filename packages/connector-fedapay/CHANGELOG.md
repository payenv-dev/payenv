# @payenv/connector-fedapay

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
