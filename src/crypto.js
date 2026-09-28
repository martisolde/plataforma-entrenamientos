import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export function randomId(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

export function safeEqual(a, b) {
  const bufA = Buffer.from(String(a ?? ''));
  const bufB = Buffer.from(String(b ?? ''));
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

// Cifra los tokens de Instagram antes de guardarlos en la base de datos.
export function createCipher(secret) {
  const key = createHash('sha256').update(secret).digest();
  return {
    encrypt(text) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
    },
    decrypt(payload) {
      const data = Buffer.from(payload, 'base64');
      const decipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
      decipher.setAuthTag(data.subarray(12, 28));
      return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8');
    },
  };
}

// Firma X-Hub-Signature-256 de los webhooks de Meta.
export function verifyWebhookSignature(rawBody, signatureHeader, appSecret) {
  if (!signatureHeader?.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', appSecret).update(rawBody).digest('hex');
  return safeEqual(expected, signatureHeader.slice('sha256='.length));
}

// "signed_request" que Meta envía en los callbacks de desautorización y borrado de datos.
export function parseSignedRequest(signedRequest, appSecret) {
  const [signature, payload] = String(signedRequest ?? '').split('.');
  if (!signature || !payload) return null;
  const expected = createHmac('sha256', appSecret).update(payload).digest('base64url');
  if (!safeEqual(expected, signature)) return null;
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}
