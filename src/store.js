import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const MAX_ENTRIES = 5000;

// Guarda los IDs de comentarios ya procesados para no mandar dos DMs
// cuando Meta reenvía el mismo webhook.
export function createProcessedStore(dataDir) {
  const file = dataDir ? join(dataDir, 'processed-comments.json') : null;
  let ids = [];

  if (file) {
    mkdirSync(dataDir, { recursive: true });
    try {
      ids = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      ids = [];
    }
  }
  const seen = new Set(ids);

  return {
    has: (id) => seen.has(id),
    add(id) {
      if (seen.has(id)) return;
      seen.add(id);
      ids.push(id);
      if (ids.length > MAX_ENTRIES) seen.delete(ids.shift());
      if (file) writeFileSync(file, JSON.stringify(ids));
    },
  };
}
