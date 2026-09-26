# Governance

*Adopted 2026-09-26. This model is meant to evolve as the community grows.*

## Principles

- Payenv is and will remain **free and open source** under Apache 2.0.
- Decisions are made in the open (issues, discussions, ADRs).
- The project must be able to outlive any single person, company, or sponsor.

## Roles

**Contributors** — anyone who contributes code, docs, reviews, or knowledge.

**Connector maintainers** — own one or more connectors: review changes, keep them
working when providers change their APIs, and triage related issues.

**Core maintainers** — review and merge changes to the core, manage releases, and
steward the roadmap.

**Project lead** — the founder, **Jules Mahounou** ([@jules-mahounou](https://github.com/jules-mahounou)), during the bootstrap
phase. The lead breaks ties and makes the final call when consensus cannot be reached.

## Decision making

1. **Lazy consensus** by default: a proposal with no objection after a reasonable
   period (usually 72 hours for significant changes) is accepted.
2. Significant or hard-to-reverse decisions (public API, invariants, license,
   governance) are recorded as an [ADR](docs/adr/).
3. If consensus fails, core maintainers vote. The project lead breaks ties.

## Becoming a maintainer

Sustained, high-quality contributions and good judgment in reviews. Existing core
maintainers nominate; lazy consensus confirms.

## Evolution

Once there are at least three active core maintainers from more than one
organization, the project will move to a steering committee model and consider
joining a neutral foundation.

## Funding

Donations or sponsorship may be accepted to cover infrastructure, audits, and
maintainers' time. Sponsorship never buys control over technical decisions or
preferential treatment of a provider.
