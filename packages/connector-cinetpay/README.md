# @payenv/connector-cinetpay

[CinetPay](https://cinetpay.com) connector for [Payenv](https://github.com/payenv-dev/payenv).

> 🚧 Pre-release (`0.x`). Built from CinetPay's official SDK; not yet verified end to end
> in the sandbox (see [QUIRKS.md](QUIRKS.md)).

**Supported today:** collections in Benin, Burkina Faso, Côte d'Ivoire, Mali, Niger,
Senegal, Togo (XOF), Cameroon (XAF) and Guinea (GNF):

- **`mobile_money`**: a direct push to the customer's phone (MTN, Moov, Free, T-Money,
  Airtel, depending on the country).
- **`hosted_page`**: the customer is redirected to CinetPay's page and pays there (Orange
  Money, Wave, cards…).

**Payouts** (transfers from your CinetPay balance) to MTN, Moov, Orange Money, Wave,
Free, T-Money and Airtel numbers, depending on the country.

Status lookups and notification parsing. Refunds are not supported yet.

```ts
import { createPayenv } from '@payenv/core';
import { cinetpay } from '@payenv/connector-cinetpay';

const payenv = createPayenv({
  connectors: [
    cinetpay({
      // One API key and password per CinetPay country account.
      credentials: {
        CI: {
          apiKey: process.env.CINETPAY_API_KEY_CI!,
          apiPassword: process.env.CINETPAY_API_PASSWORD_CI!,
        },
      },
      // Receives the idempotency key, so your webhook knows which payment to refresh.
      notifyUrl: (key) => `https://shop.example/webhooks/cinetpay?key=${key}`,
      environment: 'sandbox', // or 'live'
    }),
  ],
});

// Direct push
const payment = await payenv.collect({
  amount: { value: 5000, currency: 'XOF' },
  method: { type: 'mobile_money', network: 'mtn', country: 'CI', phone: '+2250707070700' },
  customer: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' },
  idempotencyKey: 'order_1234',
});
// payment.status === 'requires_action'
// payment.nextAction === { type: 'customer_confirmation', channel: 'ussd', message }

// Hosted page
const checkout = await payenv.collect({
  amount: { value: 5000, currency: 'XOF' },
  method: { type: 'hosted_page', country: 'CI', returnUrl: 'https://shop.example/orders/1235' },
  customer: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' },
  idempotencyKey: 'order_1235',
});
// checkout.nextAction === { type: 'redirect', url: 'https://…' }: send the customer there.

// Payout (from your CinetPay balance in Côte d'Ivoire)
const payout = await payenv.payout({
  amount: { value: 5000, currency: 'XOF' },
  recipient: { type: 'mobile_money', network: 'orange', country: 'CI', phone: '+2250707000001' },
  description: 'Refund order 1234', // sent as the transfer reason
  idempotencyKey: 'refund_1234',
});
// payout.status === 'pending' until CinetPay reports SUCCESS; call payenv.refresh.
```

CinetPay requires the customer's **first name, last name and email**. Without them the
connector declines the payment (`ROUTE_UNSUPPORTED`) and Payenv tries the next connector.

Payouts are paid from the CinetPay account of the recipient's country (100 to 1,500,000
per transfer). When that balance is too low, CinetPay refuses the transfer and Payenv
tries the next connector (`INSUFFICIENT_BALANCE`). Transfers must be enabled on your
CinetPay account.

## Webhooks

CinetPay notifications are **not signed and carry no status**: use them only as a signal
to ask CinetPay, through `payenv.refresh`.

```ts
import { parseCinetPayWebhook } from '@payenv/connector-cinetpay';

app.post('/webhooks/cinetpay', async (req, res) => {
  if (parseCinetPayWebhook(req.rawBody)) await payenv.refresh(req.query.key);
  res.sendStatus(200);
});
```

## Options

| Option | Default | Description |
|---|---|---|
| `credentials` | — | `{ [country]: { apiKey, apiPassword } }`. Required. Only these countries are used. |
| `notifyUrl` | — | URL, or `(idempotencyKey) => URL`, for CinetPay's notifications (≤ 120 characters). Required. |
| `returnUrl` | `notifyUrl` | Where CinetPay sends the customer after a direct push. |
| `environment` | `'sandbox'` | `'sandbox'` (`api.cinetpay.net`) or `'live'` (`api.cinetpay.co`). |
| `methods` | `DEFAULT_METHODS` | Direct push networks per country, e.g. `{ CI: { mtn: 'MTN_CI' } }`. `{}` disables direct push. |
| `payoutMethods` | `DEFAULT_PAYOUT_METHODS` | Payout networks per country, e.g. `{ CI: { orange: 'OM_CI' } }`. `{}` disables payouts. |
| `hostedPage` | `true` | Offer the `hosted_page` method. |
| `lang` | `'fr'` | Language of CinetPay's pages. |
| `id` | `'cinetpay'` | Connector id. |
| `fetch` | global `fetch` | Custom fetch implementation. |

See [QUIRKS.md](QUIRKS.md) for what is verified and what remains to verify.

License: Apache-2.0
