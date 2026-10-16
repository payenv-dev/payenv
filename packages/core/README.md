# @payenv/core

The core of [Payenv](https://github.com/payenv-dev/payenv): the unified payment model,
the router, and the safe-fallback attempt engine. Use it with one or more connectors:
[FedaPay](https://www.npmjs.com/package/@payenv/connector-fedapay),
[Kkiapay](https://www.npmjs.com/package/@payenv/connector-kkiapay),
[CinetPay](https://www.npmjs.com/package/@payenv/connector-cinetpay).

> 🚧 Pre-release (`0.x`). The API may change.

```ts
import { createPayenv, priority } from '@payenv/core';

const payenv = createPayenv({
  connectors: [/* e.g. fedapay({ ... }), cinetpay({ ... }) */],
  routing: priority(['fedapay', 'cinetpay']), // optional; default: registration order
  // store: a persistent store in production (the default is in-memory)
  // onEvent: (event) => console.log(event.type), // attempts and fallbacks
});

const payment = await payenv.collect({
  amount: { value: 5000, currency: 'XOF' },
  method: { type: 'mobile_money', network: 'mtn', country: 'BJ', phone: '+22990000000' },
  customer: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' },
  idempotencyKey: 'order_1234',
});

// payment.status: 'pending' | 'requires_action' | 'succeeded' | 'failed' | 'unknown' | ...
// A payment in 'unknown' must be reconciled later with payenv.refresh('order_1234').
```

## API

| Method | Description |
|---|---|
| `collect(request)` | Collects a payment (mobile money push, hosted page, or provider widget). |
| `payout(request)` | Sends money to a mobile money number, with the same guarantees. |
| `refresh(idempotencyKey)` | Asks the provider for the latest status of a non-terminal payment. |
| `confirm(idempotencyKey, providerRef)` | Links a widget payment after checking its reference and amount with the provider. |
| `getPayment(idempotencyKey)` | Reads a payment from the store. |

Also exported: `priority`, `createMemoryStore` and the `Store` interface, `PayenvError`
and the error codes, `money` / `fromMajor` for amounts, `toE164` for phone numbers, and
the `Connector` interface to write your own connector.

**Guarantee:** Payenv never starts an attempt on another connector while a previous
attempt for the same payment could still succeed. See
[ADR 0004](https://github.com/payenv-dev/payenv/blob/main/docs/adr/0004-no-fallback-on-ambiguous-state.md).

Requires Node.js 20.19+ (ESM; `require()` works on Node 20.19+ as well), Deno, Bun, or
any runtime with `fetch`, `AbortController`, and `crypto.randomUUID`. No runtime
dependencies.

Guide: [Getting started](https://github.com/payenv-dev/payenv/blob/main/docs/GETTING_STARTED.md).

License: Apache-2.0
