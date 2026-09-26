# Security Policy

Payenv sits in the payment path of the applications that use it. We take security
reports very seriously.

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report privately through one of these channels:

- GitHub → *Security* tab → **Report a vulnerability** (private advisory) — preferred
- Email: **payenv.project@gmail.com** (subject: `[SECURITY]`)

Please include:
- A description of the issue and its impact (e.g. double charge, webhook forgery,
  secret leak)
- Steps to reproduce, affected versions / connectors
- Any suggested fix

## Our commitment

- Acknowledgement within **72 hours**
- An initial assessment within **7 days**
- A fix or mitigation as fast as possible, coordinated disclosure with you, and
  credit in the advisory if you want it

## Supported versions

| Version | Supported |
|---|---|
| `0.x` (pre-release) | Latest minor only |

## Scope

In scope, with particular attention to:
- Anything that could cause a **double charge** or a lost payment
- Webhook signature verification bypasses or replay
- Leakage of credentials or personal data (logs, errors, telemetry)
- Idempotency failures

Out of scope: vulnerabilities in the payment providers themselves. Report those to
the providers directly.

## For integrators

- Keep provider secrets in environment variables or a secret manager — never in code.
- Always pass the **raw, unparsed** request body to webhook verification.
- Use sandbox credentials in development and CI.
