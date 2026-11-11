import {test} from 'node:test';
import assert from 'node:assert/strict';
import {completeChat} from './model.js';
const config={baseUrl:'https://example.invalid',apiKey:'REVIEW_PLACEHOLDER_575a8dfc08a84f40bc3b-fixture',model:'fixture',timeoutMs:15};

test('a stalled response body cannot exceed the model deadline',async()=>{
 let stream:ReadableStreamDefaultController<Uint8Array>|undefined;
 const fetcher=(async()=>new Response(new ReadableStream<Uint8Array>({start(controller){stream=controller;}}))) as typeof fetch;
 const request=completeChat(config,[{role:'user',content:'合成超时测试'}],fetcher).catch(error=>error.code);
 const timeout=setTimeout(()=>{},200);
 try {const result=await Promise.race([request,new Promise(resolve=>setTimeout(()=>resolve('deadline_not_enforced'),80))]);assert.equal(result,'ai_timeout');}
 finally{clearTimeout(timeout);try{stream?.close();}catch{/* cancelled stream */}}
});

test('caller cancellation aborts a pending model transport without leaking adapter errors',async()=>{
 const controller=new AbortController();let calls=0;
 const fetcher=(async()=>{calls++;return new Promise<Response>(()=>{});}) as typeof fetch;
 const request=completeChat({...config,timeoutMs:1000},[{role:'user',content:'合成取消'}],fetcher,{signal:controller.signal});
 await new Promise(resolve=>setTimeout(resolve,5));controller.abort(new Error('private adapter detail'));
 await assert.rejects(request,error=>(error as {code:string}).code==='ai_cancelled'&&(error as Error).message==='ai_cancelled');assert.equal(calls,1);
 const already=new AbortController();already.abort();await assert.rejects(completeChat(config,[],fetcher,{signal:already.signal}),{code:'ai_cancelled'});assert.equal(calls,1);
});
