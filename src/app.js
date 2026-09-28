import { fileURLToPath } from 'node:url';
import { normalizeAutomationInput, ValidationError } from './automations.js';
import { parseSignedRequest, randomId, safeEqual, verifyWebhookSignature } from './crypto.js';
import { dispatchWebhook } from './engine.js';
import {
  cookie, createRouter, HttpError, parseCookies, readBody, readForm, readJson, redirect, sendJson, serveStatic,
} from './http.js';

const DEFAULT_PUBLIC_DIR = fileURLToPath(new URL('../public', import.meta.url));
const SESSION_COOKIE = 'sid';
const STATE_COOKIE = 'oauth_state';
const DAY = 24 * 60 * 60 * 1000;

const SECURITY_HEADERS = {
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'",
};

function publicAccount(account) {
  return { id: account.id, igUserId: account.igUserId, username: account.username, name: account.name, pictureUrl: account.pictureUrl };
}

function publicMedia(item) {
  return {
    id: item.id,
    caption: item.caption ?? '',
    mediaType: item.media_type,
    productType: item.media_product_type,
    thumbnail: item.media_type === 'VIDEO' ? item.thumbnail_url ?? '' : item.media_url ?? item.thumbnail_url ?? '',
    permalink: item.permalink,
    timestamp: item.timestamp,
    commentsCount: item.comments_count ?? 0,
    likeCount: item.like_count ?? 0,
  };
}

function automationId(params) {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(404, 'No encontrada');
  return id;
}

export function createApp({ config, db, instagram, engine, log = console, publicDir = DEFAULT_PUBLIC_DIR }) {
  const router = createRouter();
  const secureCookies = config.baseUrl.startsWith('https://');
  const redirectUri = `${config.baseUrl}/auth/callback`;
  const pending = new Set();

  function requireAccount(req) {
    const account = db.sessions.findAccount(parseCookies(req)[SESSION_COOKIE]);
    if (!account) throw new HttpError(401, 'Inicia sesión');
    // Los formularios de otras webs no pueden añadir cabeceras: protección CSRF.
    if (req.method !== 'GET' && req.headers['x-requested-with'] !== 'fetch') {
      throw new HttpError(403, 'Petición no permitida');
    }
    return account;
  }

  function withStats(account, automations) {
    const counts = db.events.countsByAutomation(account.id);
    return automations.map((automation) => ({ ...automation, stats: counts[automation.id] ?? {} }));
  }

  // --- Webhooks de Meta ---

  router.add('GET', '/webhook', (req, res, { url }) => {
    const ok = url.searchParams.get('hub.mode') === 'subscribe'
      && safeEqual(url.searchParams.get('hub.verify_token'), config.verifyToken);
    res.writeHead(ok ? 200 : 403, { 'Content-Type': 'text/plain' });
    res.end(ok ? url.searchParams.get('hub.challenge') ?? '' : '');
  });

  router.add('POST', '/webhook', async (req, res) => {
    const rawBody = await readBody(req);
    if (!verifyWebhookSignature(rawBody, req.headers['x-hub-signature-256'], config.appSecret)) {
      log.warn('Webhook con firma inválida, ignorado');
      res.writeHead(401).end();
      return;
    }
    // Meta exige responder rápido; el procesamiento sigue en segundo plano.
    res.writeHead(200, { 'Content-Type': 'text/plain' }).end('EVENT_RECEIVED');

    let payload;
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      log.warn('Webhook con JSON inválido');
      return;
    }
    const task = dispatchWebhook(payload, { db, engine, log })
      .catch((err) => log.error(`Error en webhook: ${err.message}`))
      .finally(() => pending.delete(task));
    pending.add(task);
  });

  // --- Login con Instagram ---

  router.add('GET', '/auth/login', (req, res) => {
    const state = randomId(16);
    redirect(res, instagram.authorizeUrl({ redirectUri, state }), {
      'Set-Cookie': cookie(STATE_COOKIE, state, { maxAge: 600, secure: secureCookies }),
    });
  });

  router.add('GET', '/auth/callback', async (req, res, { url }) => {
    const clearState = cookie(STATE_COOKIE, '', { maxAge: 0, secure: secureCookies });
    const fail = (reason) => redirect(res, `/#/login?error=${encodeURIComponent(reason)}`, { 'Set-Cookie': clearState });

    if (url.searchParams.get('error')) return fail(url.searchParams.get('error_description') || 'Acceso cancelado');
    const state = parseCookies(req)[STATE_COOKIE];
    if (!state || !safeEqual(state, url.searchParams.get('state'))) return fail('La sesión de login ha caducado, prueba otra vez');
    const code = (url.searchParams.get('code') ?? '').replace(/#_$/, '');
    if (!code) return fail('Falta el código de autorización');

    try {
      const short = await instagram.exchangeCode({ code, redirectUri });
      const long = await instagram.getLongLivedToken(short.accessToken);
      const me = await instagram.getMe(long.accessToken);
      const account = db.accounts.upsert({
        igUserId: String(me.user_id ?? me.id),
        appScopedId: short.appScopedId,
        username: me.username,
        name: me.name,
        pictureUrl: me.profile_picture_url,
        accessToken: long.accessToken,
        tokenExpiresAt: Date.now() + (long.expiresIn ?? 60 * 24 * 3600) * 1000,
      });

      try {
        await instagram.subscribeWebhooks(long.accessToken);
      } catch (err) {
        log.warn(`No se pudieron activar los webhooks de @${me.username}: ${err.message}`);
      }

      const sessionId = db.sessions.create(account.id);
      log.info(`@${account.username} ha iniciado sesión`);
      redirect(res, '/#/', {
        'Set-Cookie': [
          clearState,
          cookie(SESSION_COOKIE, sessionId, { maxAge: 30 * 24 * 3600, secure: secureCookies }),
        ],
      });
    } catch (err) {
      log.error(`Error en el login: ${err.message}`);
      fail(`Instagram ha devuelto un error: ${err.message}`);
    }
  });

  router.add('POST', '/api/logout', (req, res) => {
    requireAccount(req);
    db.sessions.delete(parseCookies(req)[SESSION_COOKIE]);
    sendJson(res, 200, { ok: true }, { 'Set-Cookie': cookie(SESSION_COOKIE, '', { maxAge: 0, secure: secureCookies }) });
  });

  // Callbacks obligatorios de Meta: el usuario quita la app o pide borrar sus datos.
  router.add('POST', '/auth/deauthorize', async (req, res) => {
    const data = parseSignedRequest((await readForm(req)).signed_request, config.appSecret);
    if (!data) return sendJson(res, 400, { error: 'signed_request inválido' });
    const account = data.user_id && db.accounts.findByAnyId(data.user_id);
    if (account) db.accounts.delete(account.id);
    sendJson(res, 200, { ok: true });
  });

  router.add('POST', '/auth/data-deletion', async (req, res) => {
    const data = parseSignedRequest((await readForm(req)).signed_request, config.appSecret);
    if (!data) return sendJson(res, 400, { error: 'signed_request inválido' });
    const account = data.user_id && db.accounts.findByAnyId(data.user_id);
    if (account) db.accounts.delete(account.id);
    const code = randomId(9);
    sendJson(res, 200, { url: `${config.baseUrl}/privacy.html#borrado`, confirmation_code: code });
  });

  // --- Enlaces con seguimiento de clics ---

  router.add('GET', '/r/:id', (req, res, { params, url }) => {
    const automation = db.automations.getById(automationId(params));
    const target = automation?.config.message.linkUrl;
    if (!target) throw new HttpError(404, 'Enlace no encontrado');
    db.events.add({
      accountId: automation.accountId,
      automationId: automation.id,
      type: 'link_click',
      userId: url.searchParams.get('u')?.slice(0, 64) ?? null,
    });
    redirect(res, target);
  });

  // --- API del panel ---

  router.add('GET', '/api/me', (req, res) => {
    sendJson(res, 200, publicAccount(requireAccount(req)));
  });

  router.add('GET', '/api/media', async (req, res, { url }) => {
    const account = requireAccount(req);
    const data = await instagram.listMedia(account.accessToken, { after: url.searchParams.get('after') || undefined });
    sendJson(res, 200, {
      items: (data.data ?? []).map(publicMedia),
      next: data.paging?.next ? data.paging.cursors?.after ?? null : null,
    });
  });

  router.add('GET', '/api/automations', (req, res) => {
    const account = requireAccount(req);
    sendJson(res, 200, withStats(account, db.automations.list(account.id)));
  });

  router.add('POST', '/api/automations', async (req, res) => {
    const account = requireAccount(req);
    const automation = db.automations.create(account.id, normalizeAutomationInput(await readJson(req)));
    sendJson(res, 201, withStats(account, [automation])[0]);
  });

  router.add('GET', '/api/automations/:id', (req, res, { params }) => {
    const account = requireAccount(req);
    const automation = db.automations.get(account.id, automationId(params));
    if (!automation) throw new HttpError(404, 'No encontrada');
    sendJson(res, 200, withStats(account, [automation])[0]);
  });

  router.add('PUT', '/api/automations/:id', async (req, res, { params }) => {
    const account = requireAccount(req);
    const id = automationId(params);
    if (!db.automations.get(account.id, id)) throw new HttpError(404, 'No encontrada');
    const automation = db.automations.update(account.id, id, normalizeAutomationInput(await readJson(req)));
    sendJson(res, 200, withStats(account, [automation])[0]);
  });

  router.add('PATCH', '/api/automations/:id', async (req, res, { params }) => {
    const account = requireAccount(req);
    const { active } = await readJson(req);
    const automation = db.automations.setActive(account.id, automationId(params), Boolean(active));
    if (!automation) throw new HttpError(404, 'No encontrada');
    sendJson(res, 200, withStats(account, [automation])[0]);
  });

  router.add('DELETE', '/api/automations/:id', (req, res, { params }) => {
    const account = requireAccount(req);
    if (!db.automations.delete(account.id, automationId(params))) throw new HttpError(404, 'No encontrada');
    sendJson(res, 200, { ok: true });
  });

  router.add('GET', '/api/events', (req, res, { url }) => {
    const account = requireAccount(req);
    const automation = Number(url.searchParams.get('automation')) || undefined;
    sendJson(res, 200, db.events.list(account.id, { limit: 200, automationId: automation }));
  });

  router.add('GET', '/api/stats', (req, res) => {
    const account = requireAccount(req);
    sendJson(res, 200, { last30Days: db.events.totals(account.id, Date.now() - 30 * DAY) });
  });

  router.add('GET', '/health', (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok');
  });

  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    try {
      const route = router.match(req.method, url.pathname);
      if (route) {
        await route.handler(req, res, { params: route.params, url });
        return;
      }
      if (req.method === 'GET' && !url.pathname.startsWith('/api/')) {
        for (const [key, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(key, value);
        if (await serveStatic(res, publicDir, url.pathname)) return;
      }
      throw new HttpError(404, 'No encontrado');
    } catch (err) {
      if (res.headersSent) {
        log.error(err);
        return;
      }
      if (err instanceof ValidationError) return sendJson(res, 400, { error: err.message });
      if (err instanceof HttpError) return sendJson(res, err.status, { error: err.message });
      if (err.name === 'InstagramApiError') {
        log.warn(`Instagram API: ${err.message}`);
        return sendJson(res, 502, { error: `Instagram: ${err.message}` });
      }
      log.error(err);
      sendJson(res, 500, { error: 'Error interno' });
    }
  }

  return {
    handle,
    // Espera a que terminen los webhooks en curso (útil en tests y al apagar).
    idle: () => Promise.all([...pending]),
  };
}
