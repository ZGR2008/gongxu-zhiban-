import { EmbeddingQueue, EmbeddingError, abortable, aborted, notify, type EmbeddingOptions } from './embedding-queue.js';
export { EmbeddingError } from './embedding-queue.js';
export type { EmbeddingOptions, EmbeddingState } from './embedding-queue.js';
export interface EmbeddingConfig { baseUrl: string; apiKey: string; model: string; timeoutMs?: number }
const queues = new Map<string, EmbeddingQueue>();

/** Calls the deployment-configured embeddings endpoint; never accepts an endpoint from a user request. */
export async function createEmbeddings(input: string[], config: EmbeddingConfig, send: typeof fetch = fetch, options: EmbeddingOptions = {}): Promise<number[][]> {
  if (!config.baseUrl || !config.model) throw new EmbeddingError('Embedding service is not configured');
  let endpoint: URL;
  try { endpoint = new URL(config.baseUrl); } catch { throw new EmbeddingError('Invalid embedding service URL'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname);
  if (!config.apiKey && !local) throw new EmbeddingError('Embedding service is not configured');
  if (input.length === 0 || input.length > 32 || input.some((item) => !item.trim() || item.length > 12000)) {
    throw new EmbeddingError('Invalid embedding input');
  }
  if (!['http:','https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.hash || endpoint.search) throw new EmbeddingError('Invalid embedding service URL');
  const key = endpoint.origin; // Same local inference capacity even through different model/path aliases.
  let queue=queues.get(key);if(!queue){queue=new EmbeddingQueue();queues.set(key,queue);}
  const deadline=AbortSignal.timeout(config.timeoutMs??45000);
  const signal=options.signal?AbortSignal.any([options.signal,deadline]):deadline;
  let release:(()=>void)|undefined;
  try {
    release=await queue.acquire(signal,options);
    let response:Response|undefined;
    for(let attempt=1;attempt<=3;attempt++){
      if(signal.aborted)throw aborted(signal);
      notify(options,{state:'running',attempt});
      try {
        response = await abortable(send(`${config.baseUrl.replace(/\/$/, '')}/embeddings`, {
      method: 'POST', headers: { ...(config.apiKey ? { 'Authorization': `Bearer ${config.apiKey}` } : {}), 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: config.model, input }), redirect: 'error', signal,
        }).then(response=>{if(signal.aborted){void response.body?.cancel().catch(()=>{});throw aborted(signal);}return response;}),signal);
      }catch(error){
        if(signal.aborted)throw aborted(signal);
        if(!(error instanceof TypeError)||attempt===3)throw new EmbeddingError('Embedding service request failed','embedding_unavailable');
        notify(options,{state:'retrying',attempt,code:'embedding_unavailable'});
        await abortable(new Promise(resolve=>setTimeout(resolve,150*2**(attempt-1))),signal);continue;
      }
      if(!response)throw new EmbeddingError('Embedding service returned no response');
      if(response.ok)break;
      const retryable=[429,502,503,504].includes(response.status);
      const code=response.status===429?'embedding_busy':'embedding_unavailable';
      const retryAfter=Number(response.headers.get('Retry-After'));
      await response.body?.cancel();
      if(!retryable||attempt===3)throw new EmbeddingError('Embedding service rejected the request',retryable?code:'embedding_provider_error');
      notify(options,{state:'retrying',attempt,code});
      const wait=Number.isFinite(retryAfter)&&retryAfter>0?Math.min(retryAfter*1000,2000):150*2**(attempt-1);
      await abortable(new Promise(resolve=>setTimeout(resolve,wait)),signal);
    }
    if(!response?.ok)throw new EmbeddingError('Embedding service is unavailable','embedding_unavailable');
    const result=await parseEmbeddings(response,input.length,signal);
    notify(options,{state:'succeeded'});return result;
  } catch(error){
    const failure=error instanceof EmbeddingError?error:new EmbeddingError('Embedding service request failed');
    notify(options,{state:failure.code==='embedding_cancelled'?'cancelled':'failed',code:failure.code});throw failure;
  } finally { release?.(); }
}
async function parseEmbeddings(response:Response,count:number,signal:AbortSignal):Promise<number[][]>{
  let payload: unknown;
  try {
    if (!response.body) throw new Error('Missing body');
    const reader = response.body.getReader();
    const parts: Uint8Array[] = []; let length = 0;
    while (true) {
      const { done, value } = await abortable(reader.read(),signal).catch(error=>{void reader.cancel().catch(()=>{});throw error;});
      if (done) break;
      length += value.byteLength;
      if (length > 4_000_000) { await reader.cancel(); throw new Error('Response too large'); }
      parts.push(value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
    payload = JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) { if(error instanceof EmbeddingError)throw error;throw new EmbeddingError('Invalid embedding response'); }
  const data = (payload as { data?: unknown })?.data;
  if (!Array.isArray(data) || data.length !== count) throw new EmbeddingError('Invalid embedding response');
  const result: number[][] = new Array(count);
  for (const item of data) {
    const { index, embedding } = item ?? {};
    if (!Number.isInteger(index) || index < 0 || index >= count || result[index] || !Array.isArray(embedding) ||
      embedding.length < 1 || embedding.length > 4096 || embedding.some((n: unknown) => typeof n !== 'number' || !Number.isFinite(n)) ||
      !embedding.some((n: number) => n !== 0)) throw new EmbeddingError('Invalid embedding response');
    result[index] = embedding;
  }
  if (result.some((v) => v.length !== result[0].length)) throw new EmbeddingError('Inconsistent embedding dimensions');
  return result;
}
