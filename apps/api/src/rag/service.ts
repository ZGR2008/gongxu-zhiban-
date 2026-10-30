import type { Pool } from 'pg';
import { chunkPages, type TextPage } from './chunk.js';
import { createEmbeddings, type EmbeddingConfig, EmbeddingError } from './embeddings.js';
import { searchKnowledge } from './search.js';

export function loadEmbeddingConfig(env: NodeJS.ProcessEnv = process.env): EmbeddingConfig | undefined {
  const baseUrl = env.EMBEDDING_BASE_URL?.trim(), apiKey = env.EMBEDDING_API_KEY?.trim(), model = env.EMBEDDING_MODEL?.trim();
  if (!baseUrl && !apiKey && !model) return undefined;
  if (!baseUrl || !model) throw new Error('EMBEDDING_BASE_URL and EMBEDDING_MODEL must be configured together');
  let url: URL;
  try { url = new URL(baseUrl); } catch { throw new Error('Invalid embedding service URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Invalid embedding service URL');
  if (url.hostname === 'api.deepseek.com') throw new Error('DeepSeek chat is not an embedding service; configure an independent provider');
  if (!apiKey && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('EMBEDDING_API_KEY is required for non-local embedding services');
  return { baseUrl: url.toString().replace(/\/$/, ''), apiKey: apiKey ?? '', model };
}

/** An optional embedding misconfiguration must not prevent the chat API from starting. */
export function resolveEmbeddingConfig(env: NodeJS.ProcessEnv = process.env) {
  try { return { config: loadEmbeddingConfig(env), invalid: false }; }
  catch { return { config: undefined, invalid: true }; }
}

// The provider address is included in the identity to avoid mixing vectors from unrelated services.
function modelId(config: EmbeddingConfig) { return `${config.baseUrl}|${config.model}`; }

/** Save actual text chunks without requiring an embedding provider. */
export async function saveText(pool: Pool, ownerId: string, name: string, text: string) {
  return savePages(pool, ownerId, name, 'text/plain', [{ page: null, text }]);
}

export async function savePages(pool: Pool, ownerId: string, name: string, mediaType: string, pages: TextPage[]) {
  const chunks = chunkPages(pages);
  if (!chunks.length || chunks.length > 250) throw new Error('invalid_document');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const doc = await client.query(`INSERT INTO knowledge_documents(owner_id,name,media_type,status) VALUES ($1,$2,$3,'awaiting_embedding') RETURNING id`, [ownerId, name, mediaType]);
    const id: string = doc.rows[0].id;
    for (let index = 0; index < chunks.length; index++) {
      await client.query(`INSERT INTO knowledge_chunks(document_id,position,page,content) VALUES ($1,$2,$3,$4)`, [id, index, chunks[index].page, chunks[index].content]);
    }
    await client.query('COMMIT');
    return { id, chunks: chunks.length, status: 'awaiting_embedding' };
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}

/** Build vectors for saved chunks; failed calls leave the text intact. */
export async function indexDocument(pool: Pool, ownerId: string, id: string, config: EmbeddingConfig) {
  const doc = await pool.query(`SELECT id FROM knowledge_documents WHERE id=$1 AND owner_id=$2`, [id, ownerId]);
  if (!doc.rowCount) return null;
  const result = await pool.query(`SELECT id,content FROM knowledge_chunks WHERE document_id=$1 ORDER BY position`, [id]);
  if (!result.rows.length || result.rows.length > 250) throw new Error('invalid_document');
  const vectors: number[][] = [];
  for (let offset = 0; offset < result.rows.length; offset += 32) {
    vectors.push(...await createEmbeddings(result.rows.slice(offset, offset + 32).map((row) => row.content as string), config));
  }
  if (vectors.some((vector) => vector.length !== vectors[0].length)) throw new EmbeddingError('Inconsistent embedding dimensions');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const owned = await client.query('SELECT id FROM knowledge_documents WHERE id=$1 AND owner_id=$2 FOR UPDATE', [id, ownerId]);
    if (!owned.rowCount) { await client.query('ROLLBACK'); return null; }
    for (let index = 0; index < result.rows.length; index++) {
      await client.query(`UPDATE knowledge_chunks SET embedding_model=$3,embedding=$4::vector WHERE id=$1 AND document_id=$2`,
        [result.rows[index].id, id, modelId(config), `[${vectors[index].join(',')}]`]);
    }
    await client.query(`UPDATE knowledge_documents SET status='ready' WHERE id=$1 AND owner_id=$2`, [id, ownerId]);
    await client.query('COMMIT');
    return { id, chunks: result.rows.length, status: 'ready' };
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}

export async function retrieveKnowledge(pool: Pool, ownerId: string, question: string, config: EmbeddingConfig) {
  const [vector] = await createEmbeddings([question], config);
  return searchKnowledge({ query: async (sql, values) => pool.query(sql, values) }, ownerId, modelId(config), vector);
}

export { EmbeddingError };
