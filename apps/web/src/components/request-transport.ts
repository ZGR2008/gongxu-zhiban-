const failure = (code: string, message: string) => Object.assign(new Error(message), { code });

export function invalidResponse() {
  return failure('invalid_response', '服务响应格式无效，请重新读取；当前操作未被认定为成功。');
}

// Bound ordinary reads through body consumption as well as response headers.
// Mutations and model generation keep their existing cancellation/deadline rules.
// This layer never retries a request and never includes raw response content in errors.
export async function fetchJsonResponse(url: string, options: RequestInit = {}, readTimeoutMs = 15000) {
  const read = (options.method ?? 'GET').toUpperCase() === 'GET';
  const deadline = new AbortController();
  const timer = read ? setTimeout(() => deadline.abort(), readTimeoutMs) : undefined;
  const signal = read
    ? options.signal ? AbortSignal.any([options.signal, deadline.signal]) : deadline.signal
    : options.signal;
  try {
    let response: Response;
    try { response = await fetch(url, { ...options, signal }); }
    catch (error) {
      if (signal?.aborted) throw error;
      throw failure('connection_unavailable', '无法连接服务，请检查后端是否启动。');
    }
    let data: unknown;
    try { data = await response.json(); }
    catch (error) {
      if (signal?.aborted) throw error;
      if (response.ok) throw invalidResponse();
      data = {};
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      if (response.ok) throw invalidResponse();
      data = {};
    }
    return { response, data };
  } catch (error) {
    // Caller cancellation remains distinguishable from our read deadline.
    if (options.signal?.aborted) throw options.signal.reason ?? error;
    if (deadline.signal.aborted) throw failure('request_timeout', '读取超时，已停止等待，请重新读取。');
    throw error;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
