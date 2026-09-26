# Connectors

A connector is an adapter for one payment aggregator. See
[ARCHITECTURE.md §2](ARCHITECTURE.md#2-connectors) for the interface.

## Status

| Connector | Region | Collect | Payout | Refund | Webhooks | Status | Maintainer |
|---|---|---|---|---|---|---|---|
| FedaPay | Benin / West Africa | — | — | — | — | 🟡 In design (first connector) | TBD |
| Kkiapay | West Africa | — | — | — | — | ⚪ Planned | — |
| CinetPay | West & Central Africa | — | — | — | — | ⚪ Planned | — |
| PayDunya | West Africa | — | — | — | — | ⚪ Planned | — |
| Flutterwave | Pan-African | — | — | — | — | ⚪ Planned | — |
| Paystack | Pan-African | — | — | — | — | ⚪ Planned | — |
| Stripe | Global | — | — | — | — | ⚪ Planned | — |

Legend: ⚪ planned · 🟡 in progress · 🟢 stable · 🔴 unmaintained

The list is only a starting point. Want another provider? Open an issue with the
`connector-request` label.

## Requirements for a connector to be marked stable

- [ ] Implements `collect` and `getStatus`, plus webhooks, and at least declares the
      operations it does not support.
- [ ] Declares accurate capabilities (countries, currencies, networks, operations).
- [ ] Maps every documented provider error to a Payenv error code **with a retry class**.
- [ ] Verifies webhook signatures, including anti-replay where the provider supports it.
- [ ] Never logs secrets or unmasked personal data.
- [ ] Has sandbox integration tests and recorded fixtures for offline tests.
- [ ] Has a `QUIRKS.md` documenting surprises (undocumented endpoints, slug differences, etc.).
- [ ] Has at least one named maintainer.

## Example quirk worth documenting (FedaPay)

Collection and payout use different operator slugs (`mtn_open` vs `mtn`), and the
mobile money push endpoint path differs from what the public docs suggest.
Payenv's job is to handle this once, so no integrator has to rediscover it.
