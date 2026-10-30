export interface EmbeddingConfig { baseUrl: string; apiKey: string; model: string; timeoutMs?: number }

export class EmbeddingError extends Error {
  constructor(message: string) { super(message); this.name = 'EmbeddingError'; }
}

/** Calls the deployment-configured embeddings endpoint; never accepts an endpoint from a user request. */
export async function createEmbeddings(input: string[], config: EmbeddingConfig, send: typeof fetch = fetch): Promise<number[][]> {
  if (!config.baseUrl || !config.model) throw new EmbeddingError('Embedding service is not configured');
  let endpoint: URL;
  try { endpoint = new URL(config.baseUrl); } catch { throw new EmbeddingError('Invalid embedding service URL'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname);
  if (!config.apiKey && !local) throw new EmbeddingError('Embedding service is not configured');
  if (input.length === 0 || input.length > 32 || input.some((item) => !item.trim() || item.length > 12000)) {
    throw new EmbeddingError('Invalid embedding input');
  }
  let response: Response;
  try {
    response = await send(`${config.baseUrl.replace(/\/$/, '')}/embeddings`, {
      method: 'POST', headers: { ...(config.apiKey ? { 'Authorization': `Bearer ${config.apiKey}` } : {}), 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: config.model, input }), redirect: 'error', signal: AbortSignal.timeout(config.timeoutMs ?? 30000),
    });
  } catch { throw new EmbeddingError('Embedding service request failed'); }
  if (!response.ok) throw new EmbeddingError(`Embedding service returned HTTP ${response.status}`);
  let payload: unknown;
  try {
    if (!response.body) throw new Error('Missing body');
    const reader = response.body.getReader();
    const parts: Uint8Array[] = []; let length = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 4_000_000) { await reader.cancel(); throw new Error('Response too large'); }
      parts.push(value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
    payload = JSON.parse(new TextDecoder().decode(bytes));
  } catch { throw new EmbeddingError('Invalid embedding response'); }
  const data = (payload as { data?: unknown })?.data;
  if (!Array.isArray(data) || data.length !== input.length) throw new EmbeddingError('Invalid embedding response');
  const result: number[][] = new Array(input.length);
  for (const item of data) {
    const { index, embedding } = item ?? {};
    if (!Number.isInteger(index) || index < 0 || index >= input.length || result[index] || !Array.isArray(embedding) ||
      embedding.length < 1 || embedding.length > 4096 || embedding.some((n: unknown) => typeof n !== 'number' || !Number.isFinite(n)) ||
      !embedding.some((n: number) => n !== 0)) throw new EmbeddingError('Invalid embedding response');
    result[index] = embedding;
  }
  if (result.some((v) => v.length !== result[0].length)) throw new EmbeddingError('Inconsistent embedding dimensions');
  return result;
}
