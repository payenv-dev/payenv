---
'@payenv/core': minor
'@payenv/connector-fedapay': minor
'@payenv/connector-kkiapay': minor
---

Kkiapay, and payments started by the customer in a widget.

- `@payenv/core`: `nextAction.type === 'widget'`, `supportedWidgets` and
  `Capability.widget` for providers whose payments start in a widget; `payenv.confirm`
  verifies the provider transaction's merchant reference and amount before linking it.
  New error code `REFERENCE_MISMATCH`. `toE164` converts phone numbers typed by customers
  to E.164.
- `@payenv/connector-kkiapay` (new): Kkiapay widget payments in Benin (MTN, Moov),
  server-side verification, webhook verification and parsing.
