import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function sendJson(res, status, data, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(data));
}

export function redirect(res, location, headers = {}) {
  res.writeHead(302, { Location: location, 'Cache-Control': 'no-store', ...headers });
  res.end();
}

export function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new HttpError(413, 'Petición demasiado grande'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export async function readJson(req) {
  const body = await readBody(req);
  try {
    return JSON.parse(body.toString('utf8') || '{}');
  } catch {
    throw new HttpError(400, 'JSON inválido');
  }
}

export async function readForm(req) {
  return Object.fromEntries(new URLSearchParams((await readBody(req)).toString('utf8')));
}

export function parseCookies(req) {
  const cookies = {};
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index > 0) {
      try {
        cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
      } catch {
        // Cookie mal formada: se ignora.
      }
    }
  }
  return cookies;
}

export function cookie(name, value, { maxAge, secure, httpOnly = true, sameSite = 'Lax' } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', `SameSite=${sameSite}`];
  if (maxAge !== undefined) parts.push(`Max-Age=${maxAge}`);
  if (httpOnly) parts.push('HttpOnly');
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

export async function serveStatic(res, rootDir, pathname) {
  const file = normalize(join(rootDir, pathname === '/' ? 'index.html' : pathname));
  if (!file.startsWith(rootDir + sep)) return false;
  try {
    const content = await readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(content);
    return true;
  } catch {
    return false;
  }
}

// Router mínimo: add('GET', '/api/automations/:id', handler).
export function createRouter() {
  const routes = [];
  return {
    add(method, path, handler) {
      const keys = [];
      const pattern = new RegExp(`^${path.replace(/:(\w+)/g, (_, key) => {
        keys.push(key);
        return '([^/]+)';
      })}$`);
      routes.push({ method, pattern, keys, handler });
    },
    match(method, pathname) {
      for (const route of routes) {
        const m = route.pattern.exec(pathname);
        if (!m || route.method !== method) continue;
        try {
          const params = Object.fromEntries(route.keys.map((key, i) => [key, decodeURIComponent(m[i + 1])]));
          return { handler: route.handler, params };
        } catch {
          return null;
        }
      }
      return null;
    },
  };
}
