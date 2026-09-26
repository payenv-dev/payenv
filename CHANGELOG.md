# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Before `1.0.0`, minor versions may contain breaking changes.

## [Unreleased]

### Added
- 2026-09-26 — `@payenv/connector-fedapay`: mobile money collections in Benin (MTN,
  Moov, Celtiis), status lookup, webhook signature verification, sandbox tests (opt-in).
- 2026-09-26 — `@payenv/core`: `AttemptContext.reportProviderRef`, so an attempt
  that times out after the provider created the transaction can still be resolved.
- 2026-09-26 — `@payenv/core`: money model (integer minor units, ISO 4217 exponents),
  payment methods, unified statuses, error taxonomy with retry classes, connector and
  capability interfaces, capability-aware router with the `priority` strategy, the
  attempt engine enforcing the safe-fallback invariant (ADR 0004), idempotency,
  `refresh`, lifecycle events, and an in-memory store.
- 2026-09-26 — TypeScript monorepo (pnpm, Vitest, Biome) and CI with DCO check.
- 2026-09-26 — Project started. Vision, architecture draft, roadmap, Apache 2.0
  license, contributing guide, code of conduct, security policy, governance, and
  initial architecture decision records.
