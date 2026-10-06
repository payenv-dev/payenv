# @payenv/connector-kkiapay

## 0.3.0

### Patch Changes

- Updated dependencies [4daec16]
  - @payenv/core@0.3.0

## 0.2.0

### Minor Changes

- a80b939: Kkiapay, and payments started by the customer in a widget.
  
  - `@payenv/core`: `nextAction.type === 'widget'`, `supportedWidgets` and
    `Capability.widget` for providers whose payments start in a widget; `payenv.confirm`
    verifies the provider transaction's merchant reference and amount before linking it.
    New error code `REFERENCE_MISMATCH`. `toE164` converts phone numbers typed by customers
    to E.164.
  - `@payenv/connector-kkiapay` (new): Kkiapay widget payments in Benin (MTN, Moov),
    server-side verification, webhook verification and parsing.

### Patch Changes

- Updated dependencies [a80b939]
  - @payenv/core@0.2.0
