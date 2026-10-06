# Kkiapay quirks

## ✅ From the documentation and the official SDK source (2026-10-05)

- **No server-side way to start a payment.** The official Node.js Admin SDK
  (`@kkiapay-org/nodejs-sdk` 1.0.7) only calls `POST /api/v1/transactions/status`
  (verify) and `POST /api/v1/transactions/revert` (refund). Payments start in the widget
  (`https://cdn.kkiapay.me/k.js`, `openKkiapayWidget`), which returns a `transactionId`.
- **API**: `https://api-sandbox.kkiapay.me` / `https://api.kkiapay.me`, headers
  `x-api-key` (public key), `x-private-key`, `x-secret-key`. The sandbox answers HTTP 401
  to invalid keys (observed).
- **Unknown transaction id** (verified in the sandbox, 2026-10-06): HTTP **400** with
  `{ "status": "TRANSACTION_NOT_FOUND" }` (not 404). Only this explicit answer is
  treated as "not found".
- **Status response** fields include `status` (`SUCCESS`, `FAILED`…), `amount`, `fees`,
  `feeSupportedBy`, `failureCode`, `failureMessage`, `partnerId`, `transactionId`,
  `client.phone`.
- **Webhooks are not signed**: the `x-kkiapay-secret` header carries the hash secret
  configured in the dashboard, as is. The connector compares it in constant time; treat
  the body as a hint and confirm with the API (Payenv does, through `confirm`).
- The documented webhook field is spelled `isPaymentSucces` (sic). Both spellings are
  accepted.
- Sandbox test numbers (MTN Benin): `61000000` / `97000000` succeed, `…01` processing
  error, `…02` insufficient funds, `…03` declined. Moov: `68000000` / `95000000`, same
  suffixes.

## 🔍 To verify in the sandbox

- That `partnerId` passed to the widget is echoed in status responses and webhooks.
  `payenv.confirm` relies on it: without it, confirmation is refused (safe).
- That `amount` in status responses is the amount requested (not including fees), for
  both `feeSupportedBy` values.
- The phone format the widget expects (sent today without `+`, e.g. `22961000000`).
- Whether a `PENDING` status exists.
