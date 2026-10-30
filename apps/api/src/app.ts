import Fastify from 'fastify';
import cors from '@fastify/cors';

export interface DatabaseCheck {
  query: (sql: string) => Promise<unknown>;
  end: () => Promise<void>;
}

export async function createApp(options: { database?: DatabaseCheck; corsOrigin: string; logger?: boolean }) {
  const app = Fastify({ logger: options.logger ?? false });
  await app.register(cors, { origin: options.corsOrigin });
  app.get('/health', async () => ({ status: 'ok', service: 'gongxu-api' }));
  app.get('/ready', async (_request, reply) => {
    if (!options.database) {
      return reply.code(503).send({ status: 'not_ready', database: 'not_configured' });
    }
    try {
      await options.database.query('SELECT 1');
      return { status: 'ready', database: 'connected' };
    } catch {
      app.log.error('Database readiness check failed');
      return reply.code(503).send({ status: 'not_ready', database: 'unavailable' });
    }
  });
  app.addHook('onClose', async () => { await options.database?.end(); });
  return app;
}
