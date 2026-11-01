import {withAbort} from './abortable.js';
export type AiConfig = { baseUrl: string; apiKey: string; model: string; timeoutMs: number; maxOutputTokens?: number; reasoningEffort?: 'none' | 'low' | 'high' | 'max' };
export type CompletionOptions={signal?:AbortSignal;captureIncomplete?:boolean};
export type ProviderUsage={inputTokens:number|null;outputTokens:number|null;totalTokens:number|null;cacheHitTokens:number|null;cacheMissTokens:number|null;reasoningTokens:number|null};
export type ChatCompletion={content:string;usage:ProviderUsage;finishReason:string|null;durationMs:number};
export type AiMessage = { role: 'system' | 'user' | 'assistant'; content: string };
export class AiError extends Error {
  constructor(public readonly code: 'ai_not_configured' | 'ai_timeout' | 'ai_cancelled' | 'ai_provider_error' | 'ai_auth_error' | 'ai_insufficient_balance' | 'ai_rate_limited' | 'ai_output_truncated') { super(code); }
}

// Provider credentials are a server-side problem, never an application login failure.
export function aiErrorStatus(code: AiError['code']): number {
  if (code === 'ai_not_configured') return 503;
  if (code === 'ai_timeout') return 504;
  if (code === 'ai_cancelled') return 409;
  if (code === 'ai_rate_limited') return 429;
  return 502;
}

// Configuration is controlled by the server operator, never by a browser request.
export function loadAiConfig(env: NodeJS.ProcessEnv = process.env): AiConfig | undefined {
  const baseUrl = env.AI_BASE_URL?.trim();
  const apiKey = env.AI_API_KEY?.trim();
  const model = env.AI_MODEL?.trim();
  if (!baseUrl && !apiKey && !model) return undefined;
  if (!baseUrl || !apiKey || !model) throw new Error('AI_BASE_URL, AI_API_KEY and AI_MODEL must be configured together');
  let url: URL;
  try { url = new URL(baseUrl); } catch { throw new Error('AI_BASE_URL must be a valid URL'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('AI_BASE_URL must be an HTTP(S) base URL without credentials, query or fragment');
  const timeoutMs = env.AI_TIMEOUT_MS === undefined ? 60_000 : Number(env.AI_TIMEOUT_MS);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120_000) throw new Error('AI_TIMEOUT_MS must be an integer between 1000 and 120000');
  const maxOutputTokens = env.AI_MAX_OUTPUT_TOKENS === undefined ? 4096 : Number(env.AI_MAX_OUTPUT_TOKENS);
  if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 256 || maxOutputTokens > 16384) throw new Error('AI_MAX_OUTPUT_TOKENS must be an integer between 256 and 16384');
  const effort = env.AI_REASONING_EFFORT?.trim() || undefined;
  if (effort && !['none', 'low', 'high', 'max'].includes(effort)) throw new Error('AI_REASONING_EFFORT is invalid');
  return { baseUrl: url.toString().replace(/\/$/, ''), apiKey, model, timeoutMs, maxOutputTokens, reasoningEffort: effort as AiConfig['reasoningEffort'] };
}

export async function completeChat(config: AiConfig | undefined, messages: AiMessage[], fetcher: typeof fetch = fetch, options:CompletionOptions={}): Promise<string> {
  return (await completeChatWithMetadata(config,messages,fetcher,options)).content;
}

/** Whitelisted numeric fields only. Missing values stay null; no cost/token estimation. */
export function providerUsage(value:unknown):ProviderUsage{
  const source=value&&typeof value==='object'?value as Record<string,unknown>:{};
  const count=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:null;
  const details=source.completion_tokens_details&&typeof source.completion_tokens_details==='object'?source.completion_tokens_details as Record<string,unknown>:{};
  return {inputTokens:count(source.prompt_tokens),outputTokens:count(source.completion_tokens),totalTokens:count(source.total_tokens),cacheHitTokens:count(source.prompt_cache_hit_tokens),cacheMissTokens:count(source.prompt_cache_miss_tokens),reasoningTokens:count(details.reasoning_tokens)};
}

export async function completeChatWithMetadata(config: AiConfig | undefined, messages: AiMessage[], fetcher: typeof fetch = fetch, options:CompletionOptions={}): Promise<ChatCompletion> {
  if (!config) throw new AiError('ai_not_configured');
  const started=performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  const signal=options.signal?AbortSignal.any([controller.signal,options.signal]):controller.signal;
  let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
  try {
    const response = await withAbort(signal,()=>fetcher(`${config.baseUrl}/chat/completions`, {
      method: 'POST', redirect: 'error', signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({ model: config.model, messages, temperature: 0.3, max_tokens: config.maxOutputTokens ?? 4096,
        ...(config.reasoningEffort ? { reasoning_effort: config.reasoningEffort } : {}) }),
    }));
    if (!response.ok) {
      // Do not read or expose provider error bodies; they can contain sensitive data.
      void response.body?.cancel().catch(()=>{});
      if (response.status === 401 || response.status === 403) throw new AiError('ai_auth_error');
      if (response.status === 402) throw new AiError('ai_insufficient_balance');
      if (response.status === 429) throw new AiError('ai_rate_limited');
      throw new AiError('ai_provider_error');
    }
    if (!response.body) throw new AiError('ai_provider_error');
    // Limit the provider response to avoid accepting unbounded bodies.
    reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await withAbort(signal,()=>reader!.read());
      if (done) break;
      total += value.byteLength;
      if (total > 512_000) throw new AiError('ai_provider_error');
      chunks.push(value);
    }
    const bytes = new Uint8Array(total); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const data: unknown = JSON.parse(new TextDecoder().decode(bytes));
    const choice = (data as { choices?: { finish_reason?: string; message?: { content?: unknown } }[] })?.choices?.[0];
    if (choice?.finish_reason === 'length' && !options.captureIncomplete) throw new AiError('ai_output_truncated');
    const content = choice?.message?.content;
    if (typeof content !== 'string' || !content.trim() || content.length > 45_000) throw new AiError('ai_provider_error');
    const rawReason=choice?.finish_reason;
    const finishReason=typeof rawReason==='string'&&['stop','length','content_filter','tool_calls','function_call'].includes(rawReason)?rawReason:null;
    return {content:content.trim(),usage:providerUsage((data as {usage?:unknown})?.usage),finishReason,durationMs:Math.max(0,Math.round(performance.now()-started))};
  } catch (error) {
    if(options.signal?.aborted)throw new AiError('ai_cancelled');
    if (controller.signal.aborted) throw new AiError('ai_timeout');
    if (error instanceof AiError) throw error;
    throw new AiError('ai_provider_error');
  } finally { clearTimeout(timer);void reader?.cancel().catch(()=>{}); }
}
