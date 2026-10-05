# Payenv

> **One payment environment. Many aggregators. Zero rewrites.**

🇫🇷 [Lire en français](README.fr.md)

**Status:** 🌱 Early development — the core engine exists, no connector or release yet. Started on **2026-09-26**.
**License:** [Apache 2.0](LICENSE) — free for personal and commercial use, forever.

---

## The problem

When you integrate payments, you usually pick **one** aggregator (FedaPay, Kkiapay,
CinetPay, Flutterwave, Paystack, Stripe…). Then reality hits:

- The aggregator is **down**, and you have no plan B.
- It **doesn't support a network** your customer uses (a given mobile money operator,
  a country, a currency) while another aggregator does.
- Another one is **cheaper** or has a **better success rate** for that specific route.
- You want to **migrate** and discover that your whole codebase speaks the old
  provider's API.

So every team ends up writing, again and again, the same glue code: adapters, fallback
logic, dynamic provider selection, webhook normalization, status polling, error mapping.
It's hard to get right, and a subtle mistake here means **charging a customer twice**.

## The idea

Payenv is an **open-source payment orchestration library**: a single, stable API in
front of many payment aggregators.

```ts
// Illustrative only — the API is not final.
const payenv = createPayenv({
  connectors: [fedapay({ secretKey }), kkiapay({ ... }), cinetpay({ ... })],
  routing: fallback({ order: ['fedapay', 'kkiapay', 'cinetpay'] }),
});

const payment = await payenv.collect({
  amount: { value: 5000, currency: 'XOF' },
  method: { type: 'mobile_money', network: 'mtn', country: 'BJ', phone: '+22990000000' },
  customer: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' },
  idempotencyKey: 'order_1234',
});
// → Payenv picks a connector that supports MTN / BJ / XOF, tries it,
//   and safely falls back to the next one if it fails *before* money moved.
```

What Payenv gives you:

| Capability | What it means |
|---|---|
| **Unified API** | One request/response model for collections, payouts, refunds and status. |
| **Connectors** | Pluggable adapters, one per aggregator, all behind the same interface. |
| **Capability-aware routing** | Only providers that support the country / currency / network / method are considered. |
| **Safe fallback** | Retries on another provider only when it is *proven* no money moved. |
| **Routing strategies** | Priority, weighted, cheapest, best success rate — or your own function. |
| **Normalized webhooks** | Signature verification per provider, one event format for your app. |
| **Normalized statuses & errors** | `succeeded`, `failed`, `pending`… and a shared error taxonomy. |

## Try it

A runnable demo collects a real sandbox payment through FedaPay in a minute:
see [examples/fedapay-demo](examples/fedapay-demo).

## Principles

1. **Library first.** Payenv runs *inside your app*. No hosted service required, no
   middleman.
2. **We never touch your money or your keys.** Funds flow directly between your
   customer, the aggregator and you. Credentials stay in your infrastructure.
3. **Correctness over cleverness.** Never double-charge. Ambiguous states are
   resolved, not guessed.
4. **No lock-in.** Not to a provider — and not to Payenv either.
5. **No telemetry.** Payenv doesn't phone home. Ever.
6. **Free forever.** Apache 2.0, community-governed.

## Documentation

- [Vision](docs/VISION.md) — why this project exists and where it's going
- [Architecture](docs/ARCHITECTURE.md) — core concepts: connectors, router, statuses, webhooks
- [Connectors](docs/CONNECTORS.md) — supported and planned aggregators
- [Roadmap](docs/ROADMAP.md) — milestones
- [Decision records](docs/adr/) — why things are the way they are
- [Contributing](CONTRIBUTING.md) · [Code of Conduct](CODE_OF_CONDUCT.md) ·
  [Security](SECURITY.md) · [Governance](GOVERNANCE.md) · [Changelog](CHANGELOG.md)

## Contributing

The project is at its very beginning: this is the best moment to shape it.
Ideas, critiques, and knowledge of specific aggregators' quirks are as valuable as
code. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Disclaimer

Payenv is not a payment provider, not a bank, and not affiliated with any of the
aggregators it connects to. All trademarks belong to their respective owners.
Payenv is provided "as is", without warranty — see the [LICENSE](LICENSE).

## License

Copyright 2026 The Payenv Authors.
Licensed under the [Apache License, Version 2.0](LICENSE).
