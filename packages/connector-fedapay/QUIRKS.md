# FedaPay quirks

What differs from what you would expect when reading the FedaPay documentation.

## ✅ Verified (production integration)

- **The mobile money push takes two calls**, not one:
  1. `POST /v1/transactions/{id}/token` returns a token;
  2. `POST /v1/{operator}` with body `{ "token": "..." }` sends the USSD prompt to the
     phone number stored on the transaction's customer.

  The documentation suggests `/transactions/{id}/{mode}`. The working path is `/{mode}`
  (same as the official PHP SDK's `Transaction::sendNowWithToken`).
- **Operator slugs differ between collections and payouts** (Benin):

  | Network | Collection | Payout |
  |---|---|---|
  | MTN | `mtn_open` | `mtn` |
  | Moov | `moov` | `moov` |
  | Celtiis | `sbin` | `sbin` |

- **Resources are wrapped** under `v1/<resource>` (e.g. `"v1/transaction"`,
  `"v1/payment_intent"`), sometimes `<resource>`, sometimes not at all.
- **Operators must be activated** on the merchant account (Dashboard → Configuration →
  Payment methods). Otherwise the push fails with "Opération non autorisée", which the
  connector maps to `ROUTE_UNSUPPORTED`, so another connector can be tried.
- **Webhook signature**: header `x-fedapay-signature: t=<timestamp>,s=<hex>`, where
  `s = HMAC-SHA256(secret, "<timestamp>.<raw body>")`.
- **Payouts** are created with `POST /v1/payouts`, then started with
  `PUT /v1/payouts/start` and body `{ "payouts": [{ "id": ... }] }`. (Not implemented yet.)

## 🔍 To verify in the sandbox

- The full list of transaction statuses. Mapped today: `pending`, `approved`,
  `transferred`, `refunded` → succeeded, `declined` → failed, `canceled`, `expired`.
  Unknown values map to `unknown` (safe).
- The phone number format FedaPay expects (E.164 `+229…` is sent today).
- Whether a transaction can be looked up by merchant reference. That would let Payenv
  resolve a timeout on the *create* call. Today that case ends as `unknown` (safe but
  not ideal).
- Sandbox test phone numbers for each operator.

## Safety decisions

- An HTTP 404 on a status lookup is **not** treated as "the transaction does not exist":
  it is not authoritative enough to allow a fallback.
- The connector never logs. Secrets and phone numbers never appear in error messages.
