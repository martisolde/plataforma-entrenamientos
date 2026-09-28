import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findMatchingRule, keywordMatches, pickPublicReply, renderTemplate, validateRules } from '../src/rules.js';

test('word: ignora mayúsculas, tildes y exige palabra completa', () => {
  assert.ok(keywordMatches('Quiero la RUTÍNA porfa 🔥', 'rutina'));
  assert.ok(keywordMatches('plan!', 'PLAN'));
  assert.ok(!keywordMatches('planificación', 'plan'));
});

test('exact y contains', () => {
  assert.ok(keywordMatches('Plan!!', 'plan', 'exact'));
  assert.ok(!keywordMatches('quiero el plan', 'plan', 'exact'));
  assert.ok(keywordMatches('planificación', 'plan', 'contains'));
});

test('findMatchingRule respeta mediaIds', () => {
  const rules = validateRules({
    rules: [
      { name: 'solo-post-1', keywords: ['plan'], mediaIds: ['1'], dm: 'a' },
      { name: 'todos', keywords: ['plan'], dm: 'b' },
    ],
  });
  assert.equal(findMatchingRule(rules, { text: 'plan', mediaId: '1' }).name, 'solo-post-1');
  assert.equal(findMatchingRule(rules, { text: 'plan', mediaId: '2' }).name, 'todos');
  assert.equal(findMatchingRule(rules, { text: 'hola', mediaId: '1' }), undefined);
});

test('validateRules rechaza reglas incompletas', () => {
  assert.throws(() => validateRules({ rules: [{ keywords: [], dm: 'x' }] }));
  assert.throws(() => validateRules({ rules: [{ keywords: ['a'] }] }));
});

test('renderTemplate y pickPublicReply', () => {
  assert.equal(renderTemplate('Hola {username} {otro}', { username: '@ana' }), 'Hola @ana {otro}');
  const data = { publicReplies: ['a', 'b'], rules: [] };
  assert.equal(pickPublicReply(data, {}, () => 0.99), 'b');
  assert.equal(pickPublicReply(data, { publicReply: 'x' }), 'x');
  assert.equal(pickPublicReply(data, { publicReply: false }), null);
});
