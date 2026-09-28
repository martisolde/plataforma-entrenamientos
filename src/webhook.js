import { createHmac, timingSafeEqual } from 'node:crypto';
import { findMatchingRule, pickPublicReply, renderTemplate } from './rules.js';

export function verifySignature(rawBody, signatureHeader, appSecret) {
  if (!signatureHeader?.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', appSecret).update(rawBody).digest('hex');
  const received = signatureHeader.slice('sha256='.length);
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(received, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

// Extrae los comentarios nuevos de un payload de webhook de Instagram.
export function extractComments(payload) {
  if (payload?.object !== 'instagram') return [];
  return (payload.entry ?? []).flatMap((entry) =>
    (entry.changes ?? [])
      .filter((change) => change.field === 'comments' || change.field === 'live_comments')
      .map((change) => ({
        igUserId: entry.id,
        commentId: change.value?.id,
        text: change.value?.text ?? '',
        mediaId: change.value?.media?.id,
        fromId: change.value?.from?.id,
        username: change.value?.from?.username ?? '',
      }))
      .filter((comment) => comment.commentId),
  );
}

export async function handleComment(comment, { rules, instagram, store, dryRun = false, log = console }) {
  // Ignora los comentarios de la propia cuenta (incluidas nuestras respuestas públicas).
  if (comment.fromId && comment.fromId === comment.igUserId) return { status: 'own-comment' };
  if (store.has(comment.commentId)) return { status: 'duplicate' };

  const rule = findMatchingRule(rules, comment);
  if (!rule) return { status: 'no-match' };

  const vars = { username: comment.username ? `@${comment.username}` : '' };
  const dm = renderTemplate(rule.dm, vars);
  const publicTemplate = pickPublicReply(rules, rule);
  const publicReply = publicTemplate && renderTemplate(publicTemplate, vars);

  log.info(`[${rule.name ?? 'regla'}] @${comment.username}: "${comment.text}" -> DM`);
  if (dryRun) {
    log.info(`  (DRY_RUN) DM: ${dm}`);
    if (publicReply) log.info(`  (DRY_RUN) Respuesta pública: ${publicReply}`);
    store.add(comment.commentId);
    return { status: 'dry-run', rule: rule.name };
  }

  await instagram.sendPrivateReply(comment.igUserId, comment.commentId, dm);
  store.add(comment.commentId);

  if (publicReply) {
    try {
      await instagram.replyToComment(comment.commentId, publicReply);
    } catch (err) {
      // El DM ya se envió: un fallo aquí no debe provocar reintentos.
      log.warn(`  No se pudo responder públicamente: ${err.message}`);
    }
  }
  return { status: 'sent', rule: rule.name };
}

export async function handleWebhookPayload(payload, deps) {
  const results = [];
  for (const comment of extractComments(payload)) {
    try {
      results.push(await handleComment(comment, deps));
    } catch (err) {
      (deps.log ?? console).error(`Error con el comentario ${comment.commentId}: ${err.message}`);
      results.push({ status: 'error', error: err.message });
    }
  }
  return results;
}
