# Getting started

Collect your first mobile money payment with Payenv in about five minutes.

> Payenv is a pre-release (`0.x`): the API may still change between minor versions.

## 1. Install

```sh
npm install @payenv/core @payenv/connector-fedapay
```

Requires Node.js 20.19+ (or Deno, Bun, or any runtime with `fetch` and Web Crypto).
Works with `import` and `require`.

## 2. Configure

Get a **sandbox** secret key from your [FedaPay](https://fedapay.com) dashboard and keep it in
an environment variable.

```ts
import { createPayenv } from '@payenv/core';
import { fedapay } from '@payenv/connector-fedapay';

const payenv = createPayenv({
  connectors: [
    fedapay({
      secretKey: process.env.FEDAPAY_SECRET_KEY!,
      environment: 'sandbox', // 'live' in production
    }),
  ],
});
```

## 3. Collect a payment

```ts
const payment = await payenv.collect({
  amount: { value: 100, currency: 'XOF' }, // integer, in the currency's minor unit
  method: { type: 'mobile_money', network: 'mtn', country: 'BJ', phone: '+22964000001' },
  customer: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' },
  idempotencyKey: 'order_1234', // your order id: retries never charge twice
});

console.log(payment.status); // 'pending': the customer confirms on their phone
```

In the FedaPay sandbox, `+22964000001` and `+22966000001` succeed; any other number simulates
a failed payment. In live mode, the customer receives a USSD prompt and confirms with their PIN.

Payenv only accepts E.164 phone numbers. Convert what the customer typed with `toE164`:

```ts
import { toE164 } from '@payenv/core';

toE164('61 00 00 00', 'BJ'); // '+22961000000'
```

Invalid requests throw a `PayenvError` (`INVALID_PHONE`, `NO_ROUTE`, …). Everything that happens
with the provider is returned in the payment instead.

## 4. Follow the payment

The customer confirms asynchronously. Follow the payment with webhooks, polling, or both.

**Polling**

```ts
const latest = await payenv.refresh('order_1234'); // asks the provider
```

**Webhooks**: set your endpoint URL in the FedaPay dashboard, then:

```ts
import { parseFedaPayWebhook, verifyFedaPayWebhook } from '@payenv/connector-fedapay';

// rawBody: the raw, unparsed request body (string)
if (await verifyFedaPayWebhook(rawBody, signatureHeader, process.env.FEDAPAY_WEBHOOK_SECRET!)) {
  const event = parseFedaPayWebhook(rawBody); // { name, providerRef, status, error }
  // Find your payment by event.providerRef, then confirm with the provider:
  // await payenv.refresh(idempotencyKey);
}
```

Webhooks are hints: always confirm with `refresh` before delivering an order.

## 5. Handle the result

| `payment.status` | Meaning | What to do |
|---|---|---|
| `pending` / `requires_action` | Waiting for the customer | Wait for a webhook, or `refresh` later |
| `succeeded` | Paid | Deliver |
| `failed` / `canceled` / `expired` | Not paid | Show `payment.error` and offer a new payment |
| `unknown` | Payenv could not tell whether money moved | **Do not** retry with a new key. Keep calling `refresh` until it settles |

`payment.error` tells you why:

```json
{
  "code": "INSUFFICIENT_FUNDS",
  "message": "FedaPay transaction canceled — Insufficient funds, or an operator limit was reached (INSUFFICIENT_FUND_ERROR)",
  "retryClass": "do_not_retry",
  "connectorId": "fedapay",
  "providerCode": "INSUFFICIENT_FUND_ERROR"
}
```

`code` is the same across all providers; `providerCode` is the provider's own code, for support.

Some payments stay `pending` for a long time (for example when an operator does not report a
cancellation). See
[Payments stuck in pending](../packages/connector-fedapay/README.md#payments-stuck-in-pending).

## 6. Send money (payouts)

```ts
const payout = await payenv.payout({
  amount: { value: 2000, currency: 'XOF' },
  recipient: { type: 'mobile_money', network: 'mtn', country: 'BJ', phone: '+22990000000' },
  customer: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' },
  idempotencyKey: 'withdrawal_42',
});
```

Payouts have the same guarantees as collections: the same key never sends money twice, and
Payenv only falls back to another provider when it is proven that no money was sent (for
example, `INSUFFICIENT_BALANCE` on the first provider). Follow them with `refresh`.

## 7. Add a second provider (fallback)

Register several connectors: Payenv tries them in order and falls back **only when it is proven
that no money moved** with the previous one.

```ts
import { createPayenv, priority } from '@payenv/core';

const payenv = createPayenv({
  connectors: [fedapay({ ... }), otherConnector({ ... })],
  routing: priority(['fedapay', 'other']),
});
```

Some providers start payments in a widget on the customer's side (e.g. Kkiapay). They are
used only if your front end can open their widget, and can serve as a fallback:

```ts
const payment = await payenv.collect({ ...request, supportedWidgets: ['kkiapay'] });
if (payment.nextAction?.type === 'widget') {
  // Front end: open the widget with payment.nextAction.params, then send the transaction
  // id it returns to your server, which calls:
  await payenv.confirm(payment.idempotencyKey, transactionId);
}
```

`confirm` verifies with the provider that the transaction belongs to this payment and has
the right amount. See [@payenv/connector-kkiapay](../packages/connector-kkiapay).

More connectors are on the way: see [CONNECTORS.md](CONNECTORS.md).

## 8. Before going live

- [ ] Use `environment: 'live'` and a live key from a secret manager or environment variable.
- [ ] **Use a persistent store.** The default in-memory store loses idempotency on restart and
      is not shared between instances. Implement the `Store` interface on your database. Its
      `create` must be atomic, for example with a unique constraint on the idempotency key:

      ```ts
      import type { Store } from '@payenv/core';

      const store: Store = {
        // INSERT ... ON CONFLICT (idempotency_key) DO NOTHING → true if a row was inserted
        async create(payment) { /* ... */ },
        async get(idempotencyKey) { /* SELECT ... */ },
        async update(payment) { /* UPDATE ... */ },
      };
      createPayenv({ connectors, store });
      ```
- [ ] Verify every webhook signature and pass the **raw** body.
- [ ] Never log raw provider responses or webhooks: they contain personal data.
- [ ] Reconcile `pending` and `unknown` payments regularly with `refresh`.

## Try the demo

The repository includes a runnable web demo: see
[examples/fedapay-demo](../examples/fedapay-demo).
