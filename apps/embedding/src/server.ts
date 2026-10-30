import 'dotenv/config';
import { createEmbeddingApp } from './app.js';
import { createLocalEngine, manifest, type EmbeddingEngine } from './model.js';

const port = Number(process.env.LOCAL_EMBEDDING_PORT ?? 3010);
const threads = Number(process.env.LOCAL_EMBEDDING_THREADS ?? 2);
if (!Number.isInteger(port) || port < 1024 || port > 65535 || !Number.isInteger(threads) || threads < 1 || threads > 8) {
  console.error(JSON.stringify({ error: 'invalid_local_embedding_configuration' })); process.exit(1);
}
let engine: EmbeddingEngine | undefined;
let failed = false;
const app = createEmbeddingApp(() => engine, () => failed);
try {
  // Never expose the unauthenticated local model to the LAN or public internet.
  await app.listen({ host: '127.0.0.1', port });
  console.log(JSON.stringify({ status: 'loading', port, model: manifest.id }));
  engine = await createLocalEngine(threads);
  console.log(JSON.stringify({ status: 'ready', model: manifest.id, dimensions: manifest.dimensions }));
} catch {
  failed = true;
  console.error(JSON.stringify({ error: 'local_embedding_start_failed', action: 'check_port_and_run_model_download' }));
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void app.close().then(() => process.exit(0)); });
