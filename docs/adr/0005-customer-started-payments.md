# 0005. Payments started by the customer in a widget

- **Status:** Accepted
- **Date:** 2026-10-05

## Context

Some providers cannot start a payment from the server. With Kkiapay (and most
checkout-style aggregators), the customer starts the payment in the provider's widget,
and the server only verifies the resulting transaction. Payenv's first connector,
FedaPay, starts payments from the server (USSD push).

A front end may also be unable to open a given widget (server-only flows, USSD apps,
another platform).

## Decision

1. A connector declares widget routes with `Capability.widget`. They are only eligible
   when the request lists that widget in `CollectRequest.supportedWidgets`.
2. `collect` on such a route returns `requires_action` with
   `nextAction: { type: 'widget', provider, params }` and a `merchantReference`.
3. `payenv.confirm(idempotencyKey, providerRef)` links the provider transaction **after**
   checking with the provider that it carries the payment's merchant reference and
   amount. Otherwise it throws `REFERENCE_MISMATCH` and leaves the payment unchanged.
4. Widget routes can serve as a fallback after a server-push provider failed safely
   (ADR 0004 still applies: only a proven "no money moved" allows it).

## Consequences

- One API for both kinds of providers; most checkout-style aggregators fit this model.
- Front ends opt in explicitly, so no payment is handed to a widget nobody can open.
- `confirm` closes a classic fraud: confirming an order with another, cheaper transaction.
- Connectors whose provider does not echo a merchant reference cannot support `confirm`.

## Alternatives considered

- **Trusting the transaction id sent by the front end**: rejected, trivially abusable.
- **Calling undocumented widget endpoints from the server**: rejected, fragile and
  possibly against the provider's terms.
