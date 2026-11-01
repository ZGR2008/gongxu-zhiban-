import test from 'node:test';import assert from 'node:assert/strict';
import {segmentPack,auditSegmentMerge,processReviewedSegments} from './segments.js';
test('long source is lossless including whitespace, emoji and the final acceptance requirement',()=>{
 const content='概述\r\n'+'资料😀'.repeat(7500)+'\n\n尾部必须禁止学生自行审批。\n';const pack=segmentPack('p','v',content);
 assert.equal(pack.segments.map(s=>s.content).join(''),content);assert.ok(pack.segments.at(-1)!.content.includes('禁止学生自行审批'));
 for(const s of pack.segments){assert.equal(content.slice(s.start,s.end),s.content);assert.ok(s.content.length<=4000);assert.ok(!/[\uD800-\uDBFF]$/.test(s.content));}
 assert.ok(pack.items.every(i=>pack.segments.some(s=>s.itemKeys.includes(i.key))));
 const next=segmentPack('p','v2',content);assert.deepEqual(pack.items.map(i=>i.key),next.items.map(i=>i.key));assert.deepEqual(pack.segments.map(s=>s.key),next.segments.map(s=>s.key));assert.notEqual(pack.versionId,next.versionId);
});
test('missing tail, unknown ids, unresolved boundaries and absent review block complete merge',()=>{
 const pack=segmentPack('p','v','前段必须审批。\n'+'上下文'.repeat(3000)+'\n末尾必须二人审核。');
 const results=pack.segments.map(s=>({segmentKey:s.key,sourceHash:s.sourceHash,coveredItemKeys:s.itemKeys,unresolved:[]}));
 const reviews=pack.segments.map(s=>({segmentKey:s.key,decision:'accepted' as const,note:'已核对原文边界及跨段条件'}));
 assert.equal(auditSegmentMerge(pack,results.slice(0,-1),reviews).structurallyComplete,false);
 assert.ok(auditSegmentMerge(pack,results.slice(0,-1),reviews).missingSegments.includes(pack.segments.at(-1)!.key));
 assert.equal(auditSegmentMerge(pack,results,[]).structurallyComplete,false);
 assert.equal(auditSegmentMerge(pack,[{...results[0],coveredItemKeys:['invented']},...results.slice(1)],reviews).structurallyComplete,false);
 assert.equal(auditSegmentMerge(pack,[{...results[0],unresolved:['跨段审批规则冲突']},...results.slice(1)],reviews).structurallyComplete,false);
 const valid=auditSegmentMerge(pack,results,reviews);assert.equal(valid.structurallyComplete,true);assert.equal(valid.semanticCompleteness,'unverified');assert.equal(valid.readyForAutomaticAdoption,false);
});
test('each split fragment must account for an item spanning multiple segments, never merely union ids',()=>{
 const pack=segmentPack('p','v','长单行'.repeat(4000));const reviews=pack.segments.map(s=>({segmentKey:s.key,decision:'accepted' as const,note:'人工核对跨段依赖'}));
 const results=pack.segments.map((s,i)=>({segmentKey:s.key,sourceHash:s.sourceHash,coveredItemKeys:i===0?s.itemKeys:[],unresolved:[]}));
 assert.ok(auditSegmentMerge(pack,results,reviews).uncoveredFragments.length>0);
});
test('bounded sequential processing refuses unreviewed inputs, aborts and retains completed failures honestly',async()=>{
 const pack=segmentPack('p','v','边界条件\n'.repeat(2000));let calls=0,active=0,maxActive=0;
 await assert.rejects(()=>processReviewedSegments(pack,[],async()=>{calls++;return {coveredItemKeys:[],unresolved:[]};}),/review_required/);assert.equal(calls,0);
 const reviews=pack.segments.map(s=>({segmentKey:s.key,decision:'accepted' as const,note:'已检查原文范围与依赖'}));
 const result=await processReviewedSegments(pack,reviews,async(s)=>{calls++;active++;maxActive=Math.max(maxActive,active);await Promise.resolve();active--;if(calls===2)throw Error('fixture_service_failure');return {coveredItemKeys:s.itemKeys,unresolved:[]};});
 assert.equal(maxActive,1);assert.equal(result.completed.length,1);assert.equal(result.status,'failed');assert.equal(result.failedSegment,pack.segments[1].key);
 const c=new AbortController();c.abort();const cancelled=await processReviewedSegments(pack,reviews,async()=>{throw Error('must not run');},c.signal);assert.equal(cancelled.status,'cancelled');assert.equal(cancelled.completed.length,0);
});
