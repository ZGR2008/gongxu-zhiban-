/** Bounds work even when a third-party adapter ignores cancellation. Callers must
 * still pass the signal into I/O; this cannot reverse an already billed request. */
export function withAbort<T>(signal:AbortSignal,work:()=>Promise<T>):Promise<T>{
  return new Promise((resolve,reject)=>{
    const cancelled=()=>{cleanup();reject(signal.reason??new Error('operation_cancelled'));};
    const cleanup=()=>signal.removeEventListener('abort',cancelled);
    if(signal.aborted){cancelled();return;}
    signal.addEventListener('abort',cancelled,{once:true});
    Promise.resolve().then(()=>{signal.throwIfAborted();return work();}).then(value=>{cleanup();resolve(value);},error=>{cleanup();reject(error);});
  });
}
