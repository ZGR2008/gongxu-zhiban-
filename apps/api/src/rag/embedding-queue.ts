export type EmbeddingState = { state: 'queued'|'running'|'retrying'|'succeeded'|'failed'|'cancelled'; attempt?: number; position?: number; code?: string };
export type EmbeddingOptions = { signal?: AbortSignal; onState?: (state: EmbeddingState) => void; queueTimeoutMs?: number };
export class EmbeddingError extends Error {
  constructor(message: string, public code = 'embedding_provider_error') { super(message); this.name = 'EmbeddingError'; }
}
export function notify(options: EmbeddingOptions, state: EmbeddingState) { try { options.onState?.(state); } catch { /* Observers must not break inference or leak a slot. */ } }
export function aborted(signal: AbortSignal) {
  return new EmbeddingError('Embedding request stopped', signal.reason?.name === 'TimeoutError' ? 'embedding_timeout' : 'embedding_cancelled');
}
export function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) { void promise.catch(()=>{}); return Promise.reject(aborted(signal)); }
  return new Promise((resolve,reject) => {
    const stop = () => { cleanup(); reject(aborted(signal)); };
    const cleanup = () => signal.removeEventListener('abort',stop);
    signal.addEventListener('abort',stop,{once:true});
    promise.then(value=>{cleanup();resolve(value);},error=>{cleanup();reject(error);});
  });
}
type Waiting = { start: () => void; reject: (error: EmbeddingError) => void };
/** One in-flight call per endpoint; eight waiting calls, with independent cancellation. */
export class EmbeddingQueue {
  private active = false;
  private waiting: Waiting[] = [];
  constructor(private capacity = 8) {}
  acquire(signal: AbortSignal, options: EmbeddingOptions = {}): Promise<() => void> {
    if (signal.aborted) return Promise.reject(aborted(signal));
    if (!this.active) { this.active=true; return Promise.resolve(this.release()); }
    if (this.waiting.length >= this.capacity) return Promise.reject(new EmbeddingError('Embedding queue is full','embedding_queue_full'));
    return new Promise((resolve,reject) => {
      const cleanup = () => { clearTimeout(timer);signal.removeEventListener('abort',cancel); };
      const remove = () => { const index=this.waiting.indexOf(entry);if(index>=0)this.waiting.splice(index,1); };
      const fail = (error:EmbeddingError) => { cleanup();remove();reject(error); };
      const cancel = () => fail(aborted(signal));
      const entry: Waiting = { start:()=>{cleanup();resolve(this.release());}, reject:fail };
      const timer=setTimeout(()=>fail(new EmbeddingError('Embedding queue wait expired','embedding_queue_timeout')),options.queueTimeoutMs??15000);
      this.waiting.push(entry);signal.addEventListener('abort',cancel,{once:true});
      notify(options,{state:'queued',position:this.waiting.length});
    });
  }
  private release() {
    let released=false;
    return () => {
      if(released)return;released=true;
      const next=this.waiting.shift();
      if(next)next.start();else this.active=false;
    };
  }
}
