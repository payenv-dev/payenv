# Roadmap

*Last updated: 2026-09-26. Dates are intentions, not promises.*

## Phase 0 — Foundations (now)

- [x] Project idea, vision, license (Apache 2.0)
- [x] Initial documentation: architecture draft, contributing, security, governance
- [x] Create the GitHub organization and repository (`payenv-dev/payenv`)
- [x] Reserve the npm `@payenv` scope (all packages are published under it)
- [x] Set up a contact address for security and conduct reports
- [ ] Open discussions on the architecture draft

## Phase 1 — Core + first connector (`v0.1.0`)

- [x] TypeScript monorepo, CI, lint, tests
- [x] Release automation (Changesets + npm trusted publishing)
- [x] `@payenv/core`: unified model, error taxonomy, statuses
- [x] Router with the `priority` strategy + capability filtering
- [x] Attempt engine with the safe-fallback invariant, fully tested
- [x] In-memory store (built into `@payenv/core`)
- [x] `@payenv/connector-fedapay` (collect mobile money, status, webhook signature)
- [x] FedaPay: verified end to end in the sandbox (success and failure)
- [x] One runnable example (`examples/fedapay-demo`)
- [x] Getting-started guide
- [ ] Publish `0.1.0` to npm

## Phase 2 — Real fallback (`v0.2.0`)

- [ ] Second and third connectors (e.g. Kkiapay, CinetPay)
- [x] Payouts in the unified API (FedaPay)
- [ ] Refunds in the unified API
- [ ] `@payenv/store-postgres`
- [ ] Circuit breaker
- [ ] Normalized webhook handling with deduplication

## Phase 3 — Smart routing (`v0.3.0`)

- [ ] `weighted`, `cheapest`, `bestSuccessRate`, and `custom` strategies
- [ ] Observability hooks (OpenTelemetry-friendly)
- [ ] Connector conformance test suite (shared, reusable by any connector)

## Phase 4 — Toward `v1.0.0`

- [ ] Stable API and language-neutral specification
- [ ] External security review
- [ ] At least 6 stable connectors with named maintainers
- [ ] Documentation website

## Next ecosystem: PHP & Laravel (after `v0.2.0`)

Laravel is the most used back-end framework among our target developers after
JavaScript. Once the model is proven by 2–3 connectors:

- [ ] Language-neutral specification + shared JSON test scenarios (both implementations
      must pass the same double-charge scenarios)
- [ ] `payenv/core` — native PHP port of the model and the attempt engine
- [ ] `payenv/laravel` — config file, facade, Eloquent store, webhook route, events,
      artisan command to reconcile `unknown` payments

## Later

- Optional self-hosted server mode (HTTP API) built on the same core
- SDKs in other languages (Python, Go, Java/Kotlin, Dart)
- Reconciliation tooling
