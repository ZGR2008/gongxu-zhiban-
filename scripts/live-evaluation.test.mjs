import test from 'node:test';import assert from 'node:assert/strict';
import {prepareLive,executeLive,policy} from '../evaluation/live-policy.mjs';
const frame={pipeline:'plain_chat',caseId:'normal',status:'prepared_not_executed',messages:[{role:'user',content:'合成：审批失败回滚。'}]};
const fixture=(frames=[frame])=>({datasetVersion:'1.0.0',paidCalls:0,externalCalls:0,scope:'production_route_prompt_capture_with_fixed_synthetic_retrieval',frames});
test('preparation is bounded, does not truncate tail and cannot accept arbitrary cases',()=>{
 assert.throws(()=>prepareLive(fixture([{...frame,caseId:'private-business'}])));assert.throws(()=>prepareLive(fixture([frame,frame])));
 assert.throws(()=>prepareLive(fixture([{...frame,messages:[{role:'user',content:'需'.repeat(30000)}]}])));
 const text='需'.repeat(21000)+'尾部禁止自己审批';const p=prepareLive(fixture([{...frame,caseId:'tail-condition',messages:[{role:'user',content:text}]}]));assert.equal(p.calls[0].messages[0].content,text);assert.ok(p.reservedUSD<policy.maxCostUSD);
});
test('HTTP failure stops without retry and never retains credentials/provider error body',async()=>{
 let calls=0;const prepared=prepareLive(fixture([frame,{...frame,pipeline:'current_workflow'}]));
 const result=await executeLive(prepared,{apiKey:'synthetic-test-only',fetchImpl:async()=>{calls++;return new Response('DO_NOT_RECORD',{status:429});}});
 assert.equal(calls,1);assert.equal(result.remainingCalls,1);assert.ok(!JSON.stringify(result).includes('synthetic-test-only'));assert.ok(!JSON.stringify(result).includes('DO_NOT_RECORD'));assert.equal(result.reservedUSD,prepared.calls[0].reservedUSD);
});
test('identical settings, no tools and truncation recorded as incomplete not successful quality',async()=>{
 const result=await executeLive(prepareLive(fixture()),{apiKey:'synthetic-test-only',fetchImpl:async(url,init)=>{
  assert.equal(url,policy.endpoint);assert.equal(init.redirect,'error');const sent=JSON.parse(init.body);assert.equal(sent.tools,undefined);assert.deepEqual(sent.thinking,{type:'disabled'});assert.equal(sent.max_tokens,4096);
  return Response.json({model:'provider-snapshot',choices:[{finish_reason:'length',message:{content:'partial'}}],usage:{prompt_tokens:23,completion_tokens:10}});
 }});assert.equal(result.results[0].status,'incomplete');assert.equal(result.results[0].semanticJudgment,'unjudged');assert.equal(result.results[0].usage.totalTokens,33);
});
