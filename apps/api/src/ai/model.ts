export type AiConfig = { baseUrl: string; apiKey: string; model: string; timeoutMs: number };
export type AiMessage = { role: 'system' | 'user' | 'assistant'; content: string };
export class AiError extends Error {
  constructor(public readonly code: 'ai_not_configured' | 'ai_timeout' | 'ai_provider_error') { super(code); }
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
  const timeoutMs = env.AI_TIMEOUT_MS === undefined ? 30_000 : Number(env.AI_TIMEOUT_MS);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120_000) throw new Error('AI_TIMEOUT_MS must be an integer between 1000 and 120000');
  return { baseUrl: url.toString().replace(/\/$/, ''), apiKey, model, timeoutMs };
}

export async function completeChat(config: AiConfig | undefined, messages: AiMessage[], fetcher: typeof fetch = fetch): Promise<string> {
  if (!config) throw new AiError('ai_not_configured');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetcher(`${config.baseUrl}/chat/completions`, {
      method: 'POST', redirect: 'error', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({ model: config.model, messages, temperature: 0.3 }),
    });
    if (!response.ok || !response.body) throw new AiError('ai_provider_error');
    // Limit the provider response to avoid accepting unbounded bodies.
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > 512_000) { await reader.cancel(); throw new AiError('ai_provider_error'); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const data: unknown = JSON.parse(new TextDecoder().decode(bytes));
    const content = (data as { choices?: { message?: { content?: unknown } }[] })?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim() || content.length > 45_000) throw new AiError('ai_provider_error');
    return content.trim();
  } catch (error) {
    if (controller.signal.aborted) throw new AiError('ai_timeout');
    if (error instanceof AiError) throw error;
    throw new AiError('ai_provider_error');
  } finally { clearTimeout(timer); }
}
