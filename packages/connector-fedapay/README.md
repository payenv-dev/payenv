# @payenv/connector-fedapay

[FedaPay](https://fedapay.com) connector for [Payenv](https://github.com/payenv-dev/payenv).

> 🚧 Pre-release (`0.x`).

**Supported today:** mobile money collections in Benin (XOF): MTN, Moov, Celtiis.
Status lookup and webhook signature verification. Payouts and refunds are coming.

```ts
import { createPayenv } from '@payenv/core';
import { fedapay, verifyFedaPayWebhook } from '@payenv/connector-fedapay';

const payenv = createPayenv({
  connectors: [
    fedapay({
      secretKey: process.env.FEDAPAY_SECRET_KEY!,
      environment: 'sandbox', // or 'live'
    }),
  ],
});

const payment = await payenv.collect({
  amount: { value: 5000, currency: 'XOF' },
  method: { type: 'mobile_money', network: 'mtn', country: 'BJ', phone: '+22990000000' },
  customer: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' },
  idempotencyKey: 'order_1234',
});
// payment.status === 'pending': the customer received a USSD prompt to confirm with their PIN.

// Webhook endpoint: pass the RAW body.
const valid = await verifyFedaPayWebhook(
  rawBody,
  request.headers.get('x-fedapay-signature'),
  process.env.FEDAPAY_WEBHOOK_SECRET!,
);
```

## Options

| Option | Default | Description |
|---|---|---|
| `secretKey` | — | FedaPay secret key. Required. |
| `environment` | `'sandbox'` | `'sandbox'` or `'live'`. |
| `operators` | Benin: MTN, Moov, Celtiis | Operators to expose, per country: `{ BJ: { mtn: 'mtn_open' } }`. List only the operators activated on your merchant account. |
| `id` | `'fedapay'` | Connector id, e.g. to register two FedaPay accounts. |
| `fetch` | global `fetch` | Custom fetch implementation. |

## Safety

Money can only move once the mobile money push is sent (step 3 of 3).

- Errors while creating the transaction or its token are **safe to fall back**.
- Errors during the push are **ambiguous**: Payenv checks the transaction status with
  FedaPay before doing anything else, and never falls back while it could still succeed.

See [QUIRKS.md](QUIRKS.md) for provider behaviors and what remains to verify.

License: Apache-2.0
