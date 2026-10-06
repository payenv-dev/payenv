# @payenv/connector-fedapay

[FedaPay](https://fedapay.com) connector for [Payenv](https://github.com/payenv-dev/payenv).

> 🚧 Pre-release (`0.x`).

**Supported today:** mobile money collections and **payouts** in Benin (XOF): MTN, Moov,
Celtiis. Status lookup, webhook signature verification and parsing. Refunds are coming.

```ts
import { createPayenv } from '@payenv/core';
import { fedapay, parseFedaPayWebhook, verifyFedaPayWebhook } from '@payenv/connector-fedapay';

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
if (valid) {
  const event = parseFedaPayWebhook(rawBody); // { name, providerRef, status, error }
  // Find your payment by event.providerRef, then confirm with FedaPay:
  // await payenv.refresh(idempotencyKey);
}
```

## Options

| Option | Default | Description |
|---|---|---|
| `secretKey` | — | FedaPay secret key. Required. |
| `environment` | `'sandbox'` | `'sandbox'` or `'live'`. In the sandbox, every network is sent to FedaPay's `momo_test` mode. |
| `operators` | Benin: MTN, Moov, Celtiis (`momo_test` in the sandbox) | Operators to expose, per country: `{ BJ: { mtn: 'mtn_open' } }`. List only the operators activated on your merchant account. |
| `id` | `'fedapay'` | Connector id, e.g. to register two FedaPay accounts. |
| `fetch` | global `fetch` | Custom fetch implementation. |

## Testing in the sandbox

The FedaPay sandbox simulates every operator with a single `momo_test` mode. Use
`+22964000001` or `+22966000001` for a successful payment; any other number simulates a
failure. Your code stays the same: just switch `environment` to `'live'` in production.

## Payouts

Send money from your FedaPay balance to a mobile money account. Payouts must be enabled
on your FedaPay account.

```ts
const payout = await payenv.payout({
  amount: { value: 2000, currency: 'XOF' },
  recipient: { type: 'mobile_money', network: 'mtn', country: 'BJ', phone: '+22990000000' },
  customer: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' },
  idempotencyKey: 'withdrawal_42', // the same key never sends money twice
});
// payout.status === 'pending' → follow it with payenv.refresh('withdrawal_42')
```

If the FedaPay balance is insufficient (`INSUFFICIENT_BALANCE`) or payouts are not enabled
(`ROUTE_UNSUPPORTED`), Payenv falls back to another connector that supports payouts. If the
call that sends the money times out, Payenv checks the payout with FedaPay and never sends
it a second time elsewhere.

## Error reasons

When FedaPay records why a payment failed, it is mapped to a Payenv code and the original
code is kept:

```json
{
  "code": "INSUFFICIENT_FUNDS",
  "message": "FedaPay transaction canceled — The customer has insufficient funds (INSUFFICIENT_FUND_ERROR)",
  "providerCode": "INSUFFICIENT_FUND_ERROR"
}
```

## Payments stuck in pending

Some operators don't report a cancellation: on Celtiis, a customer who cancels the USSD
prompt leaves the transaction `pending` at FedaPay, with an operator error recorded.
Payenv keeps it `pending` (it never guesses, since the payment could still complete) and
exposes the error in `payment.error`. Recommended handling:

1. Show the customer that the payment is not confirmed yet, and let them retry with a
   **new** idempotency key (a new payment).
2. Keep calling `payenv.refresh(key)` (or handle webhooks) for the old payment, so a late
   success is not lost.
3. Apply your own business timeout (e.g. release the order after 15 minutes), and if the
   old payment succeeds later, fulfil or refund it.

## Safety

Money can only move once the mobile money push is sent (step 3 of 3).

- Errors while creating the transaction or its token are **safe to fall back**.
- Errors during the push are **ambiguous**: Payenv checks the transaction status with
  FedaPay before doing anything else, and never falls back while it could still succeed.

See [QUIRKS.md](QUIRKS.md) for provider behaviors and what remains to verify.

License: Apache-2.0
