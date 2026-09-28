// Cliente mínimo de la Instagram API con "Instagram Login" (graph.instagram.com).
export function createInstagramClient({ accessToken, graphApiVersion, fetchImpl = fetch }) {
  const baseUrl = `https://graph.instagram.com/${graphApiVersion}`;

  async function post(path, body) {
    const res = await fetchImpl(`${baseUrl}/${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) {
      const message = data.error?.message || `HTTP ${res.status}`;
      throw new Error(`Instagram API ${path}: ${message}`);
    }
    return data;
  }

  return {
    // "Private reply": DM a quien ha comentado. Solo uno por comentario
    // y dentro de los 7 días siguientes al comentario.
    sendPrivateReply(igUserId, commentId, text) {
      return post(`${igUserId}/messages`, {
        recipient: { comment_id: commentId },
        message: { text },
      });
    },

    replyToComment(commentId, text) {
      return post(`${commentId}/replies`, { message: text });
    },
  };
}

export async function refreshLongLivedToken(accessToken, fetchImpl = fetch) {
  const url = new URL('https://graph.instagram.com/refresh_access_token');
  url.searchParams.set('grant_type', 'ig_refresh_token');
  url.searchParams.set('access_token', accessToken);
  const res = await fetchImpl(url);
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(`No se pudo renovar el token: ${data.error?.message || res.status}`);
  }
  return data;
}
