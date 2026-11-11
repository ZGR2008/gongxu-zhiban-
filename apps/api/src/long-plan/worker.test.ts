import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {defaultScheme,inspectScheme} from './domain.js';
import {fragmentMessages,failureDisposition} from './worker.js';
import {AiError,completeChatWithMetadata} from '../ai/model.js';
test('fragment request preserves whole original ranges including tail and cross-part conditions',()=>{
 const source='登记设备😀，由教师审批。\n末尾禁止申请人自批。',scheme=defaultScheme('p',source);
 scheme.conditions.forEach(c=>{c.kind='acceptance';c.crossNote='必须结合全文权限约束核对';});scheme.boundaries=[10,source.length];
 const segment=inspectScheme('p',source,scheme).segments.at(-1)!;
 const payload=JSON.parse(fragmentMessages(source,scheme,segment,[])[1].content);
 assert.equal(payload.segment.content,source.slice(segment.start,segment.end));
 assert.equal(payload.conditions.at(-1).original,'末尾禁止申请人自批。');
 assert.equal(payload.scope,'candidate_only');assert.equal(payload.offsetEncoding,'UTF-16');
});
test('uncertain provider outcomes are never eligible for automatic retry',()=>{
 for(const code of ['ai_timeout','ai_provider_error','ai_cancelled'] as const)assert.deepEqual(failureDisposition(new AiError(code)),{status:'uncertain',code,automaticRetry:false});
 assert.deepEqual(failureDisposition(new AiError('ai_rate_limited')),{status:'rejected',code:'ai_rate_limited',automaticRetry:false});
});
test('durable adapter can retain truncated response and usage without weakening existing caller rejection',async()=>{
 const config={baseUrl:'https://example.test',apiKey:'REVIEW_PLACEHOLDER_575a8dfc08a84f40bc3b',model:'stub',timeoutMs:1000};
 const fetcher=(async()=>new Response(JSON.stringify({choices:[{finish_reason:'length',message:{content:'{"tasks":['}}],usage:{prompt_tokens:5,completion_tokens:2,total_tokens:7}}))) as typeof fetch;
 await assert.rejects(completeChatWithMetadata(config,[],fetcher),{code:'ai_output_truncated'});
 const result=await completeChatWithMetadata(config,[],fetcher,{captureIncomplete:true});
 assert.equal(result.finishReason,'length');assert.equal(result.content,'{"tasks":[');assert.equal(result.usage.totalTokens,7);
});
test('local quota rejection is not uncertain provider billing and never auto retries',()=>{
 const result=failureDisposition(new AiError('ai_call_quota_exhausted'));
 assert.equal(result.status,'rejected');assert.equal(result.automaticRetry,false);
});

test('new prompts state reciprocal mappings; saved v1 jobs retain their exact prompt without silent migration',()=>{
 const fixture=JSON.parse(readFileSync(new URL('../../../../evaluation/fixtures/long-plan-v7-saved-responses.json',import.meta.url),'utf8'));
 const record=fixture.records[8],payload=JSON.parse(record.messages[1].content);
 const current=fragmentMessages(fixture.source,fixture.scheme,payload.segment,[]);
 assert.match(current[0].content,/long-plan-fragment-v2/);
 assert.match(current[0].content,/双向完全一致/);
 const legacy=fragmentMessages(fixture.source,fixture.scheme,payload.segment,[],fixture.promptVersion);
 assert.deepEqual(legacy,record.messages);
 assert.throws(()=>fragmentMessages(fixture.source,fixture.scheme,payload.segment,[],'unknown-prompt'),/prompt_version_unsupported/);
});
