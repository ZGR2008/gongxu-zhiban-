import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEmbeddings, EmbeddingError } from './embeddings.js';
import { EmbeddingQueue } from './embedding-queue.js';
const result=()=>new Response(JSON.stringify({data:[{index:0,embedding:[1,2]}]}));
const config=(name:string)=>({baseUrl:`http://127.0.0.1:3010/${name}`,apiKey:'',model:'REVIEW_PLACEHOLDER_575a8dfc08a84f40bc3b-test'});
test('concurrent index and search requests share the single provider slot',async()=>{
 let active=0,peak=0;
 const send:typeof fetch=async()=>{active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,15));active--;return result();};
 await Promise.all([createEmbeddings(['index'],config('capacity'),send),createEmbeddings(['search'],config('capacity'),send),createEmbeddings(['agent'],config('capacity'),send)]);
 assert.equal(peak,1);
});
test('429 and 503 retry a bounded number of times before recovering',async()=>{
 let calls=0;
 const send:typeof fetch=async()=>++calls<3?new Response('',{status:calls===1?429:503,headers:{'Retry-After':'0'}}):result();
 assert.deepEqual(await createEmbeddings(['query'],config('retry'),send),[[1,2]]);assert.equal(calls,3);
});
test('authentication failures are not retried and never forward provider response text',async()=>{
 let calls=0;
 await assert.rejects(createEmbeddings(['query'],config('auth'),async()=>{calls++;return new Response('private upstream body',{status:401});}),error=>error instanceof Error&&!error.message.includes('private upstream'));
 assert.equal(calls,1);
});
test('queue rejects overflow and removes cancelled waiting requests without blocking recovery',async()=>{
 const queue=new EmbeddingQueue(1), first=await queue.acquire(new AbortController().signal);
 const cancelled=new AbortController();const waiting=queue.acquire(cancelled.signal);
 const rejection=assert.rejects(waiting,(error:unknown)=>error instanceof EmbeddingError&&error.code==='embedding_cancelled');
 await assert.rejects(queue.acquire(new AbortController().signal), (error:unknown)=>error instanceof EmbeddingError&&error.code==='embedding_queue_full');
 cancelled.abort();await rejection;first();
 const recovered=await queue.acquire(new AbortController().signal);recovered();
});
test('a queued timeout is bounded and does not consume the next slot',async()=>{
 const queue=new EmbeddingQueue(1), first=await queue.acquire(new AbortController().signal);
 await assert.rejects(queue.acquire(new AbortController().signal,{queueTimeoutMs:5}), (error:unknown)=>error instanceof EmbeddingError&&error.code==='embedding_queue_timeout');
 first();(await queue.acquire(new AbortController().signal))();
});
test('temporary outage stops after three calls and next request can recover',async()=>{
 let calls=0;const send:typeof fetch=async()=>{calls++;return new Response('',{status:503});};
 await assert.rejects(createEmbeddings(['query'],config('outage'),send),error=>error instanceof EmbeddingError&&error.code==='embedding_unavailable');
 assert.equal(calls,3);assert.deepEqual(await createEmbeddings(['query'],config('outage'),async()=>result()),[[1,2]]);
});
test('request timeout and explicit cancellation release capacity, including a hanging response body',async()=>{
 const slow:typeof fetch=async()=>{await new Promise(resolve=>setTimeout(resolve,40));return result();};
 await assert.rejects(createEmbeddings(['query'],{...config('timeout'),timeoutMs:5},slow),error=>error instanceof EmbeddingError&&error.code==='embedding_timeout');
 const controller=new AbortController();let cancelledBody=false;
 const hanging:typeof fetch=async()=>new Response(new ReadableStream({pull(){controller.abort();},cancel(){cancelledBody=true;}}));
 await assert.rejects(createEmbeddings(['query'],config('cancel'),hanging,{signal:controller.signal}),error=>error instanceof EmbeddingError&&error.code==='embedding_cancelled');
 assert.equal(cancelledBody,true);assert.deepEqual(await createEmbeddings(['query'],config('cancel'),async()=>result()),[[1,2]]);
});
test('malformed response and permanent input failures are never retried',async()=>{
 for(const status of [400,401,403,413,422,500]){
  let calls=0;await assert.rejects(createEmbeddings(['query'],config('permanent'),async()=>{calls++;return new Response('',{status});}));assert.equal(calls,1);
 }
 let calls=0;await assert.rejects(createEmbeddings(['query'],config('malformed'),async()=>{calls++;return new Response('{');}));assert.equal(calls,1);
});
