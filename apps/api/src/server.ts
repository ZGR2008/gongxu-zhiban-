import 'dotenv/config';
import {createRuntimeDatabase} from './database.js';
import { loadConfig } from './config.js';
import { createApp } from './app.js';
import { PgProjectStore } from './project-store.js';
import { loadAiConfig } from './ai/model.js';
import { PgAiGenerationStore } from './ai/store.js';
import { resolveEmbeddingConfig } from './rag/service.js';

const config = loadConfig();
const embedding = resolveEmbeddingConfig();
const database = config.DATABASE_URL ? createRuntimeDatabase(config.DATABASE_URL) : undefined;
const app = await createApp({ database, pool: database, projectStore: database ? new PgProjectStore(database) : undefined,
  aiConfig: loadAiConfig(), aiGenerationStore: database ? new PgAiGenerationStore(database) : undefined,
  embeddingConfig: embedding.config, corsOrigin: config.CORS_ORIGIN, logger: true });
if (embedding.invalid) app.log.warn('Embedding configuration is invalid; indexing and retrieval are disabled. Configure an independent embedding provider.');

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
