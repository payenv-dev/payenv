/**
 * Payenv × FedaPay demo.
 *
 *   pnpm demo            (from the repository root)
 *
 * Needs FEDAPAY_SANDBOX_SECRET_KEY in the root .env file. Then open http://localhost:3000.
 * Sandbox test numbers: +22964000001 and +22966000001 succeed, any other number fails.
 *
 * Live mode (REAL money) is opt-in: DEMO_LIVE=yes and FEDAPAY_LIVE_SECRET_KEY in .env.
 * Amounts are capped by DEMO_LIVE_MAX_AMOUNT (default 200 XOF).
 *
 * Kkiapay (sandbox) is added when KKIAPAY_SANDBOX_PUBLIC_KEY, _PRIVATE_KEY and _SECRET_KEY
 * are set. Tick "Simuler une panne FedaPay" to watch Payenv fall back to its widget.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { fedapay, parseFedaPayWebhook, verifyFedaPayWebhook } from '@payenv/connector-fedapay';
import {
  KKIAPAY_WIDGET,
  kkiapay,
  parseKkiapayWebhook,
  verifyKkiapayWebhook,
} from '@payenv/connector-kkiapay';
import {
  type Connector,
  createMemoryStore,
  createPayenv,
  isPayenvError,
  PayenvError,
  type PayenvOptions,
  type Payment,
  toE164,
} from '@payenv/core';
import { page } from './page.ts';

const live = process.env.DEMO_LIVE === 'yes';
const maxLiveAmount = Number(process.env.DEMO_LIVE_MAX_AMOUNT ?? 200);
const secretKey = live
  ? process.env.FEDAPAY_LIVE_SECRET_KEY
  : process.env.FEDAPAY_SANDBOX_SECRET_KEY;

if (live) {
  if (!secretKey?.startsWith('sk_live')) {
    fail('DEMO_LIVE=yes requires FEDAPAY_LIVE_SECRET_KEY (sk_live_...) in .env.');
  }
  if (!Number.isSafeInteger(maxLiveAmount) || maxLiveAmount <= 0 || maxLiveAmount > 1000) {
    fail('DEMO_LIVE_MAX_AMOUNT must be an integer between 1 and 1000 XOF.');
  }
} else {
  if (!secretKey) {
    fail('Missing FEDAPAY_SANDBOX_SECRET_KEY. Copy .env.example to .env and fill it in.');
  }
  if (!secretKey.startsWith('sk_sandbox')) {
    fail('FEDAPAY_SANDBOX_SECRET_KEY must be a sandbox key (sk_sandbox_...).');
  }
}

const port = Number(process.env.PORT ?? 3000);

/** providerRef → idempotency key, to match webhooks with payments (a database in real life). */
const keysByProviderRef = new Map<string, string>();

const kkiapayKeys = {
  publicKey: process.env.KKIAPAY_SANDBOX_PUBLIC_KEY ?? '',
  privateKey: process.env.KKIAPAY_SANDBOX_PRIVATE_KEY ?? '',
  secretKey: process.env.KKIAPAY_SANDBOX_SECRET_KEY ?? '',
};
// Kkiapay is sandbox-only in this demo.
const withKkiapay =
  !live && Boolean(kkiapayKeys.publicKey && kkiapayKeys.privateKey && kkiapayKeys.secretKey);

const feda = fedapay({ secretKey, environment: live ? 'live' : 'sandbox' });
const kkia = withKkiapay ? [kkiapay(kkiapayKeys)] : [];

/** FedaPay as if it were down: rejects before any money can move, so fallback is safe. */
const fedaDown: Connector = {
  ...feda,
  async collect() {
    throw new PayenvError('PROVIDER_UNAVAILABLE', 'Simulated FedaPay outage (demo)', {
      connectorId: feda.id,
    });
  },
};

const shared: Omit<PayenvOptions, 'connectors'> = {
  // Both instances share one store, so refresh and confirm work for every payment.
  store: createMemoryStore(),
  onEvent(event) {
    if (event.type === 'attempt.finished') {
      const { attempt } = event;
      console.log(
        `[payenv] ${attempt.connectorId}: ${attempt.status} (${attempt.outcome})` +
          (attempt.error ? ` — ${attempt.error.code}: ${attempt.error.message}` : ''),
      );
    }
    if (event.type === 'fallback') {
      console.log(`[payenv] fallback ${event.from} → ${event.to} (${event.reason.code})`);
    }
  },
};
const payenv = createPayenv({ ...shared, connectors: [feda, ...kkia] });
const payenvWithOutage = createPayenv({ ...shared, connectors: [fedaDown, ...kkia] });

createServer((request, response) => {
  route(request, response).catch((error: unknown) => {
    console.error(error);
    send(response, 500, { error: 'Internal error' });
  });
  // Only reachable from this computer, never from the network.
}).listen(port, '127.0.0.1', () => {
  if (live) {
    console.warn('');
    console.warn('  ⚠️  LIVE MODE — payments move REAL money on your FedaPay account.');
    console.warn(`  ⚠️  Amounts are capped at ${maxLiveAmount} XOF. Stop with Ctrl+C.`);
    console.warn('');
  }
  console.log(`Payenv demo (${live ? 'LIVE' : 'sandbox'}) running on http://localhost:${port}`);
  console.log(`Connectors: fedapay${withKkiapay ? ', kkiapay (widget)' : ''}`);
});

async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', `http://${request.headers.host}`);

  if (request.method === 'GET' && url.pathname === '/') {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(page({ live, maxLiveAmount, withKkiapay }));
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/pay') {
    const body = JSON.parse(await readBody(request)) as {
      amount: number;
      phone: string;
      network: string;
      outage?: string;
      widgets?: string[];
    };
    if (live && !(Number(body.amount) <= maxLiveAmount)) {
      send(response, 400, {
        error: {
          code: 'INVALID_REQUEST',
          message: `Live demo amounts are capped at ${maxLiveAmount} XOF`,
        },
      });
      return;
    }
    try {
      const client = body.outage === 'on' ? payenvWithOutage : payenv;
      const payment = await client.collect({
        amount: { value: Number(body.amount), currency: 'XOF' },
        // Customers type local numbers: convert to E.164 before calling Payenv.
        method: {
          type: 'mobile_money',
          network: body.network,
          country: 'BJ',
          phone: toE164(body.phone, 'BJ'),
        },
        customer: { firstName: 'Demo', lastName: 'Payenv', email: 'demo@example.com' },
        description: live ? 'Payenv demo (live test)' : 'Payenv demo',
        idempotencyKey: `demo_${Date.now()}`,
        // The page declares which widgets it can open.
        supportedWidgets: (body.widgets ?? []).filter((widget) => widget === KKIAPAY_WIDGET),
      });
      if (payment.providerRef) keysByProviderRef.set(payment.providerRef, payment.idempotencyKey);
      send(response, 200, view(payment));
    } catch (error) {
      // Invalid requests (bad phone, no route...) are thrown, not returned as payments.
      if (isPayenvError(error)) send(response, 400, { error: error.toJSON() });
      else throw error;
    }
    return;
  }

  const confirmMatch = /^\/api\/payments\/([\w-]+)\/confirm$/.exec(url.pathname);
  if (request.method === 'POST' && confirmMatch?.[1]) {
    const { transactionId } = JSON.parse(await readBody(request)) as { transactionId: string };
    try {
      // Verified with Kkiapay: right payment (partnerId) and right amount.
      send(response, 200, view(await payenv.confirm(confirmMatch[1], transactionId)));
    } catch (error) {
      if (isPayenvError(error)) send(response, 400, { error: error.toJSON() });
      else throw error;
    }
    return;
  }

  const match = /^\/api\/payments\/([\w-]+)$/.exec(url.pathname);
  if (request.method === 'GET' && match?.[1]) {
    const payment = await payenv.refresh(match[1]);
    send(response, 200, view(payment));
    return;
  }

  if (request.method === 'POST' && url.pathname === '/webhooks/fedapay') {
    // Reachable only through a tunnel (e.g. ngrok) set as the webhook URL in FedaPay.
    const raw = await readBody(request);
    const signature = request.headers['x-fedapay-signature'];
    const valid = await verifyFedaPayWebhook(
      raw,
      Array.isArray(signature) ? signature[0] : signature,
      process.env.FEDAPAY_WEBHOOK_SECRET ?? '',
    );
    if (!valid) {
      console.log('[webhook] INVALID signature — ignored');
      send(response, 400, { received: false });
      return;
    }
    const event = parseFedaPayWebhook(raw);
    // A real application looks the payment up in its own database by providerRef.
    const key = event && keysByProviderRef.get(event.providerRef);
    if (event && key) {
      // The webhook is a hint: ask FedaPay for the authoritative status.
      const payment = await payenv.refresh(key);
      console.log(`[webhook] ${event.name} → payment ${key} is now ${payment.status}`);
    } else {
      console.log(`[webhook] ${event?.name ?? 'unrecognized event'} — no matching payment`);
    }
    send(response, 200, { received: true });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/webhooks/kkiapay') {
    const raw = await readBody(request);
    const header = request.headers['x-kkiapay-secret'];
    if (
      !verifyKkiapayWebhook(
        Array.isArray(header) ? header[0] : header,
        process.env.KKIAPAY_WEBHOOK_SECRET ?? '',
      )
    ) {
      console.log('[webhook] Kkiapay: INVALID secret — ignored');
      send(response, 400, { received: false });
      return;
    }
    const event = parseKkiapayWebhook(raw);
    if (event?.merchantReference) {
      // partnerId is the payment's idempotency key; confirm verifies with Kkiapay.
      const payment = await payenv.confirm(event.merchantReference, event.providerRef);
      console.log(
        `[webhook] ${event.name} → payment ${payment.idempotencyKey} is now ${payment.status}`,
      );
    }
    send(response, 200, { received: true });
    return;
  }

  send(response, 404, { error: 'Not found' });
}

/** What the page shows. The phone number is masked, as it should be in any log or UI. */
function view(payment: Payment) {
  const phone = payment.method.type === 'mobile_money' ? payment.method.phone : '';
  return {
    key: payment.idempotencyKey,
    status: payment.status,
    connector: payment.connectorId,
    providerRef: payment.providerRef,
    phone: phone.replace(/^(\+\d{3})\d+(\d{2})$/, '$1••••••$2'),
    error: payment.error,
    nextAction: payment.nextAction,
    attempts: payment.attempts.map(({ connectorId, status, outcome, error }) => ({
      connectorId,
      status,
      outcome,
      error: error?.code,
    })),
  };
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => {
      data += chunk;
    });
    request.on('end', () => resolve(data));
    request.on('error', reject);
  });
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}
