# 0004. Never fall back on an ambiguous state

- **Status:** Accepted
- **Date:** 2026-09-26

## Context

Fallback is Payenv's headline feature and also its main risk. If a request to
provider A times out, A may have already pushed a mobile money prompt to the customer,
or may have already charged them. Retrying immediately on provider B can then
**charge the customer twice**.

## Decision

The attempt engine enforces this invariant:

> Payenv never starts an attempt on another connector while an attempt on a previous
> connector for the same payment could still succeed.

Concretely, errors are classified as `safe_to_fallback`, `do_not_retry`, or
`ambiguous`. An `ambiguous` result triggers a status check on the same provider.
Fallback happens only once that check proves nothing happened. Otherwise the payment
is returned as `pending` or `unknown` for the app to reconcile.

This behavior is **not configurable**.

## Consequences

- Some payments end up `unknown` instead of being "rescued". This is the correct
  trade-off: a delayed payment is better than a double charge.
- Every connector must classify its errors carefully. The conformance suite tests it.

## Alternatives considered

- **Configurable "aggressive" fallback** — rejected: a footgun in a payment library.
