import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refreshTokens } from '../src/jobs.js';
import { fakeInstagram, setup, silent } from './helpers.js';

test('renueva los tokens que caducan pronto', async (t) => {
  const s = await setup();
  t.after(s.close);
  await s.login();
  const instagram = fakeInstagram();
  const in50Days = Date.now() + 50 * 86400000;

  await refreshTokens({ db: s.db, instagram, log: silent, now: in50Days });
  assert.equal(s.db.accounts.findByIgUserId('ME').accessToken, 'refreshed');
});
