---
'@payenv/connector-cinetpay': minor
'@payenv/core': minor
---

CinetPay connector.

- `@payenv/connector-cinetpay` (new): collections with CinetPay's API v1 in Benin, Burkina
  Faso, Côte d'Ivoire, Mali, Niger, Senegal, Togo, Cameroon and Guinea, by direct push
  (`mobile_money`) or CinetPay's hosted page (`hosted_page`, `redirect` next action). Status
  lookups by merchant reference, so a push that timed out is checked before any fallback.
- `@payenv/core`: `refresh` keeps a payment's next action (e.g. a redirect URL) while the
  provider still reports `requires_action` without a new one.
