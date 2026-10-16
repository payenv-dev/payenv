# CinetPay quirks

## ✅ From the official SDK source (`cinetpay/cinetpay-js`, 2026-10-16)

- **A new API.** The official SDKs no longer use the `api-checkout.cinetpay.com/v2` API
  (`apikey` + `site_id`), and `cinetpay.com` hosts did not resolve from our network
  (2026-10-16). The current API is **v1** at
  `https://api.cinetpay.net` (sandbox, `sk_test_…` keys) and `https://api.cinetpay.co`
  (production, `sk_live_…` keys).
- **Credentials per country.** Each country account has its own API key and password.
  `POST /v1/oauth/login` `{ api_key, api_password }` returns a JWT (`access_token`,
  `expires_in: 86400`), sent as `Authorization: Bearer`. An expired token answers
  `1003 EXPIRED_TOKEN`: the connector logs in again and sends the call once more.
- **One call starts a payment**: `POST /v1/payment`. With `direct_pay: true`,
  `payment_method` (e.g. `MTN_BJ`) and `client_phone_number`, the push is sent at once
  (no redirection). Without it, the answer's `payment_url` is CinetPay's hosted page.
  `details.must_be_redirected` says whether the customer must still open that page.
- **Required fields**: `client_first_name`, `client_last_name` (2–255 characters),
  `client_email`, `success_url`, `failed_url`, `notify_url` (at most 120 characters each),
  `designation`, `lang`, `channel` (`PUSH`, `OTP` or `QRCODE`). The connector never makes
  up a customer: without a name and email it declines the route (`ROUTE_UNSUPPORTED`).
- **`merchant_transaction_id`: at most 30 characters.** Payenv references are longer
  (`att_<uuid>`): the connector keeps their last 30 letters and digits (120 random bits),
  so it can recompute the id to look a payment up after a timeout.
- **Amounts**: 100 to 2,500,000, whole numbers. Currencies XOF, XAF, GNF, CDF, USD.
- **Status lookup**: `GET /v1/payment/{id}`, where `id` is the payment token, CinetPay's
  `transaction_id` or our `merchant_transaction_id`. Codes: `100 SUCCESS`, `2001 INITIATED`
  (waiting for the customer), `2002 PENDING` (the customer started paying), `2003 EXPIRED`,
  `2010 FAILED`, `404 NOT_FOUND`. Only the explicit `NOT_FOUND` counts as "not found".
- **Notifications** carry `notify_token`, `merchant_transaction_id`, `transaction_id` and
  `user`, **no status and no signature**. `notify_token` is returned by the payment call,
  which Payenv does not store. Treat notifications as a signal to call `payenv.refresh`.
- **Sandbox test numbers (Côte d'Ivoire)**: `+2250707070700` succeeds, `…0701` succeeds
  after 3 s, `…0703` fails, `…0704` fails after 3 s, `…0706` stays pending.

## Choices made by the connector

- **Direct push networks** default to those that need nothing from the customer but a PIN
  (MTN, Moov, Free, T-Money, Airtel). Orange Money needs an OTP code in direct mode, and
  Wave an app or QR code: they are offered through the hosted page. Add them with
  `methods` once verified.
- **Status lookups need the country** (tokens are per country). The connector remembers
  the country of the payments it started; after a restart it asks every configured
  country, and says "not found" only when all of them do.
- **`INITIATED` maps to `requires_action`**: the customer has not done anything yet. Payenv
  keeps the redirect URL on refresh while the payment stays in that status.
- **Hosted page errors are safe to fall back from**: a payment page nobody was sent to
  cannot take money. Direct push errors are ambiguous and checked first.

## 🔍 To verify in the sandbox

- Every mapping above against real answers (HTTP status codes of errors in particular).
- That a lookup for a payment whose creation never reached CinetPay answers `NOT_FOUND`.
- Whether `EXPIRED` is final (the SDK lists it as not final).
- Whether amounts must be multiples of 5 (true of the old API).
- Direct push for Orange Money (OTP) and Wave, and the `OTP` and `QRCODE` channels.
- RD Congo (CDF and USD amounts have minor units: not supported yet).
- Transfers (`/v1/transfer`) for payouts.
