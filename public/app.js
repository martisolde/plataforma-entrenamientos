// Panel de AutoDM: SPA sin dependencias con rutas por hash.

const app = document.getElementById('app');

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

const clone = (value) => JSON.parse(JSON.stringify(value));

const state = {
  me: null,
  media: { items: [], next: null, loaded: false, loading: false, filter: 'all' },
};

// ---------- API ----------

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: { 'X-Requested-With': 'fetch', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    state.me = null;
    location.hash = '#/login';
    throw new Error(data.error || 'Inicia sesión');
  }
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

// ---------- Utilidades de UI ----------

function toast(message, type = 'ok') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  document.getElementById('toasts').append(el);
  setTimeout(() => el.remove(), 3200);
}

// Las imágenes del CDN de Instagram caducan: si fallan, se ocultan.
document.addEventListener('error', (e) => {
  if (e.target instanceof HTMLImageElement) e.target.classList.add('broken');
}, true);

let actions = {};
// Manejadores de formulario de la vista actual (se reinician en cada navegación).
let handlers = {};
for (const type of ['input', 'change', 'keydown', 'focusout']) {
  app.addEventListener(type, (e) => handlers[type]?.(e));
}
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || !actions[el.dataset.action]) return;
  e.preventDefault();
  actions[el.dataset.action](el, e);
});

const img = (src, alt = '') => (src ? `<img src="${esc(src)}" alt="${esc(alt)}" referrerpolicy="no-referrer" loading="lazy">` : '');
const avatar = (me) => (me?.pictureUrl
  ? `<img class="avatar" src="${esc(me.pictureUrl)}" alt="" referrerpolicy="no-referrer">`
  : '<div class="avatar"></div>');

function timeAgo(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'ahora';
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  if (s < 7 * 86400) return `hace ${Math.floor(s / 86400)} d`;
  return new Date(ts).toLocaleDateString('es', { day: 'numeric', month: 'short' });
}

const ICONS = {
  bolt: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/></svg>',
  activity: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>',
  logout: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>',
  edit: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  trash: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>',
  ig: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor"/></svg>',
  plus: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  x: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
};

// ---------- Layout ----------

function shell(active, content) {
  const nav = `
    <nav class="nav">
      <a href="#/" class="${active === 'automations' ? 'on' : ''}">${ICONS.bolt} Automatizaciones</a>
      <a href="#/activity" class="${active === 'activity' ? 'on' : ''}">${ICONS.activity} Actividad</a>
    </nav>`;
  return `
    <div class="layout">
      <aside class="sidebar">
        <a href="#/" class="logo" style="text-decoration:none;color:inherit"><img src="/favicon.svg" alt=""> AutoDM</a>
        ${nav}
        <div class="account">
          ${avatar(state.me)}
          <div>
            <div class="account-name">@${esc(state.me.username)}</div>
            <div class="account-sub">Instagram conectado</div>
          </div>
          <button class="icon-btn" data-action="logout" title="Cerrar sesión">${ICONS.logout}</button>
        </div>
      </aside>
      <div>
        <div class="mobile-bar">
          <span class="logo"><img src="/favicon.svg" alt=""></span>
          ${nav}
          <button class="icon-btn" data-action="logout" title="Cerrar sesión">${ICONS.logout}</button>
        </div>
        <main class="main">${content}</main>
      </div>
    </div>`;
}

const commonActions = {
  async logout() {
    await api('/api/logout', { method: 'POST', body: {} }).catch(() => {});
    state.me = null;
    state.media = { items: [], next: null, loaded: false, loading: false, filter: 'all' };
    location.hash = '#/login';
  },
};

// ---------- Login ----------

function renderLogin(error) {
  actions = {};
  app.innerHTML = `
    <div class="login">
      <section class="login-hero">
        <span class="logo" style="color:#fff"><img src="/favicon.svg" alt="" style="filter:brightness(0) invert(1)"> AutoDM</span>
        <h1>Convierte cada comentario en un DM automático</h1>
        <p>Alguien comenta "PLAN" en tu reel y al instante le llega tu enlace por mensaje directo. Sin pagar ManyChat.</p>
        <ul>
          <li>Elige el post o reel y las palabras clave</li>
          <li>Respuesta pública automática al comentario</li>
          <li>DM con botón, opción de pedir que te sigan y enlace</li>
          <li>Estadísticas de comentarios, DMs y clics</li>
        </ul>
      </section>
      <section class="login-card">
        <div class="login-box">
          <span class="logo"><img src="/favicon.svg" alt=""> AutoDM</span>
          <h2>Conecta tu Instagram</h2>
          <p>Necesitas una cuenta profesional (Creador o Empresa).</p>
          ${error ? `<div class="alert">${esc(error)}</div>` : ''}
          <a class="btn btn-primary btn-lg" href="/auth/login">${ICONS.ig} Continuar con Instagram</a>
          <small>Al continuar aceptas la <a href="/privacy.html">política de privacidad</a>.</small>
        </div>
      </section>
    </div>`;
}

// ---------- Dashboard ----------

const n = (value) => Number(value ?? 0).toLocaleString('es');

function automationThumb(automation) {
  const { scope, media } = automation.config;
  if (scope === 'all') return `<div class="thumb" title="Cualquier publicación">${ICONS.ig}</div>`;
  const extra = media.length > 1 ? `<span class="more">+${media.length - 1}</span>` : '';
  return `<div class="thumb">${img(media[0]?.thumbnail)}${extra}</div>`;
}

function automationCard(a) {
  const { trigger, scope, media, opening, followGate, publicReply } = a.config;
  const s = a.stats;
  const keywords = trigger.anyComment
    ? '<span class="chip">Cualquier comentario</span>'
    : trigger.keywords.slice(0, 6).map((k) => `<span class="chip">${esc(k)}</span>`).join('')
      + (trigger.keywords.length > 6 ? `<span class="chip">+${trigger.keywords.length - 6}</span>` : '');
  const features = [
    scope === 'all' ? 'Todas las publicaciones' : `${media.length} ${media.length === 1 ? 'publicación' : 'publicaciones'}`,
    publicReply.enabled && 'Respuesta pública',
    opening.enabled && 'Botón de apertura',
    followGate.enabled && 'Pide seguir',
  ].filter(Boolean).join(' · ');
  const ctr = s.dm_sent ? Math.round(((s.link_click ?? 0) / s.dm_sent) * 100) : 0;

  return `
    <article class="card automation ${a.active ? '' : 'paused'}">
      ${automationThumb(a)}
      <div>
        <h3>${esc(a.name)} <span class="badge ${a.active ? 'live' : ''}">${a.active ? 'Activa' : 'Pausada'}</span></h3>
        <div class="meta"><div class="chips">${keywords}</div><span>${esc(features)}</span></div>
        <div class="numbers">
          <span><b>${n(s.comment)}</b> comentarios</span>
          <span><b>${n(s.button_click)}</b> clics en botón</span>
          <span><b>${n(s.dm_sent)}</b> enlaces enviados</span>
          <span><b>${n(s.link_click)}</b> clics (${ctr}%)</span>
        </div>
      </div>
      <div class="actions">
        <label class="switch" title="${a.active ? 'Pausar' : 'Activar'}">
          <input type="checkbox" data-toggle="${a.id}" ${a.active ? 'checked' : ''}><span></span>
        </label>
        <a class="icon-btn" href="#/automations/${a.id}" title="Editar">${ICONS.edit}</a>
        <button class="icon-btn" data-action="delete" data-id="${a.id}" title="Eliminar">${ICONS.trash}</button>
      </div>
    </article>`;
}

async function renderDashboard() {
  const [automations, stats] = await Promise.all([api('/api/automations'), api('/api/stats')]);
  const t = stats.last30Days;

  actions = {
    ...commonActions,
    async delete(el) {
      const automation = automations.find((a) => a.id === Number(el.dataset.id));
      if (!confirm(`¿Eliminar "${automation.name}"? Se perderán sus estadísticas.`)) return;
      await api(`/api/automations/${automation.id}`, { method: 'DELETE', body: {} });
      toast('Automatización eliminada');
      render();
    },
  };

  const list = automations.length === 0
    ? `<div class="card empty">
        <div class="empty-icon">${ICONS.bolt}</div>
        <h2>Crea tu primera automatización</h2>
        <p>Elige un reel, define la palabra clave (por ejemplo "PLAN") y el mensaje que recibirá quien comente.</p>
        <a class="btn btn-primary" href="#/automations/new">${ICONS.plus} Nueva automatización</a>
      </div>`
    : `<div class="automations">${automations.map(automationCard).join('')}</div>`;

  app.innerHTML = shell('automations', `
    <div class="page-head">
      <div>
        <h1>Automatizaciones</h1>
        <p>Comentario con palabra clave → DM automático</p>
      </div>
      <a class="btn btn-primary" href="#/automations/new">${ICONS.plus} Nueva automatización</a>
    </div>
    <div class="stats">
      <div class="card stat"><div class="stat-label">Comentarios</div><div class="stat-value">${n(t.comment)}</div><div class="stat-sub">últimos 30 días</div></div>
      <div class="card stat"><div class="stat-label">DMs enviados</div><div class="stat-value">${n((t.opening_sent ?? 0) + (t.dm_sent ?? 0))}</div><div class="stat-sub">apertura + enlace</div></div>
      <div class="card stat"><div class="stat-label">Clics en botón</div><div class="stat-value">${n(t.button_click)}</div><div class="stat-sub">últimos 30 días</div></div>
      <div class="card stat"><div class="stat-label">Clics en enlace</div><div class="stat-value">${n(t.link_click)}</div><div class="stat-sub">últimos 30 días</div></div>
    </div>
    ${list}`);

  app.querySelectorAll('[data-toggle]').forEach((input) => {
    input.addEventListener('change', async () => {
      try {
        await api(`/api/automations/${input.dataset.toggle}`, { method: 'PATCH', body: { active: input.checked } });
        toast(input.checked ? 'Automatización activada' : 'Automatización pausada');
        render();
      } catch (err) {
        input.checked = !input.checked;
        toast(err.message, 'error');
      }
    });
  });
}

// ---------- Editor ----------

const DEFAULT_AUTOMATION = {
  name: '',
  active: true,
  config: {
    scope: 'specific',
    media: [],
    trigger: { anyComment: false, keywords: [], match: 'word' },
    publicReply: {
      enabled: true,
      replies: ['¡Te lo acabo de enviar por DM! 📩', '¡Revisa tus mensajes! 💪', '¡Enviado! Mira tu bandeja de entrada 🔥'],
    },
    opening: {
      enabled: true,
      text: '¡Hola {username}! 👋 Gracias por comentar. Pulsa el botón y te envío el enlace 👇',
      button: 'Envíamelo',
    },
    followGate: {
      enabled: false,
      text: '¡Casi lo tienes! 🙌 Sígueme para recibirlo y vuelve a pulsar el botón.',
      button: 'Ya te sigo',
    },
    message: { text: '¡Aquí lo tienes! 🔥 Cualquier duda me escribes por aquí.', linkUrl: '', linkTitle: 'Ver enlace' },
  },
};

const MATCH_LABELS = {
  word: 'Contiene la palabra',
  exact: 'Es exactamente la palabra',
  contains: 'Contiene el texto (aunque sea parte de otra palabra)',
};

let draft = null;

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => o?.[k], obj);
}
function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  keys.reduce((o, k) => o[k], obj)[last] = value;
}

async function loadMedia() {
  const m = state.media;
  if (m.loading) return;
  m.loading = true;
  try {
    const data = await api(`/api/media${m.next ? `?after=${encodeURIComponent(m.next)}` : ''}`);
    m.items.push(...data.items);
    m.next = data.next;
    m.loaded = true;
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    m.loading = false;
  }
}

function mediaGrid() {
  const m = state.media;
  if (!m.loaded) return '<div class="boot" style="min-height:120px"><div class="spinner"></div></div>';
  const selected = new Set(draft.config.media.map((x) => x.id));
  const items = m.items.filter((item) => m.filter === 'all'
    || (m.filter === 'reels' ? item.productType === 'REELS' : item.productType !== 'REELS'));
  if (m.items.length === 0) return '<p class="hint">Todavía no tienes publicaciones en esta cuenta.</p>';

  return `
    <div class="media-grid">
      ${items.map((item) => `
        <button type="button" class="media-item ${selected.has(item.id) ? 'selected' : ''}" data-action="toggleMedia" data-id="${esc(item.id)}"
          title="${esc(item.caption.slice(0, 140))}">
          ${img(item.thumbnail, item.caption.slice(0, 60))}
          <span class="type">${item.productType === 'REELS' ? 'Reel' : item.mediaType === 'CAROUSEL_ALBUM' ? 'Carrusel' : 'Post'}</span>
          <span class="check">${selected.has(item.id) ? '✓' : ''}</span>
          <span class="info"><span>${esc(item.caption || 'Sin texto')}</span><span>💬 ${n(item.commentsCount)}</span></span>
        </button>`).join('')}
    </div>
    ${m.next ? `<div class="load-more"><button class="btn btn-sm" data-action="moreMedia" ${m.loading ? 'disabled' : ''}>Cargar más</button></div>` : ''}`;
}

function step(num, { title, subtitle, toggle, enabled = true, disabled = false, body }) {
  return `
    <section class="card step ${enabled ? 'enabled' : 'off'}">
      <div class="step-head">
        <div class="step-num">${num}</div>
        <div class="step-title"><h2>${title}</h2>${subtitle ? `<p>${subtitle}</p>` : ''}</div>
        ${toggle ? `<label class="switch"><input type="checkbox" data-check="${toggle}" ${enabled ? 'checked' : ''} ${disabled ? 'disabled' : ''}><span></span></label>` : ''}
      </div>
      <div class="step-body stack">${body}</div>
    </section>`;
}

const field = (label, control, hint) => `
  <label class="field"><span class="field-label">${label}</span>${control}${hint ? `<p class="hint">${hint}</p>` : ''}</label>`;
const textInput = (path, { max, placeholder = '', type = 'text' } = {}) => `
  <input class="input" type="${type}" data-bind="${path}" value="${esc(getPath(draft, path))}" ${max ? `maxlength="${max}"` : ''} placeholder="${esc(placeholder)}">`;
const textArea = (path, max = 640) => `
  <textarea class="textarea" data-bind="${path}" maxlength="${max}">${esc(getPath(draft, path))}</textarea>`;

function editorForm() {
  const c = draft.config;
  const m = state.media;

  const where = step(1, {
    title: 'Cuando alguien comenta en…',
    body: `
      <div class="segmented">
        <button type="button" class="${c.scope === 'specific' ? 'on' : ''}" data-action="scope" data-value="specific">Una publicación o reel concreto</button>
        <button type="button" class="${c.scope === 'all' ? 'on' : ''}" data-action="scope" data-value="all">Cualquier publicación</button>
      </div>
      ${c.scope === 'specific' ? `
        <div class="media-toolbar">
          <div class="segmented">
            ${[['all', 'Todo'], ['reels', 'Reels'], ['posts', 'Publicaciones']].map(([value, label]) => `
              <button type="button" class="${m.filter === value ? 'on' : ''}" data-action="mediaFilter" data-value="${value}">${label}</button>`).join('')}
          </div>
          <span class="hint" style="margin:0">${c.media.length} seleccionada${c.media.length === 1 ? '' : 's'}</span>
        </div>
        <div id="media">${mediaGrid()}</div>` : '<p class="hint">Se activará en todas tus publicaciones y reels, también en los que publiques a partir de ahora.</p>'}`,
  });

  const trigger = step(2, {
    title: '…y el comentario',
    body: `
      <div class="segmented">
        <button type="button" class="${!c.trigger.anyComment ? 'on' : ''}" data-action="anyComment" data-value="false">Contiene una palabra clave</button>
        <button type="button" class="${c.trigger.anyComment ? 'on' : ''}" data-action="anyComment" data-value="true">Cualquier comentario</button>
      </div>
      ${c.trigger.anyComment ? '<p class="hint">Todas las personas que comenten recibirán el DM (una vez por comentario).</p>' : `
        ${field('Palabras clave', `
          <div class="chip-input" data-action="focusKeyword">
            ${c.trigger.keywords.map((k, i) => `<span class="chip">${esc(k)}<button type="button" data-action="removeKeyword" data-index="${i}" aria-label="Quitar">×</button></span>`).join('')}
            <input id="keyword" maxlength="50" placeholder="${c.trigger.keywords.length ? 'Añadir otra…' : 'Ej: PLAN y pulsa Enter'}">
          </div>`, 'Da igual mayúsculas, minúsculas o tildes. Pulsa Enter o coma para añadir.')}
        ${field('Coincidencia', `
          <select class="select" data-bind="config.trigger.match">
            ${Object.entries(MATCH_LABELS).map(([value, label]) => `<option value="${value}" ${c.trigger.match === value ? 'selected' : ''}>${label}</option>`).join('')}
          </select>`)}`}`,
  });

  const publicReply = step(3, {
    title: 'Responder al comentario en público',
    subtitle: 'Se elige una respuesta al azar para que Instagram no lo vea como spam.',
    toggle: 'config.publicReply.enabled',
    enabled: c.publicReply.enabled,
    body: `
      <div class="variants">
        ${c.publicReply.replies.map((r, i) => `
          <div class="variant">
            <input class="input" data-bind="config.publicReply.replies.${i}" value="${esc(r)}" maxlength="300">
            ${c.publicReply.replies.length > 1 ? `<button type="button" class="icon-btn" data-action="removeReply" data-index="${i}" title="Quitar">${ICONS.x}</button>` : ''}
          </div>`).join('')}
      </div>
      ${c.publicReply.replies.length < 10 ? `<button type="button" class="btn btn-sm" data-action="addReply">${ICONS.plus} Añadir variante</button>` : ''}`,
  });

  const opening = step(4, {
    title: 'Mensaje de apertura con botón',
    subtitle: 'Recomendado: el enlace se envía cuando la persona pulsa el botón, así Instagram lo entrega mejor.',
    toggle: 'config.opening.enabled',
    enabled: c.opening.enabled,
    body: `
      ${field('Mensaje', textArea('config.opening.text'), 'Usa {username} para poner el @ de quien comenta.')}
      ${field('Texto del botón', textInput('config.opening.button', { max: 20 }), 'Máximo 20 caracteres.')}`,
  });

  const followGate = step(5, {
    title: 'Pedir que te siga antes de enviar el enlace',
    subtitle: c.opening.enabled
      ? 'Si no te sigue, le pedimos que lo haga y que vuelva a pulsar el botón.'
      : 'Activa primero el mensaje de apertura.',
    toggle: 'config.followGate.enabled',
    enabled: c.followGate.enabled,
    disabled: !c.opening.enabled,
    body: `
      ${field('Mensaje si no te sigue', textArea('config.followGate.text'))}
      ${field('Texto del botón', textInput('config.followGate.button', { max: 20 }))}`,
  });

  const message = step(6, {
    title: 'Mensaje con el enlace',
    body: `
      ${field('Mensaje', textArea('config.message.text'), 'Usa {username} para poner el @ de quien comenta.')}
      <div class="row">
        ${field('Enlace (opcional)', textInput('config.message.linkUrl', { type: 'url', placeholder: 'https://tu-web.com/plan' }))}
        ${field('Texto del botón', textInput('config.message.linkTitle', { max: 20 }))}
      </div>
      <p class="hint">Contamos los clics en el enlace para tus estadísticas.</p>`,
  });

  return where + trigger + publicReply + opening + followGate + message;
}

function previewHtml() {
  const c = draft.config;
  const user = '@usuario';
  const fill = (text) => esc((text || '').replaceAll('{username}', user));
  const firstMedia = c.scope === 'specific' ? c.media[0] : null;
  const keyword = c.trigger.anyComment ? '¡Me encanta! 🔥' : (c.trigger.keywords[0] || 'PLAN');
  const card = (text, button) => `<div class="bubble-card"><div class="text">${fill(text)}</div><div class="btn-line">${esc(button)}</div></div>`;

  const final = c.message.linkUrl
    ? card(c.message.text, c.message.linkTitle || 'Ver enlace')
    : `<div class="bubble them">${fill(c.message.text)}</div>`;

  return `
    <div class="preview-title">Vista previa</div>
    <div class="phone">
      <div class="phone-top">${avatar(state.me)} ${esc(state.me.username)}</div>
      <div class="phone-body">
        <div class="pv-post">
          ${firstMedia?.thumbnail ? img(firstMedia.thumbnail) : '<div class="ph"></div>'}
          <span>${esc(firstMedia?.caption || (c.scope === 'all' ? 'Cualquier publicación' : 'Elige una publicación'))}</span>
        </div>
        <div class="pv-comment"><div class="avatar"></div><div><b>usuario</b> ${esc(keyword)}</div></div>
        ${c.publicReply.enabled && c.publicReply.replies[0] ? `
          <div class="pv-comment reply">${avatar(state.me)}<div><b>${esc(state.me.username)}</b> ${fill(c.publicReply.replies[0])}</div></div>` : ''}
        <div class="pv-label">Mensajes directos</div>
        ${c.opening.enabled ? `
          ${card(c.opening.text, c.opening.button)}
          <div class="pv-tap">Pulsa «${esc(c.opening.button)}»</div>
          ${c.followGate.enabled ? `
            ${card(c.followGate.text, c.followGate.button)}
            <div class="pv-tap">Te sigue y pulsa «${esc(c.followGate.button)}»</div>` : ''}` : ''}
        ${final}
      </div>
    </div>`;
}

function updatePreview() {
  const el = document.getElementById('preview');
  if (el) el.innerHTML = previewHtml();
}

function renderEditorBody() {
  const form = document.getElementById('form');
  if (!form) return;
  const scroll = window.scrollY;
  form.innerHTML = editorForm();
  updatePreview();
  window.scrollTo(0, scroll);
}

async function renderEditor(id) {
  const existing = id ? await api(`/api/automations/${id}`) : null;
  draft = clone(existing ? { name: existing.name, active: existing.active, config: existing.config } : DEFAULT_AUTOMATION);
  if (!state.media.loaded) loadMedia().then(renderEditorBody);

  function addKeyword(raw, { focus = true } = {}) {
    const values = raw.split(',').map((v) => v.trim()).filter(Boolean);
    const keywords = draft.config.trigger.keywords;
    const added = [];
    for (const value of values) {
      if (!keywords.some((k) => k.toLowerCase() === value.toLowerCase())) {
        keywords.push(value);
        added.push(value);
      }
    }
    if (focus) {
      renderEditorBody();
      document.getElementById('keyword')?.focus();
    } else {
      // Al salir del campo solo se redibujan las etiquetas, para no robar el foco al siguiente campo.
      const input = document.getElementById('keyword');
      input.value = '';
      input.insertAdjacentHTML('beforebegin', added.map((v) => `<span class="chip">${esc(v)}</span>`).join(''));
      updatePreview();
    }
  }

  actions = {
    ...commonActions,
    scope(el) { draft.config.scope = el.dataset.value; renderEditorBody(); },
    anyComment(el) { draft.config.trigger.anyComment = el.dataset.value === 'true'; renderEditorBody(); },
    mediaFilter(el) { state.media.filter = el.dataset.value; renderEditorBody(); },
    async moreMedia() { await loadMedia(); renderEditorBody(); },
    toggleMedia(el) {
      const list = draft.config.media;
      const index = list.findIndex((x) => x.id === el.dataset.id);
      if (index >= 0) {
        list.splice(index, 1);
      } else {
        const item = state.media.items.find((x) => x.id === el.dataset.id);
        list.push({
          id: item.id, thumbnail: item.thumbnail, caption: item.caption.slice(0, 120),
          permalink: item.permalink, mediaType: item.productType === 'REELS' ? 'REELS' : item.mediaType,
        });
      }
      renderEditorBody();
    },
    focusKeyword(el, e) { if (e.target === el) document.getElementById('keyword')?.focus(); },
    removeKeyword(el) { draft.config.trigger.keywords.splice(Number(el.dataset.index), 1); renderEditorBody(); },
    addReply() { draft.config.publicReply.replies.push(''); renderEditorBody(); },
    removeReply(el) { draft.config.publicReply.replies.splice(Number(el.dataset.index), 1); renderEditorBody(); },
    async save(el) {
      const pending = document.getElementById('keyword')?.value.trim();
      if (pending) addKeyword(pending);
      el.disabled = true;
      try {
        await api(id ? `/api/automations/${id}` : '/api/automations', { method: id ? 'PUT' : 'POST', body: draft });
        toast(id ? 'Cambios guardados' : 'Automatización creada 🎉');
        location.hash = '#/';
      } catch (err) {
        toast(err.message, 'error');
        el.disabled = false;
      }
    },
  };

  app.innerHTML = shell('automations', `
    <div class="editor-head">
      <a class="icon-btn" href="#/" title="Volver">←</a>
      <input class="name-input" data-bind="name" value="${esc(draft.name)}" placeholder="${id ? 'Nombre' : 'Nueva automatización'}" maxlength="80">
      <label class="status-toggle"><span>${draft.active ? 'Activa' : 'Pausada'}</span>
        <span class="switch"><input type="checkbox" data-check="active" ${draft.active ? 'checked' : ''}><span></span></span>
      </label>
    </div>
    <div class="editor">
      <div>
        <div id="form"></div>
        <div class="save-bar">
          <a class="btn" href="#/">Cancelar</a>
          <button class="btn btn-primary" data-action="save">${id ? 'Guardar cambios' : 'Crear automatización'}</button>
        </div>
      </div>
      <aside class="preview" id="preview"></aside>
    </div>`);
  renderEditorBody();

  // Los campos de texto solo actualizan el borrador y la vista previa (sin re-render para no perder el foco).
  handlers.input = (e) => {
    const path = e.target.dataset?.bind;
    if (!path) return;
    setPath(draft, path, e.target.value);
    updatePreview();
  };
  handlers.change = (e) => {
    const path = e.target.dataset?.check;
    if (path) {
      setPath(draft, path, e.target.checked);
      if (path === 'config.opening.enabled' && !e.target.checked) draft.config.followGate.enabled = false;
      if (path === 'active') e.target.closest('.status-toggle').firstElementChild.textContent = e.target.checked ? 'Activa' : 'Pausada';
      renderEditorBody();
    } else if (e.target.dataset?.bind) {
      setPath(draft, e.target.dataset.bind, e.target.value);
      updatePreview();
    }
  };
  handlers.keydown = (e) => {
    if (e.target.id !== 'keyword') return;
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      if (e.target.value.trim()) addKeyword(e.target.value);
    } else if (e.key === 'Backspace' && !e.target.value && draft.config.trigger.keywords.length) {
      draft.config.trigger.keywords.pop();
      renderEditorBody();
      document.getElementById('keyword')?.focus();
    }
  };
  handlers.focusout = (e) => {
    if (e.target.id === 'keyword' && e.target.value.trim() && !e.relatedTarget?.closest?.('[data-action]')) {
      addKeyword(e.target.value, { focus: false });
    }
  };
}

// ---------- Actividad ----------

const EVENT_LABELS = {
  comment: 'Comentario',
  public_reply: 'Respuesta pública',
  opening_sent: 'DM de apertura enviado',
  button_click: 'Pulsó el botón',
  follow_gate: 'Se le pidió seguir',
  dm_sent: 'DM con enlace enviado',
  link_click: 'Clic en el enlace',
  error: 'Error',
};

async function renderActivity() {
  const { query } = parseRoute();
  const selected = query.get('automation') || '';
  const [events, automations] = await Promise.all([
    api(`/api/events${selected ? `?automation=${encodeURIComponent(selected)}` : ''}`),
    api('/api/automations'),
  ]);
  actions = { ...commonActions };

  const rows = events.map((e) => `
    <tr>
      <td class="when" title="${esc(new Date(e.createdAt).toLocaleString('es'))}">${timeAgo(e.createdAt)}</td>
      <td><span class="pill ${esc(e.type)}"><i></i>${esc(EVENT_LABELS[e.type] ?? e.type)}</span></td>
      <td>${e.username ? `<a href="https://instagram.com/${encodeURIComponent(e.username)}" target="_blank" rel="noopener">@${esc(e.username)}</a>` : '<span class="hint">—</span>'}</td>
      <td>${esc(e.automationName ?? '—')}</td>
      <td class="detail">${esc(e.text ?? '')}</td>
    </tr>`).join('');

  app.innerHTML = shell('activity', `
    <div class="page-head">
      <div><h1>Actividad</h1><p>Lo último que han hecho tus automatizaciones</p></div>
      <select class="select" id="filter" style="width:auto;min-width:220px">
        <option value="">Todas las automatizaciones</option>
        ${automations.map((a) => `<option value="${a.id}" ${String(a.id) === selected ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}
      </select>
    </div>
    <div class="card">
      ${events.length === 0
        ? `<div class="empty"><div class="empty-icon">${ICONS.activity}</div><h2>Sin actividad todavía</h2><p>Cuando alguien comente en una publicación con una automatización activa, lo verás aquí.</p></div>`
        : `<div class="table-wrap"><table class="table">
            <thead><tr><th>Cuándo</th><th>Evento</th><th>Usuario</th><th>Automatización</th><th>Detalle</th></tr></thead>
            <tbody>${rows}</tbody>
          </table></div>`}
    </div>`);

  document.getElementById('filter').addEventListener('change', (e) => {
    location.hash = e.target.value ? `#/activity?automation=${e.target.value}` : '#/activity';
  });
}

// ---------- Router ----------

function parseRoute() {
  const [path, qs] = (location.hash.slice(1) || '/').split('?');
  return { path, query: new URLSearchParams(qs) };
}

async function render() {
  const { path, query } = parseRoute();
  handlers = {};

  if (path === '/login') return renderLogin(query.get('error'));

  try {
    if (!state.me) state.me = await api('/api/me');
    if (path === '/') return await renderDashboard();
    if (path === '/activity') return await renderActivity();
    if (path === '/automations/new') return await renderEditor(null);
    const match = path.match(/^\/automations\/(\d+)$/);
    if (match) return await renderEditor(Number(match[1]));
    location.hash = '#/';
  } catch (err) {
    if (state.me) toast(err.message, 'error');
  }
}

window.addEventListener('hashchange', render);
render();
