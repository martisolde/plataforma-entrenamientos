import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomId } from './crypto.js';

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY,
    ig_user_id TEXT NOT NULL UNIQUE,
    app_scoped_id TEXT,
    username TEXT NOT NULL,
    name TEXT,
    picture_url TEXT,
    access_token TEXT NOT NULL,
    token_expires_at INTEGER NOT NULL,
    token_refreshed_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS automations (
    id INTEGER PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    config TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    automation_id INTEGER REFERENCES automations(id) ON DELETE SET NULL,
    type TEXT NOT NULL,
    user_id TEXT,
    username TEXT,
    comment_id TEXT,
    text TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS events_account ON events(account_id, created_at);
  CREATE INDEX IF NOT EXISTS events_automation ON events(automation_id, type);

  CREATE TABLE IF NOT EXISTS processed_comments (
    comment_id TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL
  );
`;

const SESSION_TTL = 30 * 24 * 60 * 60 * 1000;

export function openDatabase(path, { cipher, now = Date.now } = {}) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);

  const q = (sql) => db.prepare(sql);

  function toAccount(row) {
    if (!row) return null;
    return {
      id: row.id,
      igUserId: row.ig_user_id,
      appScopedId: row.app_scoped_id,
      username: row.username,
      name: row.name,
      pictureUrl: row.picture_url,
      accessToken: cipher.decrypt(row.access_token),
      tokenExpiresAt: row.token_expires_at,
      tokenRefreshedAt: row.token_refreshed_at,
    };
  }

  function toAutomation(row) {
    if (!row) return null;
    return {
      id: row.id,
      accountId: row.account_id,
      name: row.name,
      active: Boolean(row.active),
      config: JSON.parse(row.config),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  const accounts = {
    upsert({ igUserId, appScopedId, username, name, pictureUrl, accessToken, tokenExpiresAt }) {
      const ts = now();
      q(`INSERT INTO accounts (ig_user_id, app_scoped_id, username, name, picture_url, access_token,
            token_expires_at, token_refreshed_at, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(ig_user_id) DO UPDATE SET
            app_scoped_id = excluded.app_scoped_id, username = excluded.username, name = excluded.name,
            picture_url = excluded.picture_url, access_token = excluded.access_token,
            token_expires_at = excluded.token_expires_at, token_refreshed_at = excluded.token_refreshed_at`)
        .run(igUserId, appScopedId ?? null, username, name ?? null, pictureUrl ?? null,
          cipher.encrypt(accessToken), tokenExpiresAt, ts, ts);
      return accounts.findByIgUserId(igUserId);
    },
    findById: (id) => toAccount(q('SELECT * FROM accounts WHERE id = ?').get(id)),
    findByIgUserId: (igUserId) => toAccount(q('SELECT * FROM accounts WHERE ig_user_id = ?').get(String(igUserId))),
    findByAnyId: (id) => toAccount(
      q('SELECT * FROM accounts WHERE ig_user_id = ? OR app_scoped_id = ?').get(String(id), String(id)),
    ),
    updateToken(id, accessToken, tokenExpiresAt) {
      q('UPDATE accounts SET access_token = ?, token_expires_at = ?, token_refreshed_at = ? WHERE id = ?')
        .run(cipher.encrypt(accessToken), tokenExpiresAt, now(), id);
    },
    listNeedingRefresh(expiresBefore, refreshedBefore) {
      return q('SELECT * FROM accounts WHERE token_expires_at < ? AND token_refreshed_at < ?')
        .all(expiresBefore, refreshedBefore).map(toAccount);
    },
    delete: (id) => q('DELETE FROM accounts WHERE id = ?').run(id),
  };

  const sessions = {
    create(accountId) {
      const id = randomId();
      q('INSERT INTO sessions (id, account_id, expires_at) VALUES (?, ?, ?)').run(id, accountId, now() + SESSION_TTL);
      return id;
    },
    findAccount(sessionId) {
      if (!sessionId) return null;
      const row = q(`SELECT a.* FROM sessions s JOIN accounts a ON a.id = s.account_id
                     WHERE s.id = ? AND s.expires_at > ?`).get(sessionId, now());
      return toAccount(row);
    },
    delete: (sessionId) => q('DELETE FROM sessions WHERE id = ?').run(sessionId),
    deleteExpired: () => q('DELETE FROM sessions WHERE expires_at <= ?').run(now()),
  };

  const automations = {
    list: (accountId) => q('SELECT * FROM automations WHERE account_id = ? ORDER BY created_at DESC')
      .all(accountId).map(toAutomation),
    listActive: (accountId) => q('SELECT * FROM automations WHERE account_id = ? AND active = 1 ORDER BY created_at')
      .all(accountId).map(toAutomation),
    get: (accountId, id) => toAutomation(q('SELECT * FROM automations WHERE account_id = ? AND id = ?').get(accountId, id)),
    getById: (id) => toAutomation(q('SELECT * FROM automations WHERE id = ?').get(id)),
    create(accountId, { name, active, config }) {
      const ts = now();
      const { lastInsertRowid } = q(`INSERT INTO automations (account_id, name, active, config, created_at, updated_at)
                                     VALUES (?, ?, ?, ?, ?, ?)`)
        .run(accountId, name, active ? 1 : 0, JSON.stringify(config), ts, ts);
      return automations.get(accountId, Number(lastInsertRowid));
    },
    update(accountId, id, { name, active, config }) {
      q('UPDATE automations SET name = ?, active = ?, config = ?, updated_at = ? WHERE account_id = ? AND id = ?')
        .run(name, active ? 1 : 0, JSON.stringify(config), now(), accountId, id);
      return automations.get(accountId, id);
    },
    setActive(accountId, id, active) {
      q('UPDATE automations SET active = ?, updated_at = ? WHERE account_id = ? AND id = ?')
        .run(active ? 1 : 0, now(), accountId, id);
      return automations.get(accountId, id);
    },
    delete: (accountId, id) => q('DELETE FROM automations WHERE account_id = ? AND id = ?').run(accountId, id).changes > 0,
  };

  const events = {
    add({ accountId, automationId = null, type, userId = null, username = null, commentId = null, text = null }) {
      q(`INSERT INTO events (account_id, automation_id, type, user_id, username, comment_id, text, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(accountId, automationId, type, userId, username, commentId, text, now());
    },
    list(accountId, { limit = 100, automationId } = {}) {
      const rows = automationId
        ? q(`SELECT e.*, a.name AS automation_name FROM events e LEFT JOIN automations a ON a.id = e.automation_id
             WHERE e.account_id = ? AND e.automation_id = ? ORDER BY e.id DESC LIMIT ?`).all(accountId, automationId, limit)
        : q(`SELECT e.*, a.name AS automation_name FROM events e LEFT JOIN automations a ON a.id = e.automation_id
             WHERE e.account_id = ? ORDER BY e.id DESC LIMIT ?`).all(accountId, limit);
      return rows.map((row) => ({
        id: row.id,
        automationId: row.automation_id,
        automationName: row.automation_name,
        type: row.type,
        userId: row.user_id,
        username: row.username,
        text: row.text,
        createdAt: row.created_at,
      }));
    },
    // { [automationId]: { [type]: count } }
    countsByAutomation(accountId) {
      const result = {};
      for (const row of q(`SELECT automation_id, type, COUNT(*) AS n FROM events
                            WHERE account_id = ? AND automation_id IS NOT NULL GROUP BY automation_id, type`).all(accountId)) {
        (result[row.automation_id] ??= {})[row.type] = row.n;
      }
      return result;
    },
    totals(accountId, since) {
      const result = {};
      for (const row of q('SELECT type, COUNT(*) AS n FROM events WHERE account_id = ? AND created_at >= ? GROUP BY type')
        .all(accountId, since)) {
        result[row.type] = row.n;
      }
      return result;
    },
  };

  // Evita enviar dos DMs cuando Meta reenvía el mismo webhook.
  const processedComments = {
    claim: (commentId) => q('INSERT OR IGNORE INTO processed_comments (comment_id, created_at) VALUES (?, ?)')
      .run(commentId, now()).changes > 0,
    release: (commentId) => q('DELETE FROM processed_comments WHERE comment_id = ?').run(commentId),
    pruneOlderThan: (ts) => q('DELETE FROM processed_comments WHERE created_at < ?').run(ts),
  };

  return { raw: db, accounts, sessions, automations, events, processedComments, close: () => db.close() };
}
