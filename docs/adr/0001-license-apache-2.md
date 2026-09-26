# 0001. License: Apache 2.0

- **Status:** Accepted
- **Date:** 2026-09-26

## Context

Payenv must be free for everyone — individuals, startups, and large companies —
to maximize adoption, like widely used open-source infrastructure. Payment is a
domain where companies are cautious about legal risk, including patents.

## Decision

Payenv is licensed under the **Apache License 2.0**. Contributions are accepted
under the same license, with a DCO sign-off (no CLA).

## Consequences

- Permissive: commercial use, modification, and redistribution are allowed.
- **Explicit patent grant** from contributors, with patent-retaliation protection —
  reassuring for companies in the payment industry.
- Compatible with most other permissive licenses; incompatible with GPLv2-only code.
- Anyone may build proprietary products on top of Payenv. We accept this as the
  price of maximum adoption.

## Alternatives considered

- **MIT** — simpler, equally permissive, but no explicit patent grant.
- **MPL 2.0** — file-level copyleft; adds friction for some companies.
- **AGPL / GPL** — would keep derivatives open but would significantly limit adoption
  in commercial payment stacks.
