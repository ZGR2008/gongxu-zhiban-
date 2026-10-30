import 'dotenv/config';
import pg from 'pg';
import { loadConfig } from './config.js';
import { createApp } from './app.js';

const config = loadConfig();
const database = config.DATABASE_URL ? new pg.Pool({ connectionString: config.DATABASE_URL, connectionTimeoutMillis: 3000 }) : undefined;
const app = await createApp({ database, corsOrigin: config.CORS_ORIGIN, logger: true });

try {
  await app.listen({ host: config.HOST, port: config.PORT });
  if (!database) app.log.warn('DATABASE_URL is not configured; /ready will return 503');
} catch (error) {
  app.log.error(error);
  await app.close();
  process.exitCode = 1;
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => { void app.close().then(() => { process.exitCode = 0; }); });
}
