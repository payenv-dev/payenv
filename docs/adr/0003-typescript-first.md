# 0003. TypeScript as the first implementation

- **Status:** Accepted
- **Date:** 2026-09-26

## Context

We need one reference implementation to validate the model before specifying it
for other languages. The founder already has production experience integrating
FedaPay in TypeScript, and a large share of web and mobile back ends that integrate
African aggregators run on Node.js.

## Decision

The reference implementation is **TypeScript**. The core targets standard web APIs
(`fetch`, Web Crypto where possible), so it runs on Node.js, Deno, Bun, and edge
runtimes, with zero runtime dependencies in `@payenv/core`.

## Consequences

- Fast iteration and a strong type system for the unified model.
- Other ecosystems (PHP, Python, Go, Java/Kotlin, Dart) will wait for SDKs, guided
  by a language-neutral specification and shared test vectors.

## Alternatives considered

- **Go / Rust** — excellent for a server, less direct for in-app library use in web stacks.
- **PHP** — large footprint in the target market, a strong candidate for the second SDK.
