import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  findAutomationForComment, keywordMatches, normalizeAutomationInput, renderTemplate, ValidationError,
} from '../src/automations.js';
import { automationInput } from './helpers.js';

test('keywordMatches: mayúsculas, tildes y palabra completa', () => {
  assert.ok(keywordMatches('Quiero la RUTÍNA porfa 🔥', 'rutina'));
  assert.ok(keywordMatches('plan!', 'PLAN'));
  assert.ok(!keywordMatches('planificación', 'plan'));
  assert.ok(keywordMatches('Plan!!', 'plan', 'exact'));
  assert.ok(!keywordMatches('quiero el plan', 'plan', 'exact'));
  assert.ok(keywordMatches('planificación', 'plan', 'contains'));
});

test('normalizeAutomationInput valida y limpia', () => {
  const { name, active, config } = normalizeAutomationInput(automationInput());
  assert.equal(name, 'Plan gratis');
  assert.equal(active, true);
  assert.equal(config.message.linkUrl, 'https://web.test/plan');

  const invalid = (overrides) => assert.throws(() => normalizeAutomationInput(automationInput(overrides)), ValidationError);
  invalid({ media: [] });
  invalid({ trigger: { keywords: [] } });
  invalid({ message: { text: '' } });
  invalid({ message: { text: 'x', linkUrl: 'javascript:alert(1)' } });
  invalid({ followGate: { enabled: true, text: 'x', button: 'y' }, opening: { enabled: false } });
  invalid({ opening: { enabled: true, text: 'x', button: 'un botón demasiado largo' } });
});

test('las automatizaciones de un post concreto ganan a las de cualquier post', () => {
  const all = { id: 1, config: { scope: 'all', media: [], trigger: { anyComment: true, keywords: [] } } };
  const specific = { id: 2, config: { scope: 'specific', media: [{ id: 'M1' }], trigger: { keywords: ['plan'], match: 'word' } } };
  assert.equal(findAutomationForComment([all, specific], { text: 'plan', mediaId: 'M1' }).id, 2);
  assert.equal(findAutomationForComment([all, specific], { text: 'plan', mediaId: 'M2' }).id, 1);
  assert.equal(findAutomationForComment([specific], { text: 'hola', mediaId: 'M1' }), null);
});

test('renderTemplate limpia huecos si falta el usuario', () => {
  assert.equal(renderTemplate('Hola {username}!', { username: '@ana' }), 'Hola @ana!');
  assert.equal(renderTemplate('Hola {username}!', { username: '' }), 'Hola!');
  assert.equal(renderTemplate('{otro}', {}), '{otro}');
});
