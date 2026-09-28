import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createProcessedStore } from '../src/store.js';
import { handleWebhookPayload, verifySignature } from '../src/webhook.js';

const silent = { info() {}, warn() {}, error() {} };

function payload(value) {
  return { object: 'instagram', entry: [{ id: 'ME', changes: [{ field: 'comments', value }] }] };
}

function fakeInstagram() {
  const calls = [];
  return {
    calls,
    async sendPrivateReply(...args) { calls.push(['dm', ...args]); },
    async replyToComment(...args) { calls.push(['reply', ...args]); },
  };
}

const rules = {
  publicReplies: ['¡Enviado {username}!'],
  rules: [{ name: 'plan', keywords: ['plan'], dm: 'Hola {username}, aquí va: https://x' }],
};

test('verifySignature', () => {
  const body = Buffer.from('{"a":1}');
  const sig = 'sha256=' + createHmac('sha256', 'secret').update(body).digest('hex');
  assert.ok(verifySignature(body, sig, 'secret'));
  assert.ok(!verifySignature(body, sig, 'otro'));
  assert.ok(!verifySignature(body, undefined, 'secret'));
});

test('envía DM y respuesta pública una sola vez por comentario', async () => {
  const instagram = fakeInstagram();
  const store = createProcessedStore(null);
  const body = payload({ id: 'C1', text: 'PLAN', media: { id: 'M1' }, from: { id: 'U1', username: 'ana' } });

  const deps = { rules, instagram, store, log: silent };
  assert.deepEqual((await handleWebhookPayload(body, deps))[0].status, 'sent');
  assert.deepEqual((await handleWebhookPayload(body, deps))[0].status, 'duplicate');
  assert.deepEqual(instagram.calls, [
    ['dm', 'ME', 'C1', 'Hola @ana, aquí va: https://x'],
    ['reply', 'C1', '¡Enviado @ana!'],
  ]);
});

test('ignora comentarios propios y sin palabra clave', async () => {
  const instagram = fakeInstagram();
  const deps = { rules, instagram, store: createProcessedStore(null), log: silent };
  const own = payload({ id: 'C2', text: 'plan', from: { id: 'ME', username: 'yo' } });
  const other = payload({ id: 'C3', text: 'qué bueno', from: { id: 'U2', username: 'b' } });
  assert.equal((await handleWebhookPayload(own, deps))[0].status, 'own-comment');
  assert.equal((await handleWebhookPayload(other, deps))[0].status, 'no-match');
  assert.equal(instagram.calls.length, 0);
});

test('si falla el DM no se marca como procesado', async () => {
  const instagram = { async sendPrivateReply() { throw new Error('boom'); }, async replyToComment() {} };
  const store = createProcessedStore(null);
  const body = payload({ id: 'C4', text: 'plan', from: { id: 'U3', username: 'c' } });
  const [result] = await handleWebhookPayload(body, { rules, instagram, store, log: silent });
  assert.equal(result.status, 'error');
  assert.ok(!store.has('C4'));
});
