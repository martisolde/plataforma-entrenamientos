import { createServer } from 'node:http';
import { loadConfig } from './config.js';
import { createInstagramClient } from './instagram.js';
import { loadRules } from './rules.js';
import { createProcessedStore } from './store.js';
import { handleWebhookPayload, verifySignature } from './webhook.js';

const config = loadConfig();
const instagram = createInstagramClient(config);
const store = createProcessedStore(config.dataDir);

let rules = loadRules(config.rulesFile);
console.log(`Reglas cargadas: ${rules.rules.map((r) => r.name ?? r.keywords[0]).join(', ')}`);

// Relee las reglas en cada webhook para poder editarlas sin reiniciar.
function currentRules() {
  try {
    rules = loadRules(config.rulesFile);
  } catch (err) {
    console.error(`Error en ${config.rulesFile}, se mantienen las reglas anteriores: ${err.message}`);
  }
  return rules;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/health') {
    res.writeHead(200).end('ok');
    return;
  }

  if (url.pathname !== '/webhook') {
    res.writeHead(404).end();
    return;
  }

  // Verificación inicial que hace Meta al configurar el webhook.
  if (req.method === 'GET') {
    const ok = url.searchParams.get('hub.mode') === 'subscribe'
      && url.searchParams.get('hub.verify_token') === config.verifyToken;
    if (ok) {
      res.writeHead(200).end(url.searchParams.get('hub.challenge'));
    } else {
      res.writeHead(403).end();
    }
    return;
  }

  if (req.method !== 'POST') {
    res.writeHead(405).end();
    return;
  }

  const rawBody = await readBody(req);
  if (!verifySignature(rawBody, req.headers['x-hub-signature-256'], config.appSecret)) {
    console.warn('Webhook con firma inválida, ignorado');
    res.writeHead(401).end();
    return;
  }

  // Meta exige responder rápido; el procesamiento sigue en segundo plano.
  res.writeHead(200).end('EVENT_RECEIVED');

  let payload;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    console.warn('Webhook con JSON inválido');
    return;
  }

  await handleWebhookPayload(payload, {
    rules: currentRules(),
    instagram,
    store,
    dryRun: config.dryRun,
    log: console,
  });
});

server.listen(config.port, () => {
  console.log(`Escuchando en http://localhost:${config.port}/webhook${config.dryRun ? ' (DRY_RUN)' : ''}`);
});
