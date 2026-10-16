# @payenv/connector-cinetpay

## 0.3.0

### Minor Changes

- d5f1486: CinetPay payouts.
  
  - Payouts by CinetPay transfer (`POST /v1/transfer`) from the balance of the recipient's
    country account: MTN, Moov, Orange Money, Wave, Free, T-Money and Airtel depending on
    the country (`payoutMethods` option, `DEFAULT_PAYOUT_METHODS`).
  - Payout status lookups by merchant reference, so a transfer that timed out is checked
    before any fallback. A too-low CinetPay balance maps to `INSUFFICIENT_BALANCE`, safe to
    fall back.
- a5d32f6: CinetPay connector.
  
  - `@payenv/connector-cinetpay` (new): collections with CinetPay's API v1 in Benin, Burkina
    Faso, Côte d'Ivoire, Mali, Niger, Senegal, Togo, Cameroon and Guinea, by direct push
    (`mobile_money`) or CinetPay's hosted page (`hosted_page`, `redirect` next action). Status
    lookups by merchant reference, so a push that timed out is checked before any fallback.
  - `@payenv/core`: `refresh` keeps a payment's next action (e.g. a redirect URL) while the
    provider still reports `requires_action` without a new one.

### Patch Changes

- Updated dependencies [a5d32f6]
- Updated dependencies [4daec16]
  - @payenv/core@0.3.0
