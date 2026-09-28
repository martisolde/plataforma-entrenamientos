import { createServer } from 'node:http';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createCipher } from './crypto.js';
import { openDatabase } from './db.js';
import { createEngine } from './engine.js';
import { createInstagramApi } from './instagram.js';
import { startJobs } from './jobs.js';

const config = loadConfig();
const log = console;
const db = openDatabase(config.databasePath, { cipher: createCipher(config.sessionSecret) });
const instagram = createInstagramApi(config);
const engine = createEngine({ db, instagram, baseUrl: config.baseUrl, log });
const app = createApp({ config, db, instagram, engine, log });

startJobs({ db, instagram, log });

const server = createServer(app.handle);
server.listen(config.port, () => {
  log.info(`Panel: ${config.baseUrl}  ·  Webhook: ${config.baseUrl}/webhook`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close();
    app.idle().finally(() => {
      db.close();
      process.exit(0);
    });
  });
}
