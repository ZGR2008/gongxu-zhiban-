import test from 'node:test';import assert from 'node:assert/strict';
import {longPlanPolicyV10 as p,reserveLongPlanV10 as reserve,assertApprovedMessagesV10 as approved} from '../evaluation/long-plan-budget-v10.mjs';
const messages=[{role:'system',content:'v2 approved protocol'},{role:'user',content:'原创合成需求😀'}];
test('v10 per-call upper bounds fit authorization and call 14 is refused',()=>{
 assert.ok(13*((p.maxInputBytes+p.inputEnvelopeTokens)*p.inputUSDPerMillion+p.maxOutputTokens*p.outputUSDPerMillion)/1e6<=0.50);
 const records=[];for(let i=0;i<13;i++)records.push(reserve(records,messages));assert.throws(()=>reserve(records,messages),/call_limit/);
});
test('v10 malformed input, oversized input and exhausted money reservation fail before dispatch',()=>{
 assert.throws(()=>reserve([],[messages[1],messages[0]]),/message_shape/);
 assert.throws(()=>reserve([],[messages[0],{...messages[1],content:'大'.repeat(31000)}]),/scope/);
 assert.throws(()=>reserve([{reserveUSD:0.50}],messages),/budget/);
 assert.equal(p.automaticRetries,0);assert.equal(p.thinking,'disabled');
});
test('equivalent JSONB key order is allowed but changed system, extra data or omitted conditions are blocked',()=>{
 const expected=[messages[0],{role:'user',content:JSON.stringify({segment:{start:0,end:4},conditions:['REVIEW_PLACEHOLDER_575a8dfc08a84f40bc3b'],sources:[]})}];
 const reordered=[messages[0],{role:'user',content:JSON.stringify({sources:[],conditions:['REVIEW_PLACEHOLDER_575a8dfc08a84f40bc3b'],segment:{end:4,start:0}})}];
 assert.doesNotThrow(()=>approved(reordered,expected));
 for(const value of [{...JSON.parse(expected[1].content),extra:'unapproved'},{...JSON.parse(expected[1].content),conditions:[]}])assert.throws(()=>approved([messages[0],{role:'user',content:JSON.stringify(value)}],expected));
 assert.throws(()=>approved([{...messages[0],content:'changed'},expected[1]],expected));
});
