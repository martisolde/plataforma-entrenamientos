const DAY = 24 * 60 * 60 * 1000;

// Los tokens de Instagram duran 60 días y solo se pueden renovar si tienen más de 24 h.
export async function refreshTokens({ db, instagram, log = console, now = Date.now() }) {
  const accounts = db.accounts.listNeedingRefresh(now + 20 * DAY, now - DAY);
  for (const account of accounts) {
    try {
      const { accessToken, expiresIn } = await instagram.refreshToken(account.accessToken);
      db.accounts.updateToken(account.id, accessToken, now + expiresIn * 1000);
      log.info(`Token de @${account.username} renovado`);
    } catch (err) {
      log.error(`No se pudo renovar el token de @${account.username}: ${err.message}`);
    }
  }
}

export function cleanup({ db, now = Date.now() }) {
  db.sessions.deleteExpired();
  db.processedComments.pruneOlderThan(now - 30 * DAY);
}

export function startJobs(deps, intervalMs = 6 * 60 * 60 * 1000) {
  const run = () => {
    cleanup(deps);
    refreshTokens(deps).catch((err) => deps.log?.error?.(err));
  };
  run();
  return setInterval(run, intervalMs).unref();
}
