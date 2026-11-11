import assert from 'node:assert/strict';
export const longPlanPolicyV10=Object.freeze({
 provider:'DeepSeek',model:'deepseek-flash',publishedVersion:'DeepSeek-V4.1-Flash-1017',
 maxCalls:13,maxUSD:0.50,maxInputBytes:90000,inputEnvelopeTokens:1024,maxOutputTokens:8192,
 inputUSDPerMillion:0.30,outputUSDPerMillion:1.20,thinking:'disabled',temperature:0.3,
 automaticRetries:0,pricingSource:'https://api-docs.deepseek.com/quick_start/pricing/',pricingChecked:'2026-11-02',
});
export function assertApprovedMessagesV10(messages,expected){
 assert.ok(expected);assert.equal(messages.length,2);assert.equal(messages[0].role,'system');assert.equal(messages[1].role,'user');
 assert.equal(messages[0].content,expected[0].content);
 // JSONB may reorder keys. Compare all approved fields and values exactly;
 // accepting equivalent ordering never permits extra input or missing content.
 assert.deepEqual(JSON.parse(messages[1].content),JSON.parse(expected[1].content));
}
export function reserveLongPlanV10(records,messages){
 const p=longPlanPolicyV10;
 if(!Array.isArray(messages)||messages.length!==2||messages[0].role!=='system'||messages[1].role!=='user')throw Error('unapproved_message_shape');
 if(records.length>=p.maxCalls)throw Error('call_limit_exhausted');
 const inputBytes=Buffer.byteLength(JSON.stringify(messages),'utf8');
 if(inputBytes>p.maxInputBytes)throw Error('input_scope_exceeded');
 const reserveUSD=((inputBytes+p.inputEnvelopeTokens)*p.inputUSDPerMillion+p.maxOutputTokens*p.outputUSDPerMillion)/1e6;
 if(records.reduce((total,r)=>total+r.reserveUSD,0)+reserveUSD>p.maxUSD)throw Error('reserved_budget_exhausted');
 return {number:records.length+1,inputBytes,reserveUSD,status:'reserved'};
}
