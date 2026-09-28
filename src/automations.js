// Validación de automatizaciones y lógica para decidir cuál se activa con un comentario.

export class ValidationError extends Error {}

const LIMITS = { name: 80, keyword: 50, keywords: 30, reply: 300, replies: 10, text: 640, button: 20, media: 50 };
const MATCH_MODES = ['word', 'exact', 'contains'];

function str(value, max, label, { required = false } = {}) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (required && !text) throw new ValidationError(`${label} es obligatorio`);
  if (text.length > max) throw new ValidationError(`${label} no puede superar ${max} caracteres`);
  return text;
}

function httpUrl(value, label) {
  const text = str(value, 2000, label);
  if (!text) return '';
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new ValidationError(`${label} no es una URL válida`);
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new ValidationError(`${label} debe empezar por https://`);
  return url.toString();
}

export function normalizeAutomationInput(input) {
  const c = input?.config ?? {};
  const scope = c.scope === 'all' ? 'all' : 'specific';

  const media = (Array.isArray(c.media) ? c.media : []).slice(0, LIMITS.media).map((m) => ({
    id: str(m?.id, 64, 'ID de publicación', { required: true }),
    thumbnail: typeof m?.thumbnail === 'string' ? m.thumbnail.slice(0, 2000) : '',
    caption: typeof m?.caption === 'string' ? m.caption.slice(0, 120) : '',
    permalink: typeof m?.permalink === 'string' ? m.permalink.slice(0, 500) : '',
    mediaType: typeof m?.mediaType === 'string' ? m.mediaType.slice(0, 30) : '',
  }));
  if (scope === 'specific' && media.length === 0) {
    throw new ValidationError('Elige al menos una publicación o reel');
  }

  const anyComment = Boolean(c.trigger?.anyComment);
  const keywords = [...new Set((Array.isArray(c.trigger?.keywords) ? c.trigger.keywords : [])
    .map((k) => str(k, LIMITS.keyword, 'La palabra clave'))
    .filter(Boolean))];
  if (keywords.length > LIMITS.keywords) throw new ValidationError(`Máximo ${LIMITS.keywords} palabras clave`);
  if (!anyComment && keywords.length === 0) throw new ValidationError('Añade al menos una palabra clave');
  const match = MATCH_MODES.includes(c.trigger?.match) ? c.trigger.match : 'word';

  const publicReplyEnabled = Boolean(c.publicReply?.enabled);
  const replies = (Array.isArray(c.publicReply?.replies) ? c.publicReply.replies : [])
    .map((r) => str(r, LIMITS.reply, 'La respuesta pública'))
    .filter(Boolean)
    .slice(0, LIMITS.replies);
  if (publicReplyEnabled && replies.length === 0) throw new ValidationError('Añade al menos una respuesta pública');

  const openingEnabled = Boolean(c.opening?.enabled);
  const followGateEnabled = Boolean(c.followGate?.enabled);
  if (followGateEnabled && !openingEnabled) {
    throw new ValidationError('Para pedir que te sigan necesitas activar el mensaje de apertura');
  }

  const config = {
    scope,
    media: scope === 'specific' ? media : [],
    trigger: { anyComment, keywords, match },
    publicReply: { enabled: publicReplyEnabled, replies },
    opening: {
      enabled: openingEnabled,
      text: str(c.opening?.text, LIMITS.text, 'El mensaje de apertura', { required: openingEnabled }),
      button: str(c.opening?.button, LIMITS.button, 'El botón de apertura', { required: openingEnabled }),
    },
    followGate: {
      enabled: followGateEnabled,
      text: str(c.followGate?.text, LIMITS.text, 'El mensaje para seguir', { required: followGateEnabled }),
      button: str(c.followGate?.button, LIMITS.button, 'El botón de seguir', { required: followGateEnabled }),
    },
    message: {
      text: str(c.message?.text, LIMITS.text, 'El mensaje final', { required: true }),
      linkUrl: httpUrl(c.message?.linkUrl, 'El enlace'),
      linkTitle: str(c.message?.linkTitle, LIMITS.button, 'El texto del botón del enlace') || 'Ver enlace',
    },
  };

  const name = str(input?.name, LIMITS.name, 'El nombre')
    || (anyComment ? 'Cualquier comentario' : keywords.join(', ')).slice(0, LIMITS.name);

  return { name, active: input?.active !== false, config };
}

// Quita tildes y pasa a minúsculas para que "Rutína", "RUTINA" y "rutina" coincidan.
export function normalizeText(text) {
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
  const text = normalizeText(commentText);
  const key = normalizeText(keyword);
  if (!key) return false;

  switch (mode) {
    case 'exact':
      return text.replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim() === key;
    case 'contains':
      return text.includes(key);
    case 'word':
    default:
      return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(key)}($|[^\\p{L}\\p{N}])`, 'u').test(text);
  }
}

export function automationMatches(automation, { text, mediaId }) {
  const { scope, media, trigger } = automation.config;
  if (scope === 'specific' && !media.some((m) => m.id === mediaId)) return false;
  if (trigger.anyComment) return true;
  return trigger.keywords.some((keyword) => keywordMatches(text, keyword, trigger.match));
}

// Las automatizaciones de publicaciones concretas tienen prioridad sobre las de "cualquier publicación".
export function findAutomationForComment(automations, comment) {
  const ordered = [
    ...automations.filter((a) => a.config.scope === 'specific'),
    ...automations.filter((a) => a.config.scope !== 'specific'),
  ];
  return ordered.find((automation) => automationMatches(automation, comment)) ?? null;
}

export function renderTemplate(template, vars) {
  return template
    .replace(/\{(\w+)\}/g, (placeholder, name) => (name in vars ? vars[name] ?? '' : placeholder))
    .replace(/ {2,}/g, ' ')
    .replace(/ ([!?,.])/g, '$1');
}
