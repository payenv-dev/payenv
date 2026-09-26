# Contributing to Payenv

Thank you for considering a contribution! Payenv is at a very early stage, so
**ideas, critiques, and field knowledge are as valuable as code.**

Contributions in English or French are welcome.

## Ways to contribute

- **Discuss the design.** Read [ARCHITECTURE.md](docs/ARCHITECTURE.md) and open an
  issue if something looks wrong, unsafe, or missing.
- **Share provider knowledge.** Undocumented behaviors, error codes, sandbox quirks,
  which operators each aggregator really supports: this is gold.
- **Write or maintain a connector.** See [CONNECTORS.md](docs/CONNECTORS.md).
- **Improve documentation and translations.**
- **Report bugs** — or security issues **privately**, see [SECURITY.md](SECURITY.md).

## Ground rules

- Be respectful. This project follows the [Code of Conduct](CODE_OF_CONDUCT.md).
- **Never** paste real API keys, webhook secrets, customer phone numbers, or other
  personal data in issues, PRs, tests, or fixtures. Use sandbox keys and fake data.
- Significant design changes start with an issue or an
  [Architecture Decision Record](docs/adr/) before code.

## Workflow

1. Open (or pick) an issue and say you're working on it.
2. Fork the repository and create a branch: `feat/…`, `fix/…`, `docs/…`, `connector/<name>`.
3. Make focused commits using [Conventional Commits](https://www.conventionalcommits.org/):
   `feat(core): add priority routing strategy`, `fix(fedapay): map timeout as ambiguous`.
4. Add or update tests. Any change to the attempt engine or fallback logic **must**
   come with tests proving no double charge is possible.
5. Update docs and `CHANGELOG.md` (under `Unreleased`) when behavior changes.
6. Open a pull request describing *what* and *why*.

## Developer Certificate of Origin (DCO)

Payenv uses the [Developer Certificate of Origin](https://developercertificate.org/)
instead of a CLA. By signing off your commits, you certify that you wrote the code
or otherwise have the right to submit it under the Apache 2.0 license.

Sign off each commit with `-s`:

```sh
git commit -s -m "feat(core): add capability filter"
```

This adds a line like `Signed-off-by: Your Name <you@example.com>` to the commit.

## Licensing of contributions

All contributions are licensed under the [Apache License 2.0](LICENSE), per
section 5 of the license. Don't submit code copied from sources with an
incompatible license (e.g. GPL) or from a provider's proprietary SDK unless its
license explicitly allows it.

## Development setup

Requirements: Node.js 20.19+ and [pnpm](https://pnpm.io) 9.

```sh
pnpm install
pnpm check      # lint + typecheck + tests
pnpm test:watch # tests in watch mode
pnpm format     # auto-format with Biome
pnpm build      # compile every package to dist/
```

Layout:

```
packages/
  core/          @payenv/core — model, router, attempt engine (zero runtime dependencies)
    src/
    test/
```

The stack is TypeScript 7 (`tsc`), Vitest for tests, and Biome for lint and format.
