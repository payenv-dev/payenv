# @payenv/core

The core of [Payenv](https://github.com/payenv-dev/payenv): the unified payment model,
the router, and the safe-fallback attempt engine.

> 🚧 Pre-release (`0.x`). The API may change.

```ts
import { createPayenv } from '@payenv/core';

const payenv = createPayenv({
  connectors: [/* connectors, e.g. @payenv/connector-fedapay */],
  // store: a persistent store in production (the default is in-memory)
});

const payment = await payenv.collect({
  amount: { value: 5000, currency: 'XOF' },
  method: { type: 'mobile_money', network: 'mtn', country: 'BJ', phone: '+22990000000' },
  idempotencyKey: 'order_1234',
});

// payment.status: 'pending' | 'requires_action' | 'succeeded' | 'failed' | 'unknown' | ...
// A payment in 'unknown' must be reconciled later with payenv.refresh('order_1234').
```

**Guarantee:** Payenv never starts an attempt on another connector while a previous
attempt for the same payment could still succeed. See
[ADR 0004](https://github.com/payenv-dev/payenv/blob/main/docs/adr/0004-no-fallback-on-ambiguous-state.md).

Requires Node.js 20.19+ (ESM; `require()` works on Node 20.19+ as well), Deno, Bun, or
any runtime with `fetch`, `AbortController`, and `crypto.randomUUID`.

License: Apache-2.0
