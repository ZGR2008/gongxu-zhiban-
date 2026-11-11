import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createRequire,syncBuiltinESMExports} from 'node:module';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import {prepareHistoricalSource,historicalCommit} from '../evaluation/historical-source.mjs';

// Offline prompt preparation only, not an old application deployment or model run.
if(process.argv.length>2)throw Error('Historical preparation accepts no live/model flags');
const root=fileURLToPath(new URL('../',import.meta.url)),directory=path.join(root,'.runtime',`historical-prompts-${randomUUID()}`);
await mkdir(directory,{recursive:true});
const build=await prepareHistoricalSource(root,directory);
const blocked=()=>{throw Error('offline_network_blocked');};
globalThis.fetch=async()=>blocked();http.request=blocked;http.get=blocked;https.request=blocked;https.get=blocked;net.connect=blocked;net.createConnection=blocked;net.Socket.prototype.connect=blocked;net.Server.prototype.listen=blocked;tls.connect=blocked;syncBuiltinESMExports();
const require=createRequire(new URL('../apps/api/package.json',import.meta.url));
const Fastify=require('fastify');
const {registerAgentRoutes}=await import(pathToFileURL(path.join(build.sourceDirectory,'agent/routes.js')).href);
const {registerKnowledgeRoutes}=await import(pathToFileURL(path.join(build.sourceDirectory,'rag/routes.js')).href);
const dataset=JSON.parse(await readFile(new URL('../evaluation/cases.v1.json',import.meta.url),'utf8'));
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const project='11111111-1111-4111-8111-111111111111',version='22222222-2222-4222-8222-222222222222',runId='33333333-3333-4333-8333-333333333333';
const auth={authorization:'Bearer '+'e'.repeat(64)};
const frames=[],checks=[];
await assert.rejects(fetch('https://example.invalid'),/offline_network_blocked/);
assert.throws(()=>http.get('http://127.0.0.1:1'),/offline_network_blocked/);
assert.throws(()=>net.createConnection({port:1,host:'127.0.0.1'}),/offline_network_blocked/);
checks.push({name:'fetch_http_and_socket_network_guards',status:'passed'});
for(const sample of dataset.cases.filter(item=>!['isolation','failure','change'].includes(item.kind))){
 const requirement=sample.requirement??(sample.kind==='long_tail'?'需'.repeat(sample.repeat)+sample.tail:sample.question);
 const input={requirement,documents:sample.documents??[]};
 const hits=input.documents.map((content,i)=>({id:`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,document_id:version,document_name:`版本化合成资料${i+1}`,page:1,content,distance:.1}));
 const queries=[],app=Fastify({logger:false});let captured=null,modelBoundaryCalls=0;
 const complete=async(_config,messages)=>{modelBoundaryCalls++;captured=structuredClone(messages);throw Error('intentional_capture_only_stop');};
 const ai={baseUrl:'https://example.invalid',apiKey:'fixture-only',model:'unselected',timeoutMs:1000,maxOutputTokens:4096};
 const store={userBySession:async()=>({id:project}),getProject:async()=>({id:project}),listRequirements:async()=>[{id:version,status:'confirmed',content:requirement}]};
 const pool={query:async(sql)=>({rows:sql.includes('RETURNING id')?[{id:runId}]:[]})};
 const retrieve=async(_pool,_owner,query)=>{queries.push(query);return hits;};
 try{
  let response;
  if(['normal','long_tail'].includes(sample.kind)){
   await registerAgentRoutes(app,store,pool,ai,{baseUrl:'https://fixture.invalid',model:'fixture'},{complete,retrieve});
   response=await app.inject({method:'POST',url:`/projects/${project}/agent/runs`,headers:auth,payload:{requirementId:version}});
  }else{
   await registerKnowledgeRoutes(app,store,pool,{baseUrl:'https://fixture.invalid',model:'fixture'},ai,{complete,retrieve});
   response=await app.inject({method:'POST',url:'/knowledge/answer',headers:auth,payload:{query:sample.question}});
  }
  if(sample.kind==='empty'){assert.equal(captured,null);assert.equal(response.json().answer,null);assert.equal(modelBoundaryCalls,0);}
  else{assert.equal(modelBoundaryCalls,1);assert.ok(captured?.length);for(const document of input.documents)assert.ok(captured[1].content.includes(document));}
  if(sample.kind==='normal')assert.ok(captured[1].content.includes(requirement));
  if(sample.kind==='long_tail'){assert.equal(queries[0].length,4000);assert.ok(!queries[0].includes(sample.tail));assert.ok(captured[1].content.includes('需'.repeat(20000)));assert.ok(!captured[1].content.includes(sample.tail));}
  if(sample.kind==='injection')assert.ok(!captured[0].content.includes(input.documents[0]));
  frames.push({caseId:sample.id,datasetVersion:dataset.version,pipeline:'pre_optimization',commit:historicalCommit,scope:'historical_route_prompt_capture_only',inputHash:hash(input),knowledgeHash:hash(input.documents),status:captured?'prepared_not_executed':'model_not_invoked_by_policy',policy:captured?null:'no_source_no_answer',messages:captured,promptHash:captured?hash(captured):null,retrievalScope:'fixed_REVIEW_PLACEHOLDER_575a8dfc08a84f40bc3b_hits_not_live_ranking',queryLengths:queries.map(query=>query.length),modelBoundaryCalls,realModel:false,rawModelOutput:null,providerUsage:null,semanticQuality:'not_evaluated',knownLimitations:sample.kind==='long_tail'?['historical_query_4000_and_prompt_20000_omit_tail']:[]});
  checks.push({name:`historical_${sample.id}`,status:'passed'});console.log(`CAPTURED ${sample.id}; real model not executed`);
 }finally{await app.close();}
}
const report={createdAt:new Date().toISOString(),datasetVersion:dataset.version,datasetHash:hash(dataset),historicalSource:build.manifest,scope:'historical_route_prompt_capture_with_current_local_libraries_and_REVIEW_PLACEHOLDER_575a8dfc08a84f40bc3b_dependencies',realDatabase:false,externalCalls:0,paidCalls:0,comparisonResults:'not_executed',fullHistoricalWorkflow:'not_reproduced',checks,frames};
await writeFile(path.join(directory,'prepared-inputs.json'),JSON.stringify(report,null,2));
console.log(`Prepared ${frames.length} historical input records; ${checks.length} protocol checks. No model scores or database validation.`);
console.log(`Report: ${path.join(directory,'prepared-inputs.json')}`);
