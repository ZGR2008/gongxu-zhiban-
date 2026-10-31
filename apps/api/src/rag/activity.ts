import { randomUUID } from 'node:crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { EmbeddingError, type EmbeddingOptions, type EmbeddingState } from './embeddings.js';
type Activity = EmbeddingState & { id:string;owner:string;kind:string;startedAt:string;updatedAt:string };
const records=new Map<string,Activity>();
export function listEmbeddingActivities(owner:string) {
  const cutoff=Date.now()-5*60_000;
  for(const [id,record] of records)if(Date.parse(record.updatedAt)<cutoff)records.delete(id);
  return [...records.values()].filter(row=>row.owner===owner).slice(-12).reverse().map(({owner:_owner,...row})=>row);
}
/** Only status metadata is recorded; no source text, provider URL or credentials. */
export function openEmbeddingActivity(owner:string,kind:'index'|'search'|'answer'|'agent'|'review',request:FastifyRequest,reply:FastifyReply) {
  listEmbeddingActivities(owner);
  const id=randomUUID(),startedAt=new Date().toISOString();
  const record:Activity={id,owner,kind,state:'running',startedAt,updatedAt:startedAt};
  if(records.size>=512){const oldest=[...records.values()].find(row=>['succeeded','failed','cancelled'].includes(row.state));if(oldest)records.delete(oldest.id);}
  records.set(id,record);
  const controller=new AbortController();
  const disconnect=()=>{if(!reply.raw.writableEnded)controller.abort();};
  request.raw.once('aborted',disconnect);reply.raw.once('close',disconnect);
  const timeout=setTimeout(()=>controller.abort(new DOMException('Operation timeout','TimeoutError')),120000);
  let finished=false;
  const options:EmbeddingOptions={signal:controller.signal,onState:state=>{
    // A completed batch is not a completed index or successful SQL transaction.
    Object.assign(record,{...state,state:state.state==='succeeded'?'running':state.state,updatedAt:new Date().toISOString()});
  }};
  return {options,finish(error?:unknown){
    if(finished)return;finished=true;
    clearTimeout(timeout);request.raw.off('aborted',disconnect);reply.raw.off('close',disconnect);
    const timedOut=controller.signal.aborted&&controller.signal.reason?.name==='TimeoutError';
    const code=timedOut?'embedding_timeout':error instanceof EmbeddingError?error.code:error?'operation_failed':undefined;
    Object.assign(record,{state:timedOut?'failed':controller.signal.aborted?'cancelled':error?'failed':'succeeded',code,updatedAt:new Date().toISOString()});
  }};
}
