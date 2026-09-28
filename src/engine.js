import { findAutomationForComment, renderTemplate } from './automations.js';

const POSTBACK_PREFIX = 'AUTODM:';

function buttonTemplate(text, buttons) {
  return { attachment: { type: 'template', payload: { template_type: 'button', text, buttons } } };
}

export function parsePostbackPayload(payload) {
  if (typeof payload !== 'string' || !payload.startsWith(POSTBACK_PREFIX)) return null;
  const id = Number(payload.slice(POSTBACK_PREFIX.length));
  return Number.isInteger(id) && id > 0 ? id : null;
}

// Ejecuta las automatizaciones: comentario -> (respuesta pública) -> DM -> botón -> (seguir) -> enlace.
export function createEngine({ db, instagram, baseUrl, log = console, random = Math.random }) {
  const pick = (list) => list[Math.floor(random() * list.length)];

  function trackedLink(automationId, userId) {
    const url = new URL(`${baseUrl}/r/${automationId}`);
    if (userId) url.searchParams.set('u', userId);
    return url.toString();
  }

  function finalMessage(automation, vars, userId) {
    const { text, linkUrl, linkTitle } = automation.config.message;
    const rendered = renderTemplate(text, vars);
    if (!linkUrl) return { message: { text: rendered } };
    return {
      message: buttonTemplate(rendered, [{ type: 'web_url', url: trackedLink(automation.id, userId), title: linkTitle }]),
      // Si Instagram rechaza la plantilla con botón, se manda el enlace en texto.
      fallback: { text: `${rendered}\n\n${linkUrl}` },
    };
  }

  function postbackMessage(text, button, automation, vars) {
    return {
      message: buttonTemplate(renderTemplate(text, vars), [
        { type: 'postback', title: button, payload: `${POSTBACK_PREFIX}${automation.id}` },
      ]),
    };
  }

  async function sendWithFallback(send, { message, fallback }) {
    try {
      await send(message);
    } catch (err) {
      if (!fallback) throw err;
      log.warn(`Plantilla rechazada (${err.message}), enviando texto plano`);
      await send(fallback);
    }
  }

  async function handleComment(account, comment) {
    // Ignora los comentarios de la propia cuenta (incluidas nuestras respuestas públicas).
    if (!comment.commentId || comment.fromId === account.igUserId) return { status: 'ignored' };

    const automation = findAutomationForComment(db.automations.listActive(account.id), comment);
    if (!automation) return { status: 'no-match' };
    if (!db.processedComments.claim(comment.commentId)) return { status: 'duplicate' };

    const base = {
      accountId: account.id,
      automationId: automation.id,
      userId: comment.fromId,
      username: comment.username,
      commentId: comment.commentId,
    };
    db.events.add({ ...base, type: 'comment', text: comment.text });

    const vars = { username: comment.username ? `@${comment.username}` : '' };
    const { opening } = automation.config;
    const dm = opening.enabled
      ? postbackMessage(opening.text, opening.button, automation, vars)
      : finalMessage(automation, vars, comment.fromId);

    try {
      await sendWithFallback(
        (message) => instagram.sendPrivateReply(account.accessToken, account.igUserId, comment.commentId, message),
        dm,
      );
    } catch (err) {
      db.processedComments.release(comment.commentId);
      db.events.add({ ...base, type: 'error', text: `DM: ${err.message}` });
      throw err;
    }
    db.events.add({ ...base, type: opening.enabled ? 'opening_sent' : 'dm_sent' });

    const { publicReply } = automation.config;
    if (publicReply.enabled && publicReply.replies.length > 0) {
      const reply = renderTemplate(pick(publicReply.replies), vars);
      try {
        await instagram.replyToComment(account.accessToken, comment.commentId, reply);
        db.events.add({ ...base, type: 'public_reply', text: reply });
      } catch (err) {
        // El DM ya se envió: un fallo aquí no debe provocar reintentos.
        db.events.add({ ...base, type: 'error', text: `Respuesta pública: ${err.message}` });
      }
    }

    log.info(`[${automation.name}] @${comment.username}: "${comment.text}"`);
    return { status: 'sent', automationId: automation.id };
  }

  async function handlePostback(account, { senderId, payload }) {
    if (!senderId || senderId === account.igUserId) return { status: 'ignored' };
    const automationId = parsePostbackPayload(payload);
    const automation = automationId && db.automations.get(account.id, automationId);
    if (!automation) return { status: 'unknown-automation' };

    // Cuando la persona pulsa el botón ya podemos consultar su perfil.
    let profile = {};
    try {
      profile = await instagram.getUserProfile(account.accessToken, senderId);
    } catch (err) {
      log.warn(`No se pudo leer el perfil de ${senderId}: ${err.message}`);
    }

    const base = { accountId: account.id, automationId: automation.id, userId: senderId, username: profile.username ?? null };
    const vars = { username: profile.username ? `@${profile.username}` : '' };
    const send = (message) => instagram.sendMessage(account.accessToken, account.igUserId, senderId, message);
    db.events.add({ ...base, type: 'button_click' });

    try {
      const { followGate } = automation.config;
      if (followGate.enabled && profile.is_user_follow_business !== true) {
        await sendWithFallback(send, postbackMessage(followGate.text, followGate.button, automation, vars));
        db.events.add({ ...base, type: 'follow_gate' });
        return { status: 'follow-gate' };
      }

      await sendWithFallback(send, finalMessage(automation, vars, senderId));
      db.events.add({ ...base, type: 'dm_sent' });
      return { status: 'sent' };
    } catch (err) {
      db.events.add({ ...base, type: 'error', text: `DM: ${err.message}` });
      throw err;
    }
  }

  return { handleComment, handlePostback };
}

// Reparte un webhook de Instagram entre comentarios y pulsaciones de botón.
export async function dispatchWebhook(payload, { db, engine, log = console }) {
  if (payload?.object !== 'instagram') return [];
  const results = [];

  for (const entry of payload.entry ?? []) {
    const account = db.accounts.findByIgUserId(String(entry.id));
    if (!account) {
      log.warn(`Webhook para una cuenta no conectada (${entry.id})`);
      continue;
    }

    const tasks = [];
    for (const change of entry.changes ?? []) {
      if (change.field !== 'comments' && change.field !== 'live_comments') continue;
      const v = change.value ?? {};
      tasks.push(() => engine.handleComment(account, {
        commentId: v.id,
        text: v.text ?? '',
        mediaId: v.media?.id,
        fromId: v.from?.id,
        username: v.from?.username ?? '',
      }));
    }
    for (const event of entry.messaging ?? []) {
      if (!event.postback || event.message?.is_echo) continue;
      tasks.push(() => engine.handlePostback(account, { senderId: event.sender?.id, payload: event.postback.payload }));
    }

    for (const task of tasks) {
      try {
        results.push(await task());
      } catch (err) {
        log.error(`Error procesando webhook: ${err.message}`);
        results.push({ status: 'error', error: err.message });
      }
    }
  }
  return results;
}
