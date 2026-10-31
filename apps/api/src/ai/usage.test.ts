import {test} from 'node:test';
import assert from 'node:assert/strict';
import {completeChat,completeChatWithMetadata,providerUsage} from './model.js';
test('provider usage keeps supplied numbers and never fabricates missing tokens or cost',()=>{
 const usage=providerUsage({prompt_tokens:11,completion_tokens:7,total_tokens:18,prompt_cache_hit_tokens:5,prompt_cache_miss_tokens:6,completion_tokens_details:{reasoning_tokens:3},credential:'must-not-copy'});
 assert.deepEqual(usage,{inputTokens:11,outputTokens:7,totalTokens:18,cacheHitTokens:5,cacheMissTokens:6,reasoningTokens:3});
 assert.equal(providerUsage({prompt_tokens:11,completion_tokens:7}).totalTokens,null);
 assert.ok(Object.values(providerUsage({prompt_tokens:-2,completion_tokens:'7',total_tokens:Infinity,prompt_cache_hit_tokens:0.5})).every(value=>value===null));
});
test('detailed completion exposes safe metadata while existing string callers keep their contract',async()=>{
 const config={baseUrl:'https://fixture.invalid',apiKey:'test-only',model:'fixture',timeoutMs:1000};
 const fake:typeof fetch=async()=>new Response(JSON.stringify({id:'not-retained',choices:[{finish_reason:'stop',message:{content:'合成回答'}}],usage:{prompt_tokens:12,completion_tokens:8,total_tokens:20},unknown:'not-retained'}));
 const detailed=await completeChatWithMetadata(config,[],fake);assert.equal(detailed.content,'合成回答');assert.equal(detailed.usage.totalTokens,20);assert.equal(detailed.finishReason,'stop');assert.ok(detailed.durationMs>=0);assert.deepEqual(Object.keys(detailed).sort(),['content','durationMs','finishReason','usage']);
 assert.equal(await completeChat(config,[],fake),'合成回答');
});
