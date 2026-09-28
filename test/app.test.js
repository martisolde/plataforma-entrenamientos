import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { automationInput, commentPayload, config, fakeInstagram, postbackPayload, setup } from './helpers.js';

test('login con Instagram crea la cuenta, activa webhooks y guarda el token cifrado', async (t) => {
  const s = await setup();
  t.after(s.close);
  const res = await s.login();
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/#/');
  assert.deepEqual(s.instagram.calls.find((c) => c[0] === 'exchangeCode')[1].code, 'abc');
  assert.ok(s.instagram.calls.some((c) => c[0] === 'subscribeWebhooks' && c[1] === 'long-token'));

  const me = await s.request('/api/me');
  assert.equal(me.json.username, 'coach');
  assert.equal(me.json.accessToken, undefined);
  const stored = s.db.raw.prepare('SELECT access_token FROM accounts').get().access_token;
  assert.ok(!stored.includes('long-token'));
});

test('el callback rechaza un state que no coincide', async (t) => {
  const s = await setup();
  t.after(s.close);
  const res = await s.request('/auth/callback?code=abc&state=otro', { headers: { cookie: 'oauth_state=bueno' } });
  assert.match(res.headers.get('location'), /^\/#\/login\?error=/);
});

test('la API exige sesión y cabecera anti-CSRF', async (t) => {
  const s = await setup();
  t.after(s.close);
  assert.equal((await s.request('/api/automations')).status, 401);
  await s.login();
  const noHeader = await s.request('/api/automations', {
    method: 'POST', raw: JSON.stringify(automationInput()), headers: { 'content-type': 'application/json' },
  });
  assert.equal(noHeader.status, 403);
});

test('CRUD de automatizaciones y listado de publicaciones', async (t) => {
  const s = await setup();
  t.after(s.close);
  await s.login();

  const media = await s.request('/api/media');
  assert.equal(media.json.items[0].thumbnail, 'https://t/1.jpg');

  const created = await s.request('/api/automations', { method: 'POST', body: automationInput() });
  assert.equal(created.status, 201);
  const { id } = created.json;

  const bad = await s.request('/api/automations', { method: 'POST', body: automationInput({ media: [] }) });
  assert.equal(bad.status, 400);
  assert.match(bad.json.error, /publicación/);

  const paused = await s.request(`/api/automations/${id}`, { method: 'PATCH', body: { active: false } });
  assert.equal(paused.json.active, false);

  const updated = await s.request(`/api/automations/${id}`, { method: 'PUT', body: { ...automationInput(), name: 'Nuevo' } });
  assert.equal(updated.json.name, 'Nuevo');

  assert.equal((await s.request('/api/automations')).json.length, 1);
  assert.equal((await s.request(`/api/automations/${id}`, { method: 'DELETE', body: {} })).status, 200);
  assert.equal((await s.request('/api/automations')).json.length, 0);
});

test('flujo completo: comentario -> DM con botón -> clic -> enlace', async (t) => {
  const s = await setup();
  t.after(s.close);
  await s.login();
  const { id } = (await s.request('/api/automations', { method: 'POST', body: automationInput() })).json;

  await s.webhook(commentPayload());
  const dm = s.instagram.calls.find((c) => c[0] === 'sendPrivateReply');
  assert.equal(dm[2], 'ME');
  assert.equal(dm[3], 'C1');
  assert.equal(dm[4].attachment.payload.text, 'Hola @ana, pulsa 👇');
  assert.deepEqual(dm[4].attachment.payload.buttons[0], { type: 'postback', title: 'Envíamelo', payload: `AUTODM:${id}` });
  assert.deepEqual(s.instagram.calls.find((c) => c[0] === 'replyToComment').slice(2), ['C1', '¡Enviado @ana!']);

  // Meta reenvía el mismo webhook: no se duplica el DM.
  await s.webhook(commentPayload());
  assert.equal(s.instagram.calls.filter((c) => c[0] === 'sendPrivateReply').length, 1);

  await s.webhook(postbackPayload({ payload: `AUTODM:${id}` }));
  const final = s.instagram.calls.find((c) => c[0] === 'sendMessage');
  assert.equal(final[3], 'U1');
  const button = final[4].attachment.payload.buttons[0];
  assert.equal(button.url, `https://app.test/r/${id}?u=U1`);

  const click = await s.request(`/r/${id}?u=U1`);
  assert.equal(click.status, 302);
  assert.equal(click.headers.get('location'), 'https://web.test/plan');

  const stats = (await s.request(`/api/automations/${id}`)).json.stats;
  assert.deepEqual(stats, { comment: 1, opening_sent: 1, public_reply: 1, button_click: 1, dm_sent: 1, link_click: 1 });
});

test('pide seguir la cuenta antes de mandar el enlace', async (t) => {
  let follows = false;
  const s = await setup({
    instagram: fakeInstagram({ getUserProfile: async () => ({ username: 'ana', is_user_follow_business: follows }) }),
  });
  t.after(s.close);
  await s.login();
  const body = automationInput({ followGate: { enabled: true, text: 'Sígueme {username}', button: 'Ya te sigo' } });
  const { id } = (await s.request('/api/automations', { method: 'POST', body })).json;

  await s.webhook(postbackPayload({ payload: `AUTODM:${id}` }));
  let msg = s.instagram.calls.filter((c) => c[0] === 'sendMessage').at(-1)[4];
  assert.equal(msg.attachment.payload.text, 'Sígueme @ana');

  follows = true;
  await s.webhook(postbackPayload({ payload: `AUTODM:${id}` }));
  msg = s.instagram.calls.filter((c) => c[0] === 'sendMessage').at(-1)[4];
  assert.equal(msg.attachment.payload.text, 'Aquí tienes');
});

test('sin mensaje de apertura manda el enlace directamente y usa texto si falla la plantilla', async (t) => {
  const instagram = fakeInstagram();
  instagram.sendPrivateReply = async (token, ig, comment, message) => {
    instagram.calls.push(['sendPrivateReply', token, ig, comment, message]);
    if (message.attachment) throw new Error('template not supported');
  };
  const s = await setup({ instagram });
  t.after(s.close);
  await s.login();
  await s.request('/api/automations', { method: 'POST', body: automationInput({ opening: { enabled: false } }) });

  await s.webhook(commentPayload());
  const sent = s.instagram.calls.filter((c) => c[0] === 'sendPrivateReply');
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[1][4], { text: 'Aquí tienes\n\nhttps://web.test/plan' });
});

test('ignora comentarios propios, de otros posts, pausadas y firmas inválidas', async (t) => {
  const s = await setup();
  t.after(s.close);
  await s.login();
  const { id } = (await s.request('/api/automations', { method: 'POST', body: automationInput() })).json;

  await s.webhook(commentPayload({ fromId: 'ME' }));
  await s.webhook(commentPayload({ id: 'C2', mediaId: 'OTRO' }));
  await s.request(`/api/automations/${id}`, { method: 'PATCH', body: { active: false } });
  await s.webhook(commentPayload({ id: 'C3' }));
  const forged = await s.request('/webhook', {
    method: 'POST', raw: JSON.stringify(commentPayload({ id: 'C4' })), headers: { 'x-hub-signature-256': 'sha256=00' },
  });
  assert.equal(forged.status, 401);
  assert.equal(s.instagram.calls.filter((c) => c[0] === 'sendPrivateReply').length, 0);
});

test('verificación del webhook y borrado de datos', async (t) => {
  const s = await setup();
  t.after(s.close);
  const ok = await s.request('/webhook?hub.mode=subscribe&hub.verify_token=verify&hub.challenge=42');
  assert.equal(ok.text, '42');
  assert.equal((await s.request('/webhook?hub.mode=subscribe&hub.verify_token=mal&hub.challenge=42')).status, 403);

  await s.login();
  const payload = Buffer.from(JSON.stringify({ user_id: 'APPSCOPED' })).toString('base64url');
  const sig = createHmac('sha256', config.appSecret).update(payload).digest('base64url');
  const res = await s.request('/auth/data-deletion', {
    method: 'POST', raw: `signed_request=${sig}.${payload}`, headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  assert.ok(res.json.confirmation_code);
  assert.equal((await s.request('/api/me')).status, 401);
});
