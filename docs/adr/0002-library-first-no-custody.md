# 0002. Library first, no custody of funds or secrets

- **Status:** Accepted
- **Date:** 2026-09-26

## Context

Payment orchestration can be offered as a hosted service (a middleman receiving
all traffic) or as code running inside the integrator's app. A hosted middleman
must be trusted with credentials and becomes a single point of failure — the very
problem Payenv wants to remove.

## Decision

Payenv is first and foremost a **library** that runs in the integrator's process.
It never holds funds, and credentials never leave the integrator's infrastructure.
A self-hosted server mode may be built later on top of the same core.

## Consequences

- No infrastructure to run for the project, and no legal status as a payment operator.
- Integrators keep full control of their data and keys.
- State (idempotency, attempts) needs a pluggable store owned by the integrator.
- Cross-language support needs SDKs or a later server mode.

## Alternatives considered

- **Hosted SaaS** — a central point of failure and of trust; requires funding and
  compliance; contradicts "free forever".
- **Server-only (self-hosted)** — heavier to adopt for small teams; kept as a later option.
