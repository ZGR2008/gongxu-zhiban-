// Offline replay of previously approved REVIEW_PLACEHOLDER_575a8dfc08a84f40bc3b evidence. No environment
// loading, database access, model adapter, fetch call or source-file mutation.
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {hash,parseSegmentOutput,PROMPT_VERSION} from '../apps/api/dist/long-plan/domain.js';
import {fragmentMessages} from '../apps/api/dist/long-plan/worker.js';
const file=new URL('../evaluation/fixtures/long-plan-v7-saved-responses.json',import.meta.url);
const raw=await readFile(file),fixture=JSON.parse(raw);
assert.equal(fixture.origin,'saved_paid_REVIEW_PLACEHOLDER_575a8dfc08a84f40bc3b_responses_not_new_calls');
assert.equal(fixture.sourceUtf16Length,49781);assert.equal(fixture.records.length,9);
const checks=[];
for(const record of fixture.records){
 assert.equal(hash(record.output),record.outputSha256);
 const payload=JSON.parse(record.messages[1].content),output=JSON.parse(record.output);
 assert.equal(payload.segment.content,fixture.source.slice(payload.segment.start,payload.segment.end));
 for(const c of payload.conditions)assert.equal(c.original,fixture.source.slice(c.start,c.end));
 assert.deepEqual(fragmentMessages(fixture.source,fixture.scheme,payload.segment,payload.sources,fixture.promptVersion),record.messages);
 const mismatches=[
  ...output.fragments.flatMap(f=>f.taskKeys.filter(k=>!output.tasks.find(t=>t.key===k)?.conditionIds.includes(f.conditionId)).map(k=>({direction:'fragment_to_task',conditionId:f.conditionId,taskKey:k}))),
  ...output.tasks.flatMap(t=>t.conditionIds.filter(k=>!output.fragments.find(f=>f.conditionId===k)?.taskKeys.includes(t.key)).map(k=>({direction:'task_to_fragment',conditionId:k,taskKey:t.key}))),
 ];
 let parserError=null;try{parseSegmentOutput(record.output,payload.segment,fixture.scheme,payload.sources.map(s=>s.id));}catch(error){parserError=error.message;}
 assert.equal(parserError,payload.segment.part===9?'fragment_task_condition_mismatch':null);
 checks.push({part:payload.segment.part,outputSha256:record.outputSha256,finishReason:record.finishReason,sourceRangesPreserved:true,legacyPromptExact:true,mismatches,parserStatus:parserError?'rejected':'structure_only_accepted',parserError,semanticReview:'pending'});
}
assert.deepEqual(checks[8].mismatches,[
 {direction:'fragment_to_task',conditionId:'CND-461defa51e218e1e27a1',taskKey:'T5'},
 {direction:'task_to_fragment',conditionId:'CND-e480fe1c7004ec17f77b',taskKey:'T4'},
]);
const ninth=fixture.records[8],payload=JSON.parse(ninth.messages[1].content),oneEdit=JSON.parse(ninth.output);
oneEdit.tasks.find(t=>t.key==='T5').conditionIds.push('CND-461defa51e218e1e27a1');
assert.throws(()=>parseSegmentOutput(JSON.stringify(oneEdit),payload.segment,fixture.scheme,[]),/fragment_task_condition_mismatch/);
const current=fragmentMessages(fixture.source,fixture.scheme,payload.segment,payload.sources);
assert.match(current[0].content,/双向完全一致/);assert.equal(current[1].content,ninth.messages[1].content);
assert.equal(hash(await readFile(file)),hash(raw));
const report={scope:'offline_replay_of_saved_real_REVIEW_PLACEHOLDER_575a8dfc08a84f40bc3b_responses',checkedAt:new Date().toISOString(),paidModelCalls:0,fixtureSha256:hash(raw),sourceReportSha256:fixture.sourceReportSha256,checks,prompt:{previous:fixture.promptVersion,current:PROMPT_VERSION,legacySnapshotNotMigrated:true,v2RealQualityVerified:false},oneEditRegression:{origin:'explicit_in_memory_test_mutation_not_human_review',stillRejected:true,originalFileUnchanged:true},notCalledParts:fixture.uncalledParts,sourceTailGenerated:false,globalMergeVerified:false,independentHumanReviews:0,status:'passed'};
const out=new URL(`../.runtime/long-plan-diagnosis-v10-${randomUUID()}/`,import.meta.url);await mkdir(out,{recursive:true});await writeFile(new URL('report.json',out),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status:report.status,replayed:checks.length,rejectedPart:9,mismatches:checks[8].mismatches,paidModelCalls:0,report:fileURLToPath(new URL('report.json',out))},null,2));
