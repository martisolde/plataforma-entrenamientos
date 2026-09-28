// Cliente de la Instagram API con "Instagram Login" (graph.instagram.com).

export const SCOPES = [
  'instagram_business_basic',
  'instagram_business_manage_messages',
  'instagram_business_manage_comments',
];

export const WEBHOOK_FIELDS = ['comments', 'messages', 'messaging_postbacks'];

const MEDIA_FIELDS = [
  'id', 'caption', 'media_type', 'media_product_type', 'media_url', 'thumbnail_url',
  'permalink', 'timestamp', 'comments_count', 'like_count',
].join(',');

export class InstagramApiError extends Error {
  constructor(message, { status, code } = {}) {
    super(message);
    this.name = 'InstagramApiError';
    this.status = status;
    this.code = code;
  }
}

export function createInstagramApi({ appId, appSecret, graphApiVersion = 'v23.0', fetchImpl = fetch }) {
  const graph = `https://graph.instagram.com/${graphApiVersion}`;

  async function request(url, { method = 'GET', token, json, form } = {}) {
    const headers = {};
    let body;
    if (token) headers.Authorization = `Bearer ${token}`;
    if (json) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(json);
    } else if (form) {
      body = new URLSearchParams(form);
    }

    const res = await fetchImpl(url, { method, headers, body });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error || data.error_type) {
      const message = data.error?.message || data.error_message || `HTTP ${res.status}`;
      throw new InstagramApiError(message, { status: res.status, code: data.error?.code ?? data.code });
    }
    return data;
  }

  function withParams(base, params) {
    const url = new URL(base);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, value);
    }
    return url;
  }

  return {
    authorizeUrl({ redirectUri, state }) {
      return withParams('https://www.instagram.com/oauth/authorize', {
        client_id: appId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: SCOPES.join(','),
        state,
      }).toString();
    },

    async exchangeCode({ code, redirectUri }) {
      const data = await request('https://api.instagram.com/oauth/access_token', {
        method: 'POST',
        form: {
          client_id: appId,
          client_secret: appSecret,
          grant_type: 'authorization_code',
          redirect_uri: redirectUri,
          code,
        },
      });
      const result = data.data?.[0] ?? data;
      return { accessToken: result.access_token, appScopedId: String(result.user_id) };
    },

    // Cambia el token de 1 hora por uno de 60 días.
    async getLongLivedToken(shortLivedToken) {
      const data = await request(withParams('https://graph.instagram.com/access_token', {
        grant_type: 'ig_exchange_token',
        client_secret: appSecret,
        access_token: shortLivedToken,
      }));
      return { accessToken: data.access_token, expiresIn: data.expires_in };
    },

    async refreshToken(token) {
      const data = await request(withParams('https://graph.instagram.com/refresh_access_token', {
        grant_type: 'ig_refresh_token',
        access_token: token,
      }));
      return { accessToken: data.access_token, expiresIn: data.expires_in };
    },

    getMe(token) {
      return request(withParams(`${graph}/me`, {
        fields: 'user_id,username,name,profile_picture_url,account_type',
      }), { token });
    },

    // Activa los webhooks de esta cuenta para nuestra app.
    subscribeWebhooks(token) {
      return request(withParams(`${graph}/me/subscribed_apps`, {
        subscribed_fields: WEBHOOK_FIELDS.join(','),
      }), { method: 'POST', token });
    },

    listMedia(token, { after, limit = 24 } = {}) {
      return request(withParams(`${graph}/me/media`, { fields: MEDIA_FIELDS, limit, after }), { token });
    },

    // "Private reply": DM al autor de un comentario (uno por comentario, máx. 7 días).
    sendPrivateReply(token, igUserId, commentId, message) {
      return request(`${graph}/${igUserId}/messages`, {
        method: 'POST',
        token,
        json: { recipient: { comment_id: commentId }, message },
      });
    },

    sendMessage(token, igUserId, recipientId, message) {
      return request(`${graph}/${igUserId}/messages`, {
        method: 'POST',
        token,
        json: { recipient: { id: recipientId }, message },
      });
    },

    replyToComment(token, commentId, text) {
      return request(`${graph}/${commentId}/replies`, { method: 'POST', token, json: { message: text } });
    },

    getUserProfile(token, igScopedId) {
      return request(withParams(`${graph}/${igScopedId}`, {
        fields: 'username,name,is_user_follow_business',
      }), { token });
    },
  };
}
