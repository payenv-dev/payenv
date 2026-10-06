# @payenv/connector-kkiapay

[Kkiapay](https://kkiapay.me) connector for [Payenv](https://github.com/payenv-dev/payenv).

> 🚧 Pre-release (`0.x`).

Kkiapay payments are **started by the customer in the Kkiapay widget** (browser or mobile
app), not by your server. Payenv returns what the widget needs, then verifies the
transaction server-side with your private keys before trusting it.

**Supported today:** mobile money in Benin (XOF): MTN and Moov. Status verification,
webhook verification and parsing.

## 1. Server

```ts
import { createPayenv } from '@payenv/core';
import { fedapay } from '@payenv/connector-fedapay';
import { KKIAPAY_WIDGET, kkiapay } from '@payenv/connector-kkiapay';

const payenv = createPayenv({
  connectors: [
    fedapay({ secretKey: process.env.FEDAPAY_SECRET_KEY! }), // server push, tried first
    kkiapay({
      publicKey: process.env.KKIAPAY_PUBLIC_KEY!,
      privateKey: process.env.KKIAPAY_PRIVATE_KEY!,
      secretKey: process.env.KKIAPAY_SECRET_KEY!,
      environment: 'sandbox', // or 'live'
    }),
  ],
});

const payment = await payenv.collect({
  amount: { value: 5000, currency: 'XOF' },
  method: { type: 'mobile_money', network: 'mtn', country: 'BJ', phone: '+22961000000' },
  idempotencyKey: 'order_1234',
  supportedWidgets: [KKIAPAY_WIDGET], // your front end can open the Kkiapay widget
});
// If Kkiapay is used (directly or as a fallback):
// payment.status === 'requires_action'
// payment.nextAction === { type: 'widget', provider: 'kkiapay', params: { key, amount, ... } }
```

Kkiapay is only used when the request lists it in `supportedWidgets`: Payenv never hands
a widget to a front end that cannot open it.

## 2. Front end

```html
<script src="https://cdn.kkiapay.me/k.js"></script>
<script>
  // payment.nextAction.params comes from your server
  openKkiapayWidget(payment.nextAction.params);
  addSuccessListener(({ transactionId }) => {
    // Send it to your server, which calls payenv.confirm
    fetch('/payments/' + payment.idempotencyKey + '/confirm', {
      method: 'POST',
      body: JSON.stringify({ transactionId }),
    });
  });
</script>
```

Only the **public** key is ever sent to the browser.

## 3. Confirm (server)

```ts
const confirmed = await payenv.confirm('order_1234', transactionId);
```

`confirm` asks Kkiapay for the transaction and checks that it carries this payment's
reference (`partnerId`) **and** amount. A customer cannot confirm an order with another,
cheaper transaction: `REFERENCE_MISMATCH` is thrown and the payment is left unchanged.

## Webhooks

The widget's `partnerId` is the payment's idempotency key, so webhooks map directly:

```ts
import { parseKkiapayWebhook, verifyKkiapayWebhook } from '@payenv/connector-kkiapay';

if (verifyKkiapayWebhook(secretHeader, process.env.KKIAPAY_WEBHOOK_SECRET!)) {
  const event = parseKkiapayWebhook(rawBody); // { name, providerRef, merchantReference, status }
  if (event?.merchantReference) await payenv.confirm(event.merchantReference, event.providerRef);
}
```

## Options

| Option | Default | Description |
|---|---|---|
| `publicKey`, `privateKey`, `secretKey` | — | Kkiapay API keys. Required. |
| `environment` | `'sandbox'` | `'sandbox'` or `'live'`. |
| `routes` | `{ BJ: ['mtn', 'moov'] }` | Mobile money networks per country. |
| `id` | `'kkiapay'` | Connector id. |
| `fetch` | global `fetch` | Custom fetch implementation. |

See [QUIRKS.md](QUIRKS.md) for what is verified and what remains to verify.

License: Apache-2.0
