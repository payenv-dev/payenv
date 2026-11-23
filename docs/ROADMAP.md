# Roadmap

*Last updated: 2026-11-23. Dates are intentions, not promises.*

## Phase 0 — Foundations ✅

- [x] Project idea, vision, license (Apache 2.0)
- [x] Initial documentation: architecture draft, contributing, security, governance
- [x] Create the GitHub organization and repository (`payenv-dev/payenv`)
- [x] Reserve the npm `@payenv` scope (all packages are published under it)
- [x] Set up a contact address for security and conduct reports

## Phase 1 — Core + first connector ✅ (`v0.1.0`)

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
- [x] Publish `0.1.0` to npm

## Phase 2 — First public release (now, `v0.3`)

The goal is one need that works: collecting mobile money with a safe fallback between
providers. Then we listen.

- [x] Second and third connectors (Kkiapay; CinetPay **experimental** until verified in its sandbox)
- [x] Payouts in the unified API (FedaPay; CinetPay experimental)
- [x] `@payenv/store-postgres`, and a guide to plug in any other database
- [x] `custom` routing strategies (any ordering function passed as `routing`)
- [x] Lifecycle events (`onEvent`)
- [ ] Publish `0.3.0`
- [ ] Open GitHub Discussions and share the project with developers around us

## Next — driven by your feedback

Nothing below is scheduled. What users ask for comes first: tell us in
[Discussions](https://github.com/payenv-dev/payenv/discussions) or open an issue.

- Verify CinetPay in its sandbox (then drop the experimental label)
- Refunds in the unified API
- Circuit breaker
- Normalized webhook handling with deduplication
- `weighted`, `cheapest`, and `bestSuccessRate` strategies
- OpenTelemetry helpers
- Connector conformance test suite (shared, reusable by any connector)
- More connectors (PayDunya, Flutterwave, Paystack, Stripe…)

## Toward `v1.0.0`

- [ ] Stable API and language-neutral specification
- [ ] External security review
- [ ] At least 6 stable connectors with named maintainers
- [ ] Documentation website

## Next ecosystem: PHP & Laravel (once the model is proven)

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
