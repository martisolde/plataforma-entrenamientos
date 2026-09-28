try {
  process.loadEnvFile();
} catch {
  // Sin fichero .env: se usan las variables de entorno del sistema.
}

export function loadConfig(env = process.env) {
  const config = {
    port: Number(env.PORT) || 3000,
    baseUrl: (env.BASE_URL || `http://localhost:${Number(env.PORT) || 3000}`).replace(/\/+$/, ''),
    appId: env.IG_APP_ID,
    appSecret: env.IG_APP_SECRET,
    verifyToken: env.VERIFY_TOKEN,
    sessionSecret: env.SESSION_SECRET,
    databasePath: env.DATABASE_PATH || 'data/app.db',
    graphApiVersion: env.GRAPH_API_VERSION || 'v23.0',
  };

  const missing = [
    ['IG_APP_ID', config.appId],
    ['IG_APP_SECRET', config.appSecret],
    ['VERIFY_TOKEN', config.verifyToken],
    ['SESSION_SECRET', config.sessionSecret],
  ].filter(([, value]) => !value).map(([name]) => name);

  if (missing.length > 0) {
    throw new Error(`Faltan variables de entorno: ${missing.join(', ')} (revisa tu .env)`);
  }
  if (config.sessionSecret.length < 32) {
    throw new Error('SESSION_SECRET debe tener al menos 32 caracteres');
  }

  return config;
}
