# Payenv × FedaPay demo

A tiny web page to collect a mobile money payment through Payenv and FedaPay's sandbox,
and watch its status change live. No framework, no dependency besides Payenv.

## Run it

1. At the repository root, copy `.env.example` to `.env` and set your **sandbox** key:
   ```
   FEDAPAY_SANDBOX_SECRET_KEY=sk_sandbox_...
   ```
2. From the repository root:
   ```sh
   pnpm install
   pnpm demo
   ```
3. Open http://localhost:3000

Sandbox test numbers: `+22964000001` and `+22966000001` succeed; any other number
simulates a failed payment.

## Live mode (real money)

To check that a real USSD prompt reaches your phone, the demo has an opt-in live mode.
**It moves real money** on your FedaPay account (FedaPay fees apply).

Add to `.env`:
```
DEMO_LIVE=yes
FEDAPAY_LIVE_SECRET_KEY=sk_live_...
DEMO_LIVE_MAX_AMOUNT=200
```

Safeguards: the live key lives in its own variable (a sandbox key is refused, and vice
versa), amounts are capped (200 XOF by default, 1000 at most), a warning is shown in the
terminal and the page, and the server only listens on `127.0.0.1`. The operator (MTN,
Moov, Celtiis) must be activated on your merchant account. Remove `DEMO_LIVE` when done.

## What to look at

- [server.ts](server.ts): `createPayenv` with the FedaPay connector, `payenv.collect`
  to start a payment, `payenv.refresh` to follow it, and `verifyFedaPayWebhook` for
  webhooks (reachable only through a tunnel such as ngrok).
- The terminal logs every attempt: connector, status, and outcome.
- Phone numbers are masked in the page and in logs.

Requires Node.js 22.18+ (it runs `server.ts` directly with Node's built-in type stripping).
