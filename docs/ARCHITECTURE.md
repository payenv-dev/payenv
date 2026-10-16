# Architecture

*Status: living document, updated 2026-10-16. Open an issue to discuss any of it.*

This document describes the core concepts of Payenv. Sections marked **(planned)**
describe the design for parts that are not implemented yet; everything else is in the
code today ([`packages/core/src`](../packages/core/src)).

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
| `refund` | Return all or part of a collected payment. **(planned)** |
| `getStatus` | Fetch the current state of a payment from the provider. |

### Payment methods

A method describes *how* the customer pays, independently of the provider:

```ts
{ type: 'mobile_money', network: 'mtn' | 'moov' | 'orange' | 'wave' | 'celtiis' | ..., country: 'BJ', phone: '+229...' }
{ type: 'card', token: '...' }          // token from the provider's hosted fields
{ type: 'hosted_page', returnUrl: '...' } // redirect to the provider's checkout
{ type: 'bank_transfer', ... }          // (planned)
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
| `TIMEOUT`, `NETWORK_ERROR`, `UNKNOWN_ERROR` | `ambiguous` | The provider may have processed it. **Never fall back blindly.** |

The full list is in [`errors.ts`](../packages/core/src/errors.ts). The provider's own code
is kept in `error.providerCode`, and its original response in `error.raw` (never
serialized) for debugging.

## 2. Connectors

A connector is an adapter for one aggregator. It is the **only** place with
provider-specific code.

```ts
interface Connector {
  readonly id: string;                         // 'fedapay'
  capabilities(): readonly Capability[];       // what routes it can serve
  collect(req: CollectRequest, ctx: AttemptContext): Promise<ProviderResult>;
  payout?(req: PayoutRequest, ctx: AttemptContext): Promise<ProviderResult>;
  getStatus(query: StatusQuery, ctx: StatusContext): Promise<StatusResult>;
  mapError?(err: unknown): PayenvError;
}
```

The full contract, with the rules each method must follow, is in
[`connector.ts`](../packages/core/src/connector.ts). Refunds (`refund?`) are planned.
Webhooks are handled today by helpers exported by each connector (e.g.
`verifyFedaPayWebhook`, `parseFedaPayWebhook`); a normalized handler is planned (§5).

A **capability** declares a route the connector can serve:

```ts
{ operation: 'collect', method: 'mobile_money', currencies: ['XOF'], countries: ['BJ'], networks: ['mtn', 'moov'] }
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
   - `priority([...ids])`: a fixed order (the default is registration order)
   - any function `(candidates, request) => orderedCandidates` (sync or async)
   - **(planned)** `weighted` (traffic split, e.g. 80/20), `cheapest` (fee tables provided
     by the integrator), `bestSuccessRate` (recent outcomes from the store)
3. Hands the ordered list to the **attempt engine**.

**(planned)** Composable strategies (e.g. `priority` in Benin, `cheapest` elsewhere), and a
**circuit breaker** that temporarily skips a connector that keeps returning
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

Today, each connector exports helpers to verify and parse its provider's webhooks, and the
app calls `payenv.refresh(idempotencyKey)` to get the authoritative status. The rest of
this section is **(planned)**.

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
adapters: `memory` (dev/tests, built into the core) today; `postgres`, `redis`,
`sqlite`, … are planned, and any database can be used by implementing the three-method
`Store` interface. Its `create` operation must be atomic, so that two concurrent calls
with the same idempotency key can never both start a charge.
The integrator owns the store and its data.

## 7. Observability

- `onEvent` receives structured lifecycle events (`attempt.started`, `attempt.finished`,
  `fallback`, `payment.updated`) the app can wire to its own logs, metrics, or tracing.
  OpenTelemetry helpers are planned.
- No built-in telemetry sent anywhere.

## 8. Packaging

```
@payenv/core                 unified model, router, attempt engine, interfaces,
                             and an in-memory store for development and tests
@payenv/connector-fedapay    one package per connector
@payenv/connector-kkiapay    payments started in the Kkiapay widget, verified server-side
@payenv/connector-cinetpay   direct push or CinetPay's hosted page, and transfers, nine countries
@payenv/store-postgres       persistent stores, one package each (planned)
```

## Open questions

- Exact TypeScript API shape (builder vs config object).
- Should the core depend on `fetch` only (runtime-agnostic: Node, Deno, Bun, edge)? Probably yes.
- How to share fee tables and capability data across connectors without making them stale.
- Multi-language strategy: a language-neutral spec + test vectors, or code generation.
