import {readFile,writeFile,mkdir,realpath,stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createHash,randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {registerAgentRoutes} from '../apps/api/dist/agent/routes.js';
import {registerKnowledgeRoutes} from '../apps/api/dist/rag/routes.js';
import {historicalInput} from '../evaluation/historical-records.mjs';
import {sourceProvenance} from '../evaluation/source-provenance.mjs';

// Preparation only. No dotenv, credentials, external requests or real-model outputs.
const args=process.argv.slice(2);
if(args.length>1||args.some(value=>!value.startsWith('--historical-prompts=')))throw Error('Preparation accepts only an explicit local --historical-prompts= file; no live/model flags');
let historical=null;
if(args.length){
 const root=fileURLToPath(new URL('../',import.meta.url));
 const candidate=await realpath(path.resolve(root,args[0].slice('--historical-prompts='.length)));
 const relative=path.relative(root,candidate).replaceAll('\\','/');
 if(!/^\.runtime\/historical-prompts-[0-9a-f-]+\/prepared-inputs\.json$/.test(relative)||(await stat(candidate)).size>1_000_000)throw Error('Only a bounded local historical preparation report may be read');
 historical=JSON.parse(await readFile(candidate,'utf8'));
}
globalThis.fetch=async()=>{throw Error('Network is prohibited during evaluation preparation');};
const require=createRequire(new URL('../apps/api/package.json',import.meta.url));const Fastify=require('fastify');
const dataset=JSON.parse(await readFile(new URL('../evaluation/cases.v1.json',import.meta.url),'utf8'));
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const project='11111111-1111-4111-8111-111111111111',version='22222222-2222-4222-8222-222222222222',runId='33333333-3333-4333-8333-333333333333';
const auth={authorization:'Bearer '+'e'.repeat(64)};
const output=new URL(`../.runtime/evaluation-prepared-${randomUUID()}/`,import.meta.url);await mkdir(output,{recursive:true});
const provenance=sourceProvenance(new URL('../',import.meta.url));
const {commit,workingTreeClean}=provenance;
const sourceHashes={};for(const path of ['apps/api/src/agent/routes.ts','apps/api/src/rag/routes.ts','apps/api/src/requirement-content.ts','apps/api/src/trace/domain.ts','evaluation/cases.v1.json'])sourceHashes[path]=hash(await readFile(new URL('../'+path,import.meta.url),'utf8'));
const frames=[];
for(const sample of dataset.cases){
 const common={caseId:sample.id,datasetVersion:dataset.version,commit,realModel:false,semanticQuality:'not_evaluated',settings:{temperature:0.3,maxOutputTokens:4096,model:null},providerUsage:null};
 if(['isolation','failure','change'].includes(sample.kind)){
  frames.push({...common,status:'protocol_only',reason:'Use offline protocol and real-local isolation/version/recovery tests; no model score is inferred.'});continue;
 }
 const requirement=sample.requirement??(sample.kind==='long_tail'?'需'.repeat(sample.repeat)+sample.tail:sample.question);
 const input={requirement,documents:sample.documents??[]};
 const knowledgeHash=hash(input.documents);
 frames.push({...common,pipeline:'plain_chat',status:'prepared_not_executed',inputHash:hash(input),knowledgeHash,messages:[{role:'system',content:'你是软件工程实训助手。请根据用户给出的需求或问题及资料回答；不确定时说明。'},{role:'user',content:JSON.stringify(input)}]});
 frames.push(historical?{...common,...historicalInput(historical,sample,input,dataset.version),reason:'Original historical prompt assembly captured with current local libraries and REVIEW_PLACEHOLDER_575a8dfc08a84f40bc3b stores; full historical workflow and real model not executed.'}:{...common,pipeline:'pre_optimization',status:'not_executed',baselineCommit:'5740ec3',inputHash:hash(input),knowledgeHash,reason:'No historical prompt capture supplied. Use eval:prepare-historical explicitly; full historical workflow remains not reproduced.'});
 const hits=input.documents.map((content,i)=>({id:`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,document_id:version,document_name:`版本化合成资料${i+1}`,page:1,content,distance:.1}));
 const app=Fastify({logger:false});let captured=null;
 const complete=async(_config,messages)=>{captured=structuredClone(messages);throw Error('intentional_capture_only_stop');};
 const ai={baseUrl:'https://example.invalid',apiKey:'fixture-only',model:'unselected',timeoutMs:1000,maxOutputTokens:4096};
 const store={userBySession:async()=>({id:project}),getProject:async()=>({id:project}),listRequirements:async()=>[{id:version,status:'confirmed',content:requirement}]};
 const pool={query:async(sql)=>({rows:sql.includes('RETURNING id')?[{id:runId}]:[]})};
 let response;
 try{
  if(sample.kind==='normal'||sample.kind==='long_tail'){
   await registerAgentRoutes(app,store,pool,ai,{baseUrl:'https://fixture.invalid',model:'fixture'},{complete,retrieve:async()=>hits});
   response=await app.inject({method:'POST',url:`/projects/${project}/agent/runs`,headers:auth,payload:{requirementId:version}});
  }else{
   await registerKnowledgeRoutes(app,store,pool,{baseUrl:'https://fixture.invalid',model:'fixture'},ai,{complete,retrieve:async()=>hits});
   response=await app.inject({method:'POST',url:'/knowledge/answer',headers:auth,payload:{query:sample.question}});
  }
  if(sample.kind==='long_tail'){assert.equal(captured,null);assert.equal(response.statusCode,413);}
  else if(sample.kind==='empty'){assert.equal(captured,null);assert.equal(response.json().answer,null);}
  else{assert.ok(captured?.length);for(const doc of input.documents)assert.ok(captured[1].content.includes(doc));}
  frames.push({...common,pipeline:'current_workflow',inputHash:hash(input),knowledgeHash,retrievalScope:'fixed_REVIEW_PLACEHOLDER_575a8dfc08a84f40bc3b_hits_not_live_ranking',status:captured?'prepared_not_executed':'model_not_invoked_by_policy',policy:captured?null:sample.kind==='long_tail'?'explicit_length_rejection':'no_source_no_answer',messages:captured,promptHash:captured?hash(captured):null,rawModelOutput:null});
 }finally{await app.close();}
 console.log(`PREPARED ${sample.id}`);
}
const manifest={createdAt:new Date().toISOString(),datasetVersion:dataset.version,commit,workingTreeClean,gitStatus:provenance.gitStatus,sourceHashes,scope:'production_route_prompt_capture_with_fixed_REVIEW_PLACEHOLDER_575a8dfc08a84f40bc3b_retrieval',historicalRouteInputsPrepared:Boolean(historical),historicalSource:historical?.historicalSource??null,fullHistoricalWorkflow:'not_reproduced',externalCalls:0,paidCalls:0,comparisonResults:'not_executed',frames};
const review={status:'not_executed',instructions:'No outputs exist yet. After authorized identical-model runs, blind reviewers mark coverage, omissions and citation support using actual output excerpts.',cases:dataset.cases.map(sample=>({caseId:sample.id,criteria:sample.acceptance.map((text,i)=>({id:`${sample.id}:${i+1}`,text,judgment:'unjudged',outputEvidence:null,note:null,reviewerCodes:[]})),citationJudgments:[],humanEdits:null,humanMinutes:null,reviewerCodes:[]}))};
const template=JSON.parse(await readFile(new URL('../evaluation/record-template.json',import.meta.url),'utf8'));
const records=frames.filter(frame=>frame.pipeline).map(frame=>({...structuredClone(template),caseId:frame.caseId,pipeline:frame.pipeline,datasetVersion:dataset.version,commit:frame.pipeline==='pre_optimization'?(historical?frame.commit:null):commit,
 status:frame.status==='model_not_invoked_by_policy'?'policy_blocked':'not_executed',reason:frame.policy??frame.reason??'prepared_inputs_without_model_execution',inputHash:frame.inputHash,knowledgeHash:frame.knowledgeHash,
 settings:{...template.settings,temperature:.3,maxOutputTokens:4096},conditionJudgments:structuredClone(review.cases.find(sample=>sample.caseId===frame.caseId).criteria)}));
await writeFile(new URL('prepared-inputs.json',output),JSON.stringify(manifest,null,2));await writeFile(new URL('review-sheet.json',output),JSON.stringify(review,null,2));
await writeFile(new URL('run-records.json',output),JSON.stringify({schemaVersion:template.schemaVersion,records},null,2));
console.log(`Prepared ${frames.length} records; no model execution or semantic scores.`);
console.log(`Reviewable records: ${new URL('run-records.json',output).pathname}`);
