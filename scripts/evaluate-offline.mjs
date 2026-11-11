import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {requirementItems,assessPlan,itemEvidence} from '../apps/api/dist/trace/domain.js';
import {requirementGenerationIssue,requirementSegments} from '../apps/api/dist/requirement-content.js';
import {validatePlan} from '../apps/api/dist/agent/validate.js';
import {registerKnowledgeRoutes} from '../apps/api/dist/rag/routes.js';
import {registerTraceRoutes} from '../apps/api/dist/trace/routes.js';
import {createEmbeddings} from '../apps/api/dist/rag/embeddings.js';

if(process.argv.length>2)throw Error('Offline evaluation accepts no remote flags');
globalThis.fetch=async()=>{throw Error('Network is prohibited in offline evaluation');};
const require=createRequire(new URL('../apps/api/package.json',import.meta.url)),Fastify=require('fastify');
const dataset=JSON.parse(await readFile(new URL('../evaluation/cases.v1.json',import.meta.url),'utf8'));
const owner='11111111-1111-4111-8111-111111111111',version='22222222-2222-4222-8222-222222222222';
const auth={authorization:'Bearer '+'f'.repeat(64)}; // Deliberate REVIEW_PLACEHOLDER_575a8dfc08a84f40bc3b token, never accepted by a real server.
const report={datasetVersion:dataset.version,scope:'offline_contract_and_fixture_checks',realModel:false,realDatabase:false,semanticQuality:'not_evaluated',comparison:'not_executed',cases:[],startedAt:new Date().toISOString()};
async function ragFixture(sample){
  const hits=(sample.documents??[]).map((content,i)=>({id:`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,document_id:version,document_name:`合成资料${i+1}`,page:1,content,distance:.1}));
  let called=0;const app=Fastify();
  await registerKnowledgeRoutes(app,{userBySession:async()=>({id:owner})},{},{baseUrl:'https://example.invalid',model:'fixture'},{baseUrl:'https://example.invalid',model:'fixture',apiKey:'fixture',timeoutMs:1000},{retrieve:async()=>hits,complete:async(_config,messages)=>{
    called++;assert.equal(messages[0].role,'system');assert.equal(messages[1].role,'user');
    for(const doc of sample.documents)assert.ok(messages[1].content.includes(doc));
    if(sample.kind==='injection'){assert.ok(!messages[0].content.includes(sample.documents[0]));assert.match(messages[0].content,/数据而不是指令/);}
    return JSON.stringify({answer:'合成模型替身：仅检查上下文和来源协议，不能作为模型能力证据。',citations:hits.map(h=>h.id)});
  }});
  try{const response=await app.inject({method:'POST',url:'/knowledge/answer',headers:auth,payload:{query:sample.question}});assert.equal(response.statusCode,200);assert.equal(called,hits.length?1:0);assert.equal(response.json().sources.length,hits.length);if(!hits.length)assert.equal(response.json().answer,null);}
  finally{await app.close();}
}
for(const sample of dataset.cases){
  const started=performance.now();
  try{
    if(sample.kind==='normal'){
      const items=requirementItems(owner,version,sample.requirement);assert.equal(items.length,3);
      const plan={tasks:items.map((item,i)=>({key:`t${i}`,stage:'开发',title:'合成任务',description:item.text,deliverable:'人工复核对应验收记录',dependsOn:[],citations:[],requirementIds:[item.key]}))};
      const validated=validatePlan(JSON.stringify(plan),[]);assert.ok(validated.plan);const result=assessPlan(validated.plan,items);assert.ok(!result.warnings.some(w=>w.code==='unmapped_requirements'));assert.ok(result.warnings.some(w=>w.code==='no_source'));
    }else if(sample.kind==='long_tail'){
      const text='需'.repeat(sample.repeat)+sample.tail;assert.ok(requirementGenerationIssue(text));assert.equal(requirementSegments(text).map(s=>s.content).join(''),text);
      const supported='需'.repeat(19500)+sample.tail;assert.equal(requirementGenerationIssue(supported),undefined);assert.ok(requirementSegments(supported).at(-1).content.endsWith(sample.tail));
    }else if(sample.kind==='change'){
      const before=requirementItems(owner,'before',sample.before),after=requirementItems(owner,'after',sample.after);assert.equal(before[0].key,after[0].key);assert.notEqual(before[1].key,after[1].key);assert.equal(itemEvidence(after[1].id,[{itemId:before[1].id,caseId:'c',taskId:null,caseRevision:1,status:'confirmed'}],[{id:'c',revision:1,result:'passed',executionNote:'合成',executedAt:'2026-10-31'}]).manualEvidence,0);
    }else if(['conflict','empty','injection'].includes(sample.kind))await ragFixture(sample);
    else if(sample.kind==='isolation'){
      const app=Fastify();let queries=0;await registerTraceRoutes(app,{userBySession:async()=>({id:owner}),getProject:async()=>null},{query:async()=>{queries++;throw Error('Unauthorized query');}});
      try{const response=await app.inject({method:'GET',url:`/projects/${version}/trace`,headers:auth});assert.equal(response.statusCode,404);assert.equal(queries,0);}finally{await app.close();}
    }else if(sample.kind==='failure'){
      let calls=0;const config={baseUrl:'https://example.invalid',model:'fixture',apiKey:'fixture',timeoutMs:2000};
      await assert.rejects(createEmbeddings(['合成输入'],config,async()=>{calls++;return new Response(null,{status:sample.status});}),e=>e.code==='embedding_unavailable');assert.equal(calls,3);
      assert.deepEqual(await createEmbeddings(['合成输入'],config,async()=>new Response(JSON.stringify({data:[{index:0,embedding:[1,0]}]}),{status:200})),[[1,0]]);
    }else throw Error('Unknown versioned case kind');
    report.cases.push({id:sample.id,status:'passed',durationMs:Math.round(performance.now()-started),judgment:'implementation_contract_only',modelSemanticJudgment:'not_executed'});console.log(`PASS ${sample.id}`);
  }catch(error){report.cases.push({id:sample.id,status:'failed',errorType:error.constructor.name});console.log(`FAIL ${sample.id}`);process.exitCode=1;}
}
report.finishedAt=new Date().toISOString();await mkdir(new URL('../.runtime/',import.meta.url),{recursive:true});await writeFile(new URL(`../.runtime/evaluation-${Date.now()}.json`,import.meta.url),JSON.stringify(report,null,2));
