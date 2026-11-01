import Fastify from 'fastify';
import cors from '@fastify/cors';
import { registerProjectRoutes } from './project-routes.js';
import type { ProjectStore } from './project-store.js';
import type { Pool } from 'pg';
import { registerAiRoutes } from './ai/routes.js';
import type { AiConfig } from './ai/model.js';
import type { AiGenerationStore } from './ai/store.js';
import { registerKnowledgeRoutes } from './rag/routes.js';
import type { EmbeddingConfig } from './rag/embeddings.js';
import { registerAgentRoutes } from './agent/routes.js';
import { registerPracticeRoutes } from './practice/routes.js';
import { registerDocumentRoutes } from './documents/routes.js';
import { PgDocumentStore } from './documents/store.js';
import { registerGrowthRoutes } from './growth/routes.js';
import { registerTraceRoutes } from './trace/routes.js';
import { registerSegmentRoutes } from './trace/segment-routes.js';
import { databaseReadiness, migrationFiles } from './database-readiness.js';

export interface DatabaseCheck {
  query: (sql: string) => Promise<unknown>;
  end: () => Promise<void>;
}

export async function createApp(options: { database?: DatabaseCheck; pool?: Pool; projectStore?: ProjectStore; aiConfig?: AiConfig; aiGenerationStore?: AiGenerationStore; embeddingConfig?: EmbeddingConfig; corsOrigin: string; logger?: boolean }) {
  const versions = (await migrationFiles()).map(file => file.slice(0, -4));
  const app = Fastify({ logger: options.logger ?? false });
  app.setErrorHandler((error, _request, reply) => {
    const candidate = typeof error === 'object' && error !== null && 'statusCode' in error ? error.statusCode : undefined;
    const status = typeof candidate === 'number' && candidate >= 400 && candidate < 500 ? candidate : 500;
    if (status === 500) app.log.error('Request failed');
    return reply.code(status).send({ error: status === 500 ? 'internal_error' : 'invalid_request' });
  });
  await app.register(cors, { origin: options.corsOrigin });
  await registerProjectRoutes(app, options.projectStore);
  await registerAiRoutes(app, options.projectStore, options.aiConfig, options.aiGenerationStore);
  await registerKnowledgeRoutes(app, options.projectStore, options.pool, options.embeddingConfig, options.aiConfig);
  await registerAgentRoutes(app, options.projectStore, options.pool, options.aiConfig, options.embeddingConfig);
  await registerPracticeRoutes(app, options.projectStore, options.pool, options.aiConfig,{embedding:options.embeddingConfig});
  await registerDocumentRoutes(app, options.projectStore, options.pool ? new PgDocumentStore(options.pool) : undefined, options.aiConfig);
  await registerGrowthRoutes(app, options.projectStore, options.pool);
  await registerTraceRoutes(app, options.projectStore, options.pool);
  await registerSegmentRoutes(app, options.projectStore, options.pool);
  app.get('/health', async () => ({ status: 'ok', service: 'gongxu-api' }));
  app.get('/ready', async (_request, reply) => {
    if (!options.database) {
      return reply.code(503).send({ status: 'not_ready', database: 'not_configured' });
    }
    try {
      const result = await databaseReadiness(options.database, versions);
      return reply.code(result.status === 'ready' ? 200 : 503).send(result);
    } catch {
      app.log.error('Database readiness check failed');
      return reply.code(503).send({ status: 'not_ready', database: 'unavailable' });
    }
  });
  app.addHook('onClose', async () => { await options.database?.end(); });
  return app;
}
