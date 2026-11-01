import test from 'node:test';
import assert from 'node:assert/strict';
import {historicalDependency,historicalCommit} from '../evaluation/historical-source.mjs';
import {historicalInput} from '../evaluation/historical-records.mjs';
import {createHash} from 'node:crypto';
test('historical module traversal only resolves production source files',()=>{
 assert.equal(historicalDependency('apps/api/src/agent/routes.ts','../rag/service.js'),'apps/api/src/rag/service.ts');
 for(const specifier of ['../../../../.env.js','../..\\.env.js','../config.json','../../node_modules/tool.js'])assert.throws(()=>historicalDependency('apps/api/src/agent/routes.ts',specifier));
});
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function fixture(){
 const input={requirement:'合成审批条件',documents:[]},messages=[{role:'system',content:'合成系统指令'},{role:'user',content:input.requirement}];
 const frame={caseId:'normal',datasetVersion:'1.0.0',pipeline:'pre_optimization',commit:historicalCommit,realModel:false,rawModelOutput:null,inputHash:hash(input),knowledgeHash:hash(input.documents),status:'prepared_not_executed',messages,promptHash:hash(messages)};
 return {input,report:{scope:'historical_route_prompt_capture_with_current_local_libraries_and_synthetic_dependencies',historicalSource:{commit:historicalCommit},datasetVersion:'1.0.0',realDatabase:false,externalCalls:0,paidCalls:0,comparisonResults:'not_executed',fullHistoricalWorkflow:'not_reproduced',frames:[frame]}};
}
test('paired historical inputs preserve pending status and reject different inputs or duplicate cases',()=>{
 const {input,report}=fixture();assert.equal(historicalInput(report,{id:'normal'},input,'1.0.0').status,'prepared_not_executed');
 assert.throws(()=>historicalInput(report,{id:'normal'},{...input,requirement:'另一个需求'},'1.0.0'));
 report.frames.push({...report.frames[0]});assert.throws(()=>historicalInput(report,{id:'normal'},input,'1.0.0'));
});
test('historical capture cannot be imported as model execution or with modified prompt bytes',()=>{
 for(const mutate of [r=>r.paidCalls=1,r=>r.fullHistoricalWorkflow='passed',r=>r.frames[0].realModel=true,r=>r.frames[0].messages[1].content+='changed',r=>r.datasetVersion='2.0.0']){
  const {input,report}=fixture();mutate(report);assert.throws(()=>historicalInput(report,{id:'normal'},input,'1.0.0'));
 }
});
test('only a source-free case can import no-model policy and cannot contain an answer',()=>{
 const {input,report}=fixture();Object.assign(report.frames[0],{caseId:'empty',status:'model_not_invoked_by_policy',policy:'no_source_no_answer',messages:null,promptHash:null});
 assert.equal(historicalInput(report,{id:'empty',kind:'empty'},input,'1.0.0').policy,'no_source_no_answer');
 report.frames[0].rawModelOutput='fabricated';assert.throws(()=>historicalInput(report,{id:'empty',kind:'empty'},input,'1.0.0'));
});
test('historical baseline is pinned and does not guess external module paths',()=>{
 assert.equal(historicalCommit,'5740ec36d03fffd30122e06287c92ef63a2ac5b1');
 assert.equal(historicalDependency('apps/api/src/agent/routes.ts','zod'),null);
 assert.equal(historicalDependency('apps/api/src/agent/routes.ts','node:crypto'),null);
});
