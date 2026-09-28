try {
  process.loadEnvFile();
} catch {
  // Sin fichero .env: se usan las variables de entorno del sistema.
}

export function loadConfig(env = process.env) {
  const config = {
    port: Number(env.PORT) || 3000,
    verifyToken: env.VERIFY_TOKEN,
    appSecret: env.APP_SECRET,
    accessToken: env.IG_ACCESS_TOKEN,
    graphApiVersion: env.GRAPH_API_VERSION || 'v23.0',
    rulesFile: env.RULES_FILE || 'rules.json',
    dataDir: env.DATA_DIR || 'data',
    dryRun: env.DRY_RUN === 'true',
  };

  const missing = [
    ['VERIFY_TOKEN', config.verifyToken],
    ['APP_SECRET', config.appSecret],
    ['IG_ACCESS_TOKEN', config.accessToken],
  ].filter(([, value]) => !value).map(([name]) => name);

  if (missing.length > 0) {
    throw new Error(`Faltan variables de entorno: ${missing.join(', ')} (revisa tu .env)`);
  }

  return config;
}
