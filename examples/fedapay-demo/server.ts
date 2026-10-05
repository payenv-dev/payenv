/**
 * Payenv × FedaPay demo.
 *
 *   pnpm demo            (from the repository root)
 *
 * Needs FEDAPAY_SANDBOX_SECRET_KEY in the root .env file. Then open http://localhost:3000.
 * Sandbox test numbers: +22964000001 and +22966000001 succeed, any other number fails.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { fedapay, verifyFedaPayWebhook } from '@payenv/connector-fedapay';
import { createPayenv, isPayenvError, type Payment } from '@payenv/core';

const secretKey = process.env.FEDAPAY_SANDBOX_SECRET_KEY;
if (!secretKey) {
  console.error('Missing FEDAPAY_SANDBOX_SECRET_KEY. Copy .env.example to .env and fill it in.');
  process.exit(1);
}
if (secretKey.startsWith('sk_live')) {
  console.error('This demo only runs with a sandbox key (sk_sandbox_...).');
  process.exit(1);
}

const port = Number(process.env.PORT ?? 3000);

const payenv = createPayenv({
  connectors: [fedapay({ secretKey, environment: 'sandbox' })],
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
});

createServer((request, response) => {
  route(request, response).catch((error: unknown) => {
    console.error(error);
    send(response, 500, { error: 'Internal error' });
  });
}).listen(port, () => {
  console.log(`Payenv demo running on http://localhost:${port}`);
});

async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', `http://${request.headers.host}`);

  if (request.method === 'GET' && url.pathname === '/') {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(PAGE);
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/pay') {
    const body = JSON.parse(await readBody(request)) as {
      amount: number;
      phone: string;
      network: string;
    };
    try {
      const payment = await payenv.collect({
        amount: { value: Number(body.amount), currency: 'XOF' },
        method: { type: 'mobile_money', network: body.network, country: 'BJ', phone: body.phone },
        customer: { firstName: 'Demo', lastName: 'Payenv', email: 'demo@example.com' },
        description: 'Payenv demo',
        idempotencyKey: `demo_${Date.now()}`,
      });
      send(response, 200, view(payment));
    } catch (error) {
      // Invalid requests (bad phone, no route...) are thrown, not returned as payments.
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
    console.log(`[webhook] signature ${valid ? 'valid' : 'INVALID'}`);
    send(response, valid ? 200 : 400, { received: valid });
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
    attempts: payment.attempts.map(({ connectorId, status, outcome, error }) => ({
      connectorId,
      status,
      outcome,
      error: error?.code,
    })),
  };
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

const PAGE = `<!doctype html>
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
  pre { font-size: 12px; overflow-x: auto; background: #8881; padding: 8px; border-radius: 8px; }
</style>
</head>
<body>
<h1>Payenv demo</h1>
<p class="sub">Paiement mobile money via FedaPay (sandbox)</p>
<form id="pay">
  <label>Montant (XOF) <input name="amount" type="number" min="1" value="100" required></label>
  <label>Réseau
    <select name="network"><option value="mtn">MTN</option><option value="moov">Moov</option><option value="celtiis">Celtiis</option></select>
  </label>
  <label>Téléphone <input name="phone" value="+22964000001" required></label>
  <span class="hint">Sandbox : +22964000001 ou +22966000001 = succès · tout autre numéro = échec</span>
  <button>Payer</button>
</form>
<div id="result">
  <div>Statut : <span id="status" class="badge"></span></div>
  <p id="message"></p>
  <pre id="details"></pre>
</div>
<script>
  const form = document.getElementById('pay');
  const terminal = ['succeeded', 'failed', 'canceled', 'expired'];
  function show(payment) {
    document.getElementById('result').style.display = 'block';
    const badge = document.getElementById('status');
    badge.textContent = payment.status;
    badge.className = 'badge ' + payment.status;
    document.getElementById('message').textContent =
      payment.status === 'pending' ? 'Le client doit valider sur son téléphone… (vérification toutes les 2 s)'
      : payment.error ? payment.error.code + ' — ' + payment.error.message : '';
    document.getElementById('details').textContent = JSON.stringify(payment, null, 2);
  }
  async function poll(key) {
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const payment = await (await fetch('/api/payments/' + key)).json();
      show(payment);
      if (terminal.includes(payment.status)) return;
    }
  }
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button');
    button.disabled = true;
    try {
      const data = Object.fromEntries(new FormData(form));
      const response = await fetch('/api/pay', { method: 'POST', body: JSON.stringify(data) });
      const payment = await response.json();
      if (!response.ok) { show({ status: 'failed', error: payment.error }); return; }
      show(payment);
      if (!terminal.includes(payment.status)) await poll(payment.key);
    } finally {
      button.disabled = false;
    }
  });
</script>
</body>
</html>`;
