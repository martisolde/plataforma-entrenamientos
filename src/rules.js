import { readFileSync } from 'node:fs';

// Quita tildes y pasa a minúsculas para que "Rutína", "RUTINA" y "rutina" coincidan.
export function normalize(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function keywordMatches(commentText, keyword, mode = 'word') {
  const text = normalize(commentText);
  const key = normalize(keyword);
  if (!key) return false;

  switch (mode) {
    case 'exact':
      return text.replace(/[^\p{L}\p{N}\s]/gu, '').trim() === key;
    case 'contains':
      return text.includes(key);
    case 'word':
    default:
      return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(key)}($|[^\\p{L}\\p{N}])`, 'u').test(text);
  }
}

export function validateRules(data) {
  if (!data || !Array.isArray(data.rules)) {
    throw new Error('El fichero de reglas debe tener un array "rules"');
  }
  data.rules.forEach((rule, i) => {
    const label = rule.name || `#${i + 1}`;
    if (!Array.isArray(rule.keywords) || rule.keywords.length === 0) {
      throw new Error(`La regla ${label} necesita al menos una palabra clave en "keywords"`);
    }
    if (typeof rule.dm !== 'string' || !rule.dm.trim()) {
      throw new Error(`La regla ${label} necesita un texto en "dm"`);
    }
    if (rule.match && !['word', 'exact', 'contains'].includes(rule.match)) {
      throw new Error(`La regla ${label} tiene "match" inválido: usa word, exact o contains`);
    }
  });
  return data;
}

export function loadRules(path) {
  return validateRules(JSON.parse(readFileSync(path, 'utf8')));
}

// Devuelve la primera regla cuyo post (si se limita) y palabra clave coinciden.
export function findMatchingRule(rulesData, { text, mediaId }) {
  return rulesData.rules.find((rule) => {
    const mediaIds = rule.mediaIds ?? [];
    if (mediaIds.length > 0 && !mediaIds.includes(mediaId)) return false;
    return rule.keywords.some((keyword) => keywordMatches(text, keyword, rule.match));
  });
}

export function renderTemplate(template, vars) {
  return template.replace(/\{(\w+)\}/g, (placeholder, name) => vars[name] ?? placeholder);
}

// Respuesta pública al comentario: la de la regla o una al azar de las generales.
// Variar el texto ayuda a que Instagram no lo marque como spam.
export function pickPublicReply(rulesData, rule, random = Math.random) {
  if (rule.publicReply === false) return null;
  const options = [rule.publicReply ?? rulesData.publicReplies ?? []].flat().filter(Boolean);
  if (options.length === 0) return null;
  return options[Math.floor(random() * options.length)];
}
