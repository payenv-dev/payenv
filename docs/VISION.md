# Vision

*Written 2026-09-26, at the start of the project.*

## Why Payenv exists

Payment integration is one of the most repeated pieces of work in software. Every
team that sells something writes an adapter for an aggregator, then — sooner or
later — a second one, then fallback logic, then provider selection rules, then a
webhook normalizer. None of this is their product. All of it is risky.

Open-source infrastructure has already solved this kind of problem elsewhere.
Cryptography libraries, TLS stacks, databases, and compilers are shared, free, and
used by billions of people daily. Nobody rewrites their own TLS. **Nobody should
have to rewrite their own payment orchestration either.**

Payenv aims to be that shared layer: a stable, audited, community-owned environment
in which, year after year, more and more aggregators can be combined.

## Who it's for

- **Developers and small teams** who want resilience (fallback) without building it.
- **Businesses in multi-provider markets** — especially where mobile money dominates
  and no single aggregator covers every operator, country, or currency.
- **Aggregator-agnostic products** that want to let their users choose a provider.

## What makes it different

Payment orchestration already exists — as commercial SaaS platforms and as a few
large open-source servers. Payenv takes a different position:

| | Payenv |
|---|---|
| **Form** | A library you import, not a server you must operate. A server mode may come later, built on the same core. |
| **Custody** | None. Payenv never holds funds or credentials. |
| **Focus** | Mobile money and African aggregators as first-class citizens, then global providers. |
| **Cost** | Free, Apache 2.0, no paid tier gating features. |

We respect and learn from prior art. Where another project solves a problem well,
we should say so, and interoperate where it makes sense.

## Long-term goals

1. **Breadth:** dozens of well-maintained connectors, each with a clear owner.
2. **Trust:** a public test suite per connector (sandbox-based), security audits,
   and a documented threat model.
3. **Multiple languages:** a TypeScript core first, then SDKs for other ecosystems
   (PHP, Python, Go, Java/Kotlin, Dart…), sharing one specification.
4. **A shared specification:** the unified payment model, statuses, and error
   taxonomy documented independently of any implementation, so anyone can build a
   compatible implementation.
5. **Neutral governance:** the project must outlive any single maintainer or sponsor.

## Non-goals

- Payenv is **not a payment provider**, a wallet, or a bank.
- Payenv does **not** store card numbers. Card flows go through each provider's own
  tokenization / hosted fields, keeping integrators out of PCI DSS scope as much
  as possible.
- Payenv does **not** collect analytics about its users.
