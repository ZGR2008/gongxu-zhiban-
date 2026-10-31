import Fastify from 'fastify';
import { z } from 'zod';
import { manifest, type EmbeddingEngine } from './model.js';

const inputSchema = z.object({
  model: z.literal(manifest.id),
  input: z.union([z.string().trim().min(1).max(12_000), z.array(z.string().trim().min(1).max(12_000)).min(1).max(32)]),
  encoding_format: z.literal('float').optional(),
}).strict();

export function createEmbeddingApp(getEngine: () => EmbeddingEngine | undefined, hasFailed: () => boolean = () => false) {
  // Do not record request text or authorization headers in this local inference service.
  const app = Fastify({ logger: false, bodyLimit: 200_000 });
  let busy = false;
  app.setErrorHandler((_error, _request, reply) => reply.code(400).send({ error: 'invalid_request' }));
  app.get('/health', async () => ({ status: 'ok', modelState: hasFailed() ? 'failed' : getEngine()?.state ?? 'loading' }));
  app.get('/ready', async (_request, reply) => {
    if (getEngine()?.state !== 'ready') return reply.code(503).send({ status: 'not_ready', error: hasFailed() ? 'model_load_failed' : 'model_loading' });
    return { status: 'ready', model: manifest.id, dimensions: manifest.dimensions };
  });
  app.post('/v1/embeddings', async (request, reply) => {
    const parsed = inputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input_or_model' });
    const input = typeof parsed.data.input === 'string' ? [parsed.data.input] : parsed.data.input;
    if (input.reduce((total, item) => total + item.length, 0) > 32_000) return reply.code(413).send({ error: 'batch_too_large' });
    const engine = getEngine();
    if (engine?.state !== 'ready') return reply.code(503).send({ error: hasFailed() ? 'model_load_failed' : 'model_loading' });
    if (busy) return reply.header('Retry-After','1').code(429).send({ error: 'embedding_busy' });
    busy = true;
    try {
      const vectors = await engine.embed(input);
      if (vectors.length !== input.length || vectors.some(vector => vector.length !== manifest.dimensions || vector.some(n => !Number.isFinite(n)))) throw new Error('invalid_model_output');
      return { object: 'list', model: manifest.id, data: vectors.map((embedding, index) => ({ object: 'embedding', index, embedding })) };
    } catch { return reply.code(500).send({ error: 'embedding_inference_failed' }); }
    finally { busy = false; }
  });
  return app;
}
