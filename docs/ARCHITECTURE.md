# Architecture

*Status: draft, 2026-09-26. Everything here is open for discussion — open an issue.*

This document describes the core concepts of Payenv, independently of the final code.

```
                 ┌──────────────────────────────────────────────┐
  your app  ───► │                  Payenv core                 │
                 │                                              │
                 │  Unified API ─► Router ─► Attempt engine ──┐ │
                 │       ▲           │                        │ │
                 │       │      capabilities                  │ │
                 │   Webhook          │                        │ │
                 │   normalizer  ┌────┴─────┬──────────┐       │ │
                 │       ▲       ▼          ▼          ▼       │ │
                 │       │   Connector  Connector  Connector ◄─┘ │
                 │       │   (FedaPay)  (Kkiapay)  (CinetPay)    │
                 │       │                                       │
                 │     Store (idempotency, attempts) — pluggable │
                 └───────┼───────────┼──────────┼───────────────┘
                         │           ▼          ▼
                   provider      provider   provider APIs
                   webhooks
```

## 1. Unified model

### Money

- Amounts are **integers in the currency's minor unit** (ISO 4217 exponent).
  `XOF` has 0 decimals → `5000` means 5000 FCFA. `EUR` has 2 → `1250` means €12.50.
- Currencies are ISO 4217 codes. Countries are ISO 3166-1 alpha-2 codes.
- Floats are never used for money.

### Operations

| Operation | Description |
|---|---|
| `collect` | Take money from a customer (mobile money push, card, bank…). |
| `payout` | Send money to a recipient (disbursement). |
| `refund` | Return all or part of a collected payment. |
| `getStatus` | Fetch the current state of a payment from the provider. |

### Payment methods

A method describes *how* the customer pays, independently of the provider:

```ts
{ type: 'mobile_money', network: 'mtn' | 'moov' | 'orange' | 'wave' | 'celtiis' | ..., country: 'BJ', phone: '+229...' }
{ type: 'card', token: '...' }          // token from the provider's hosted fields
{ type: 'bank_transfer', ... }
{ type: 'hosted_page' }                 // redirect to the provider's checkout
```

Network identifiers are **Payenv's own**, stable, and documented. Each connector
maps them to the provider's slugs (e.g. FedaPay uses `mtn_open` for collections
and `mtn` for payouts; the app never needs to know).

### Unified statuses

```
created ─► pending ─► requires_action ─► succeeded
                 │                   └─► failed
                 ├─► failed
                 ├─► canceled
                 ├─► expired
                 └─► unknown   (ambiguous — must be resolved, see §4)
```

`succeeded`, `failed`, `canceled`, and `expired` are **terminal**.

### Error taxonomy

Every provider error is mapped to a normalized code, and each code carries a
**retry class**:

| Code (examples) | Retry class | Meaning |
|---|---|---|
| `PROVIDER_UNAVAILABLE`, `RATE_LIMITED` | `safe_to_fallback` | The request was rejected before any money moved. |
| `ROUTE_UNSUPPORTED` (network/country/currency not enabled) | `safe_to_fallback` | This provider can't serve this route. |
| `AUTHENTICATION_FAILED` | `safe_to_fallback` + alert | Misconfiguration on the integrator's side. |
| `INSUFFICIENT_FUNDS`, `CUSTOMER_DECLINED`, `INVALID_PHONE` | `do_not_retry` | The customer's situation — another provider won't change it. |
| `TIMEOUT`, `CONNECTION_RESET_AFTER_SEND` | `ambiguous` | The provider may have processed it. **Never fall back blindly.** |

The original provider error is always kept in `error.raw` for debugging.

## 2. Connectors

A connector is an adapter for one aggregator. It is the **only** place with
provider-specific code.

```ts
interface Connector {
  id: string;                                  // 'fedapay'
  capabilities(): Capability[];                // what routes it can serve
  collect(req: CollectRequest, ctx: Context): Promise<ProviderResult>;
  payout?(req: PayoutRequest, ctx: Context): Promise<ProviderResult>;
  refund?(req: RefundRequest, ctx: Context): Promise<ProviderResult>;
  getStatus(ref: ProviderRef, ctx: Context): Promise<ProviderResult>;
  webhooks: {
    verify(rawBody: string, headers: Headers): boolean;
    parse(rawBody: string): NormalizedEvent;
  };
  mapError(err: unknown): PayenvError;
}
```

A **capability** declares a route the connector can serve:

```ts
{ operation: 'collect', method: 'mobile_money', network: 'mtn', country: 'BJ', currencies: ['XOF'] }
```

Declared capabilities are the maximum. The integrator can narrow them in their
configuration (for example, when an operator is not activated on their merchant account).

Connector rules:
- No global state; credentials are passed in through configuration.
- No logging of secrets, full phone numbers, or personal data (mask them).
- Every connector ships with sandbox-based tests and documents its quirks.

## 3. Router

For each request, the router:

1. **Filters** connectors by capability (operation, method, network, country, currency).
2. **Orders** the remaining ones using a strategy:
   - `priority` — a fixed order (the default)
   - `weighted` — traffic split (e.g. 80/20)
   - `cheapest` — based on fee tables provided by the integrator
   - `bestSuccessRate` — based on recent outcomes from the store
   - `custom` — any function `(request, candidates, context) => orderedCandidates`
3. Hands the ordered list to the **attempt engine**.

Strategies are composable, e.g. `priority` inside `country === 'BJ'`, `cheapest` elsewhere.

A **circuit breaker** can temporarily skip a connector that keeps returning
`PROVIDER_UNAVAILABLE`.

## 4. Attempt engine & safe fallback (the critical part)

A payment may go through several **attempts** (one per connector tried), all tied
to one `idempotencyKey`.

```
for each candidate connector:
    result = attempt(connector)
    if result is success / pending / requires_action → stop, return it
    if result.error is do_not_retry                  → stop, return failure
    if result.error is safe_to_fallback              → try next candidate
    if result.error is ambiguous:
        status = connector.getStatus(...) (with retries/backoff)
        if status resolves to "nothing happened"     → try next candidate
        if status shows pending / succeeded          → stop, return it
        if still unknown                             → stop, return status "unknown"
                                                       (the app must reconcile later)
```

**Invariant: Payenv never starts an attempt on connector B while an attempt on
connector A for the same payment could still succeed.** This is what prevents
double charges. It is a hard rule, covered by tests, and not configurable.

Idempotency:
- The same `idempotencyKey` always returns the same payment, never a new charge.
- Where a provider supports idempotency keys natively, the connector forwards a
  derived key per attempt.

## 4b. Payments started by the customer (widgets)

Some providers (Kkiapay, most checkout-style aggregators) cannot start a payment from the
server: the customer starts it in the provider's widget. See
[ADR 0005](adr/0005-customer-started-payments.md).

- Such routes declare `Capability.widget` and are only used when the request lists the
  widget in `supportedWidgets` (the front end can open it).
- `collect` returns `requires_action` with `nextAction: { type: 'widget', provider, params }`.
- `payenv.confirm(key, providerRef)` links the provider transaction after verifying with
  the provider that it carries this payment's merchant reference and amount.

## 5. Webhooks

- The app exposes one endpoint (or one per provider) and passes the **raw body**
  and headers to `payenv.webhooks.handle(connectorId, rawBody, headers)`.
- The connector verifies the signature (HMAC, timestamps / anti-replay, etc.).
- The event is normalized (`payment.succeeded`, `payment.failed`, `payout.succeeded`…),
  matched to its payment and attempt, deduplicated, and delivered to the app's handler.
- Webhooks are treated as *hints*: for critical transitions, Payenv can confirm
  with `getStatus` before announcing `succeeded`.

## 6. Store

Payenv needs a small amount of state (payments, attempts, idempotency keys,
processed webhook IDs, success-rate stats). The store is an interface with
adapters: `memory` (dev/tests, built into the core), then `postgres`, `redis`,
`sqlite`, … Its `create` operation must be atomic, so that two concurrent calls
with the same idempotency key can never both start a charge.
The integrator owns the store and its data.

## 7. Observability

- Structured events/hooks (`onAttempt`, `onFallback`, `onStatusChange`) the app can
  wire to its own logs, metrics, or tracing (OpenTelemetry-friendly).
- No built-in telemetry sent anywhere.

## 8. Packaging

```
@payenv/core                 unified model, router, attempt engine, interfaces,
                             and an in-memory store for development and tests
@payenv/connector-fedapay    one package per connector
@payenv/connector-kkiapay    payments started in the Kkiapay widget, verified server-side
@payenv/store-postgres       persistent stores, one package each
```

## Open questions

- Exact TypeScript API shape (builder vs config object).
- Should the core depend on `fetch` only (runtime-agnostic: Node, Deno, Bun, edge)? Probably yes.
- How to share fee tables and capability data across connectors without making them stale.
- Multi-language strategy: a language-neutral spec + test vectors, or code generation.
