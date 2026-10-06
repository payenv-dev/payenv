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
} from '@payenv/core';

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
    response.end(page());
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
        method: { type: 'mobile_money', network: body.network, country: 'BJ', phone: body.phone },
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

function page(): string {
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Payenv demo</title>
<style>
  :root { color-scheme: light dark; --accent: #2563eb; --ok: #16a34a; --ko: #dc2626; --wait: #d97706; }
  body { font: 16px/1.5 system-ui, sans-serif; max-width: 520px; margin: 40px auto; padding: 0 16px; }
  h1 { margin-bottom: 0; } p.sub { margin-top: 4px; opacity: .7; }
  form { display: grid; gap: 12px; margin: 24px 0; }
  label { display: grid; gap: 4px; font-weight: 600; font-size: 14px; }
  input, select, button { font: inherit; padding: 10px 12px; border-radius: 8px; border: 1px solid #8884; }
  button { background: var(--accent); color: white; border: 0; font-weight: 600; cursor: pointer; }
  button:disabled { opacity: .5; cursor: wait; }
  .hint { font-size: 13px; opacity: .7; }
  #result { border: 1px solid #8884; border-radius: 12px; padding: 16px; display: none; }
  .badge { display: inline-block; padding: 2px 10px; border-radius: 999px; color: white; font-weight: 600; }
  .succeeded { background: var(--ok); } .failed, .canceled, .expired { background: var(--ko); }
  .pending, .requires_action, .created, .unknown { background: var(--wait); }
  .live { background: var(--ko); color: white; padding: 10px 14px; border-radius: 8px; }
  .check { display: flex; gap: 8px; align-items: center; font-weight: 400; }
  pre { font-size: 12px; overflow-x: auto; background: #8881; padding: 8px; border-radius: 8px; }
</style>
</head>
<body>
<h1>Payenv demo</h1>
<p class="sub">Paiement mobile money via FedaPay${withKkiapay ? ' et Kkiapay' : ''} (${live ? 'LIVE' : 'sandbox'})</p>
${live ? `<p class="live">⚠️ Mode LIVE : <strong>vrai argent</strong>. Montant plafonné à ${maxLiveAmount} XOF.</p>` : ''}
<form id="pay">
  <label>Montant (XOF) <input name="amount" type="number" min="1" ${live ? `max="${maxLiveAmount}"` : ''} value="100" required></label>
  <label>Réseau
    <select name="network"><option value="mtn">MTN</option><option value="moov">Moov</option><option value="celtiis">Celtiis</option></select>
  </label>
  <label>Téléphone <input name="phone" value="${live ? '' : '+22964000001'}" placeholder="+229…" required></label>
  <span class="hint">${live ? 'Votre vrai numéro, au format international (+229…). Vous recevrez une demande de validation USSD.' : 'Sandbox : +22964000001 ou +22966000001 = succès · tout autre numéro = échec'}</span>
  ${
    withKkiapay
      ? `<label class="check"><input type="checkbox" name="outage"> Simuler une panne FedaPay (Payenv bascule vers le widget Kkiapay)</label>
  <span class="hint">Widget Kkiapay (sandbox) : 61000000 ou 97000000 (MTN) = succès · 61000002 = fonds insuffisants</span>`
      : ''
  }
  <button>Payer</button>
</form>
<div id="result">
  <div>Statut : <span id="status" class="badge"></span></div>
  <p id="message"></p>
  <pre id="details"></pre>
</div>
${withKkiapay ? '<script src="https://cdn.kkiapay.me/k.js"></script>' : ''}
<script>
  const form = document.getElementById('pay');
  let currentKey = null;
  async function confirmWidget(transactionId) {
    const response = await fetch('/api/payments/' + currentKey + '/confirm', {
      method: 'POST', body: JSON.stringify({ transactionId }),
    });
    const result = await response.json();
    show(response.ok ? result : { status: 'failed', error: result.error });
  }
  if (window.addSuccessListener) {
    // The widget reports a transaction id; the server verifies it before trusting it.
    addSuccessListener((response) => confirmWidget(response.transactionId));
  }
  function openWidget(action) {
    if (action.provider === 'kkiapay' && window.openKkiapayWidget) openKkiapayWidget(action.params);
  }
  const terminal = ['succeeded', 'failed', 'canceled', 'expired'];
  function show(payment) {
    document.getElementById('result').style.display = 'block';
    const badge = document.getElementById('status');
    badge.textContent = payment.status;
    badge.className = 'badge ' + payment.status;
    const reason = payment.error ? payment.error.code + ' — ' + payment.error.message : '';
    document.getElementById('message').textContent =
      payment.status === 'requires_action'
        ? 'Le client paie dans le widget ' + (payment.nextAction?.provider ?? '') + '…' +
          (payment.attempts?.length > 1 ? ' (bascule après : ' + payment.attempts[0].error + ')' : '')
        : payment.status === 'pending'
        ? (reason
            ? 'FedaPay signale : ' + reason + '. Le statut reste « pending » chez FedaPay : Payenv ne devine pas.'
            : 'Le client doit valider sur son téléphone… (vérification toutes les 2 s)')
        : reason;
    document.getElementById('details').textContent = JSON.stringify(payment, null, 2);
  }
  async function poll(key) {
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const payment = await (await fetch('/api/payments/' + key)).json();
      show(payment);
      if (terminal.includes(payment.status)) return;
    }
    document.getElementById('message').textContent +=
      ' — Toujours en attente après 1 minute. Une vraie application revérifie plus tard avec payenv.refresh().';
  }
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button');
    button.disabled = true;
    try {
      const data = Object.fromEntries(new FormData(form));
      data.widgets = window.openKkiapayWidget ? ['kkiapay'] : [];
      const response = await fetch('/api/pay', { method: 'POST', body: JSON.stringify(data) });
      const payment = await response.json();
      if (!response.ok) { show({ status: 'failed', error: payment.error }); return; }
      show(payment);
      currentKey = payment.key;
      if (payment.nextAction?.type === 'widget') openWidget(payment.nextAction);
      if (!terminal.includes(payment.status)) await poll(payment.key);
    } finally {
      button.disabled = false;
    }
  });
</script>
</body>
</html>`;
}
