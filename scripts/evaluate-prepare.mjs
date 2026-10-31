import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {registerAgentRoutes} from '../apps/api/dist/agent/routes.js';
import {registerKnowledgeRoutes} from '../apps/api/dist/rag/routes.js';

// Preparation only. No dotenv, credentials, external requests or real-model outputs.
if(process.argv.length>2)throw Error('Preparation accepts no live/model flags');
globalThis.fetch=async()=>{throw Error('Network is prohibited during evaluation preparation');};
const require=createRequire(new URL('../apps/api/package.json',import.meta.url));const Fastify=require('fastify');
const dataset=JSON.parse(await readFile(new URL('../evaluation/cases.v1.json',import.meta.url),'utf8'));
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const project='11111111-1111-4111-8111-111111111111',version='22222222-2222-4222-8222-222222222222',runId='33333333-3333-4333-8333-333333333333';
const auth={authorization:'Bearer '+'e'.repeat(64)};
const output=new URL(`../.runtime/evaluation-prepared-${randomUUID()}/`,import.meta.url);await mkdir(output,{recursive:true});
const commit=execFileSync('git',['rev-parse','HEAD'],{cwd:new URL('../',import.meta.url),encoding:'utf8'}).trim();
const workingTreeClean=!execFileSync('git',['status','--porcelain'],{cwd:new URL('../',import.meta.url),encoding:'utf8'}).trim();
const sourceHashes={};for(const path of ['apps/api/src/agent/routes.ts','apps/api/src/rag/routes.ts','apps/api/src/requirement-content.ts','apps/api/src/trace/domain.ts','evaluation/cases.v1.json'])sourceHashes[path]=hash(await readFile(new URL('../'+path,import.meta.url),'utf8'));
const frames=[];
for(const sample of dataset.cases){
 const common={caseId:sample.id,datasetVersion:dataset.version,commit,realModel:false,semanticQuality:'not_evaluated',settings:{temperature:0.3,maxOutputTokens:4096,model:null},providerUsage:null};
 if(['isolation','failure','change'].includes(sample.kind)){
  frames.push({...common,status:'protocol_only',reason:'Use offline protocol and real-local isolation/version/recovery tests; no model score is inferred.'});continue;
 }
 const requirement=sample.requirement??(sample.kind==='long_tail'?'需'.repeat(sample.repeat)+sample.tail:sample.question);
 const input={requirement,documents:sample.documents??[]};
 frames.push({...common,pipeline:'plain_chat',status:'prepared_not_executed',inputHash:hash(input),messages:[{role:'system',content:'你是软件工程实训助手。请根据用户给出的需求或问题及资料回答；不确定时说明。'},{role:'user',content:JSON.stringify(input)}]});
 frames.push({...common,pipeline:'pre_optimization',status:'not_executed',baselineCommit:'5740ec3',inputHash:hash(input),reason:'Safe isolated full-workflow baseline has not been reproduced. Do not substitute a reconstructed prompt or current workflow.'});
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
  frames.push({...common,pipeline:'current_workflow',inputHash:hash(input),retrievalScope:'fixed_synthetic_hits_not_live_ranking',status:captured?'prepared_not_executed':'model_not_invoked_by_policy',policy:captured?null:sample.kind==='long_tail'?'explicit_length_rejection':'no_source_no_answer',messages:captured,promptHash:captured?hash(captured):null,rawModelOutput:null});
 }finally{await app.close();}
 console.log(`PREPARED ${sample.id}`);
}
const manifest={createdAt:new Date().toISOString(),datasetVersion:dataset.version,commit,workingTreeClean,sourceHashes,scope:'production_route_prompt_capture_with_fixed_synthetic_retrieval',externalCalls:0,paidCalls:0,comparisonResults:'not_executed',frames};
const review={status:'not_executed',instructions:'No outputs exist yet. After authorized identical-model runs, blind reviewers mark coverage, omissions and citation support using actual output excerpts.',cases:dataset.cases.map(sample=>({caseId:sample.id,criteria:sample.acceptance.map(text=>({text,judgment:'unjudged',outputEvidence:null})),citationJudgments:[],humanEdits:null,humanMinutes:null,reviewerCodes:[]}))};
await writeFile(new URL('prepared-inputs.json',output),JSON.stringify(manifest,null,2));await writeFile(new URL('review-sheet.json',output),JSON.stringify(review,null,2));
console.log(`Prepared ${frames.length} records; no model execution or semantic scores.`);
