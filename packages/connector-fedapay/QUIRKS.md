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

## ✅ Verified in the sandbox (2026-09-27)

- **The sandbox has no per-operator test servers anymore.** MTN, Moov, etc. were removed;
  every push goes to the single `momo_test` mode (`POST /v1/momo_test` with the token).
  Pushing to `/mtn_open` in the sandbox fails with HTTP 400 "Opération non autorisée".
  The connector therefore maps every network to `momo_test` when `environment` is
  `sandbox`, so application code is identical in both environments.
  Source: https://docs.fedapay.com/fr/integration-api/sending-requests#serveur-de-test
- **Test numbers**: `64000001` and `66000001` succeed; any other number simulates a
  failed payment. Sent as E.164 (`+22964000001`), they are accepted end to end.
- **Statuses observed**: a successful payment settles as succeeded; a failed one as
  `declined` → `failed` / `CUSTOMER_DECLINED`.
- Authentication with a sandbox key, transaction creation, token generation, and status
  lookup by transaction id all work as implemented.

## ✅ Verified live (2026-10-05)

- Live pushes work on `/mtn_open` (MTN) and `/sbin` (Celtiis): the USSD prompt reaches
  the phone.
- Benin's 10-digit numbers in E.164 (`+22901…`) are accepted.
- **Transactions carry a `last_error_code`** with the real reason, e.g.
  `INSUFFICIENT_FUND_ERROR` on a canceled MTN payment. The connector maps it
  (→ `INSUFFICIENT_FUNDS`) and always exposes it as `error.providerCode`.
- **A customer canceling the USSD prompt on Celtiis does not end the transaction**:
  FedaPay keeps it `pending` and records `last_error_code: "API_ERROR"`. Payenv keeps the
  payment `pending` (never guessed) and exposes the error. See "Payments stuck in
  pending" in the README.
- Fees may be charged to the customer: a 100 XOF payment showed `fees: 2` and
  `amount_debited: 102`.
- Transactions have a `merchant_reference` field. Whether it can be set on creation and
  used for lookups is still to verify (see below).

## 🔍 Still to verify

- The full list of live transaction statuses. Mapped today: `pending`, `approved`,
  `transferred`, `refunded` → succeeded, `declined` → failed, `canceled`, `expired`.
  Unknown values map to `unknown` (safe).
- Whether FedaPay eventually expires a transaction stuck in `pending`, and after how long.
- The other `last_error_code` values (only `INSUFFICIENT_FUND_ERROR` and `API_ERROR` are
  mapped; others are exposed as `providerCode` with a default code).
- Whether a transaction can be looked up by merchant reference. That would let Payenv
  resolve a timeout on the *create* call. Today that case ends as `unknown` (safe but
  not ideal).

## Safety decisions

- An HTTP 404 on a status lookup is **not** treated as "the transaction does not exist":
  it is not authoritative enough to allow a fallback.
- The connector never logs. Secrets and phone numbers never appear in error messages.
