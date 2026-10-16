# Payenv

> **One payment environment. Many aggregators. Zero rewrites.**

[![npm @payenv/core](https://img.shields.io/npm/v/@payenv/core?label=%40payenv%2Fcore)](https://www.npmjs.com/package/@payenv/core)
[![CI](https://github.com/payenv-dev/payenv/actions/workflows/ci.yml/badge.svg)](https://github.com/payenv-dev/payenv/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)

🇫🇷 [Lire en français](README.fr.md)

Payenv is an **open-source TypeScript library** that puts one stable payment API in front
of several payment aggregators (FedaPay, Kkiapay, CinetPay…). It routes each payment to a
provider that supports it, and **falls back to another provider only when it is proven
that no money moved**: never a double charge.

**Status:** 🌱 Pre-release `0.x`. It works and is published on npm, but the API may still
change between minor versions. Started on 2026-09-26.

---

## Why

When you integrate payments, you usually pick **one** aggregator. Then:

- It is **down**, and you have no plan B.
- It **doesn't support a network** your customer uses (an operator, a country, a
  currency), while another aggregator does.
- You want to **switch providers**, and your whole codebase speaks the old one's API.

Every team ends up rewriting the same glue: adapters, fallback, status polling, webhook
parsing, error mapping. It's hard to get right, and one subtle mistake means **charging a
customer twice**. Payenv does it once, in the open, with tests.

## Example

```ts
import { createPayenv, priority } from '@payenv/core';
import { fedapay } from '@payenv/connector-fedapay';
import { cinetpay } from '@payenv/connector-cinetpay';

const payenv = createPayenv({
  connectors: [
    fedapay({ secretKey: process.env.FEDAPAY_SECRET_KEY! }),
    cinetpay({
      credentials: {
        BJ: {
          apiKey: process.env.CINETPAY_API_KEY_BJ!,
          apiPassword: process.env.CINETPAY_API_PASSWORD_BJ!,
        },
      },
      notifyUrl: (key) => `https://shop.example/webhooks/cinetpay?key=${key}`,
    }),
  ],
  routing: priority(['fedapay', 'cinetpay']), // FedaPay first, CinetPay as a fallback
});

const payment = await payenv.collect({
  amount: { value: 5000, currency: 'XOF' }, // integer, in the currency's minor unit
  method: { type: 'mobile_money', network: 'mtn', country: 'BJ', phone: '+22997000000' },
  customer: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' },
  idempotencyKey: 'order_1234', // retries with the same key never charge twice
});

payment.status; // 'pending': the customer confirms on their phone
await payenv.refresh('order_1234'); // later: ask the provider for the latest status
```

If FedaPay is down **before** the push is sent, Payenv tries CinetPay. If FedaPay times
out **after** the push may have been sent, Payenv first asks FedaPay what happened, and
only moves on if FedaPay confirms nothing was charged.

## Packages

| Package | What it does | Countries |
|---|---|---|
| [`@payenv/core`](packages/core) | Unified model, router, safe-fallback engine, in-memory store | — |
| [`@payenv/connector-fedapay`](packages/connector-fedapay) | Mobile money push and payouts (MTN, Moov, Celtiis), signed webhooks | 🇧🇯 Benin |
| [`@payenv/connector-kkiapay`](packages/connector-kkiapay) | Payments in the Kkiapay widget, verified server-side (MTN, Moov) | 🇧🇯 Benin |
| [`@payenv/connector-cinetpay`](packages/connector-cinetpay) | Mobile money push, hosted payment page, payouts | 🇧🇯 🇧🇫 🇨🇮 🇲🇱 🇳🇪 🇸🇳 🇹🇬 🇨🇲 🇬🇳 |

```sh
npm install @payenv/core @payenv/connector-fedapay
# and/or @payenv/connector-kkiapay, @payenv/connector-cinetpay
```

Node.js 20.19+, Deno, Bun or any runtime with `fetch` and Web Crypto. ESM and `require`.
No runtime dependencies.

The CinetPay connector is built from CinetPay's official SDK and tested against a fake API;
it has not been verified against the CinetPay sandbox yet (see its
[QUIRKS.md](packages/connector-cinetpay/QUIRKS.md)). Check the [changelog](CHANGELOG.md)
for what each npm version contains.

## Features

**Available today**

| Feature | API |
|---|---|
| Collect a payment (mobile money push, hosted page, provider widget) | `payenv.collect(request)` |
| Send money to a mobile money number | `payenv.payout(request)` |
| Get the latest status from the provider | `payenv.refresh(idempotencyKey)` |
| Confirm a payment made in a provider's widget (checks reference and amount) | `payenv.confirm(idempotencyKey, providerRef)` |
| Read a payment from the store | `payenv.getPayment(idempotencyKey)` |
| Idempotency: the same key always returns the same payment | `idempotencyKey` |
| Capability-aware routing (operation, method, country, currency, network) | automatic |
| Safe fallback between providers, ambiguous calls checked with the provider first | automatic |
| Routing order, or your own strategy function | `priority([...])`, `routing: (candidates, request) => …` |
| Normalized statuses and errors, with the provider's own code kept | `payment.status`, `payment.error` |
| Lifecycle events (attempts, fallbacks) for your logs and metrics | `onEvent` |
| Pluggable store (bring your database; in-memory by default) | `Store` |
| Webhook verification and parsing, per connector | e.g. `verifyFedaPayWebhook` |
| Phone numbers typed by customers converted to E.164 | `toE164('61 00 00 00', 'BJ')` |

**Planned** (see the [roadmap](docs/ROADMAP.md)): refunds, `@payenv/store-postgres`,
circuit breaker, normalized webhook handling with deduplication, `weighted` / `cheapest` /
`bestSuccessRate` strategies, more connectors (PayDunya, Flutterwave, Paystack, Stripe…),
a PHP / Laravel port.

## Get started

- [Getting started](docs/GETTING_STARTED.md): your first payment in 5 minutes.
- [Web demo](examples/fedapay-demo): collects a sandbox payment through FedaPay, with a
  fallback to Kkiapay. Run it with `pnpm demo`.

## Principles

1. **Library first.** Payenv runs *inside your app*. No hosted service, no middleman.
2. **We never touch your money or your keys.** Funds flow directly between your customer,
   the aggregator and you. Credentials stay in your infrastructure.
3. **Correctness over cleverness.** Never double-charge. Ambiguous states are resolved,
   not guessed ([ADR 0004](docs/adr/0004-no-fallback-on-ambiguous-state.md)).
4. **No lock-in.** Not to a provider, and not to Payenv either.
5. **No telemetry.** Payenv doesn't phone home. Ever.
6. **Free forever.** Apache 2.0, community-governed.

## Develop

Requirements: Node.js 20.19+ and [pnpm](https://pnpm.io) 9.

```sh
pnpm install
pnpm check       # lint + typecheck + tests
pnpm test        # tests only (sandbox tests run when .env has sandbox keys)
pnpm test:watch  # tests in watch mode
pnpm format      # format with Biome
pnpm build       # compile every package to dist/
pnpm demo        # build and start the web demo on http://localhost:3000
pnpm changeset   # describe your change for the next release
```

Sandbox tests are opt-in: copy `.env.example` to `.env` (git-ignored) and fill in
**sandbox** credentials.

```
packages/
  core/                 @payenv/core
  connector-fedapay/    @payenv/connector-fedapay
  connector-kkiapay/    @payenv/connector-kkiapay
  connector-cinetpay/   @payenv/connector-cinetpay
examples/
  fedapay-demo/         runnable web demo
docs/                   guides, architecture, decision records
```

## Documentation

- [Getting started](docs/GETTING_STARTED.md): your first payment in 5 minutes
- [Connectors](docs/CONNECTORS.md): supported and planned aggregators
- [Architecture](docs/ARCHITECTURE.md): connectors, router, statuses, fallback
- [Vision](docs/VISION.md) · [Roadmap](docs/ROADMAP.md) · [Decision records](docs/adr/)
- [Contributing](CONTRIBUTING.md) · [Code of Conduct](CODE_OF_CONDUCT.md) ·
  [Security](SECURITY.md) · [Governance](GOVERNANCE.md) · [Changelog](CHANGELOG.md)

## Contributing

The project is young: this is the best moment to shape it. Field knowledge of
aggregators (undocumented errors, sandbox quirks, which operators really work) is as
valuable as code. Want a provider? Open an issue with the `connector-request` label.
See [CONTRIBUTING.md](CONTRIBUTING.md).

## Disclaimer

Payenv is not a payment provider, not a bank, and not affiliated with any of the
aggregators it connects to. All trademarks belong to their respective owners.
Payenv is provided "as is", without warranty: see the [LICENSE](LICENSE).

## License

Copyright 2026 The Payenv Authors.
Licensed under the [Apache License, Version 2.0](LICENSE).
