import { createServer } from 'node:http';
import { createHmac } from 'node:crypto';
import { createApp } from '../src/app.js';
import { createCipher } from '../src/crypto.js';
import { openDatabase } from '../src/db.js';
import { createEngine } from '../src/engine.js';

export const silent = { info() {}, warn() {}, error() {} };

export const config = {
  baseUrl: 'https://app.test',
  appId: 'APP',
  appSecret: 'app-secret',
  verifyToken: 'verify',
  sessionSecret: 'x'.repeat(32),
};

export function fakeInstagram(overrides = {}) {
  const calls = [];
  const record = (name, result = {}) => async (...args) => {
    calls.push([name, ...args]);
    return typeof result === 'function' ? result(...args) : result;
  };
  return {
    calls,
    authorizeUrl: ({ redirectUri, state }) => `https://ig.test/oauth?redirect_uri=${redirectUri}&state=${state}`,
    exchangeCode: record('exchangeCode', { accessToken: 'short', appScopedId: 'APPSCOPED' }),
    getLongLivedToken: record('getLongLivedToken', { accessToken: 'long-token', expiresIn: 5184000 }),
    getMe: record('getMe', { user_id: 'ME', username: 'coach', name: 'Coach' }),
    subscribeWebhooks: record('subscribeWebhooks', { success: true }),
    listMedia: record('listMedia', { data: [{ id: 'M1', media_type: 'VIDEO', media_product_type: 'REELS', thumbnail_url: 'https://t/1.jpg' }] }),
    sendPrivateReply: record('sendPrivateReply'),
    sendMessage: record('sendMessage'),
    replyToComment: record('replyToComment'),
    getUserProfile: record('getUserProfile', { username: 'ana', is_user_follow_business: true }),
    refreshToken: record('refreshToken', { accessToken: 'refreshed', expiresIn: 5184000 }),
    ...overrides,
  };
}

export async function setup({ instagram = fakeInstagram() } = {}) {
  const db = openDatabase(':memory:', { cipher: createCipher(config.sessionSecret) });
  const engine = createEngine({ db, instagram, baseUrl: config.baseUrl, log: silent, random: () => 0 });
  const app = createApp({ config, db, instagram, engine, log: silent });
  const server = createServer(app.handle);
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  let sessionCookie = '';
  async function request(path, { method = 'GET', body, headers = {}, raw } = {}) {
    const res = await fetch(base + path, {
      method,
      redirect: 'manual',
      headers: {
        ...(sessionCookie ? { cookie: sessionCookie } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json', 'x-requested-with': 'fetch' } : {}),
        ...headers,
      },
      body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
    });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = undefined; }
    return { status: res.status, headers: res.headers, text, json };
  }

  async function login() {
    const start = await request('/auth/login');
    const state = new URL(start.headers.get('location')).searchParams.get('state');
    const cb = await request(`/auth/callback?code=abc%23_&state=${state}`, {
      headers: { cookie: `oauth_state=${state}` },
    });
    sessionCookie = cb.headers.getSetCookie().find((c) => c.startsWith('sid=')).split(';')[0];
    return cb;
  }

  async function webhook(payload) {
    const raw = JSON.stringify(payload);
    const signature = 'sha256=' + createHmac('sha256', config.appSecret).update(raw).digest('hex');
    const res = await request('/webhook', { method: 'POST', raw, headers: { 'x-hub-signature-256': signature } });
    await app.idle();
    return res;
  }

  return { db, instagram, app, request, login, webhook, close: () => new Promise((r) => server.close(r)) };
}

export function automationInput(overrides = {}) {
  return {
    name: 'Plan gratis',
    config: {
      scope: 'specific',
      media: [{ id: 'M1', thumbnail: 'https://t/1.jpg' }],
      trigger: { anyComment: false, keywords: ['plan'], match: 'word' },
      publicReply: { enabled: true, replies: ['¡Enviado {username}!'] },
      opening: { enabled: true, text: 'Hola {username}, pulsa 👇', button: 'Envíamelo' },
      followGate: { enabled: false, text: '', button: '' },
      message: { text: 'Aquí tienes', linkUrl: 'https://web.test/plan', linkTitle: 'Ver plan' },
      ...overrides,
    },
  };
}

export function commentPayload({ id = 'C1', text = 'PLAN', mediaId = 'M1', fromId = 'U1', username = 'ana' } = {}) {
  return {
    object: 'instagram',
    entry: [{ id: 'ME', time: 1, changes: [{ field: 'comments', value: { id, text, media: { id: mediaId }, from: { id: fromId, username } } }] }],
  };
}

export function postbackPayload({ senderId = 'U1', payload }) {
  return {
    object: 'instagram',
    entry: [{ id: 'ME', time: 1, messaging: [{ sender: { id: senderId }, recipient: { id: 'ME' }, postback: { title: 'x', payload } }] }],
  };
}
