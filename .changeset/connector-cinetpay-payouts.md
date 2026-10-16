---
'@payenv/connector-cinetpay': minor
---

CinetPay payouts.

- Payouts by CinetPay transfer (`POST /v1/transfer`) from the balance of the recipient's
  country account: MTN, Moov, Orange Money, Wave, Free, T-Money and Airtel depending on
  the country (`payoutMethods` option, `DEFAULT_PAYOUT_METHODS`).
- Payout status lookups by merchant reference, so a transfer that timed out is checked
  before any fallback. A too-low CinetPay balance maps to `INSUFFICIENT_BALANCE`, safe to
  fall back.
