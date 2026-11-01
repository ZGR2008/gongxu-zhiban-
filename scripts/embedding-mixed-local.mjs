// Four fresh synthetic accounts; real loopback HTTP, PostgreSQL and embeddings.
// No existing business records are touched. A fixed chat fixture is used by Agent.
import {createRequire} from 'node:module';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import assert from 'node:assert/strict';
import {PgProjectStore} from '../apps/api/dist/project-store.js';
import {registerProjectRoutes} from '../apps/api/dist/project-routes.js';
import {registerKnowledgeRoutes} from '../apps/api/dist/rag/routes.js';
import {registerAgentRoutes} from '../apps/api/dist/agent/routes.js';
import {loadConfig} from '../apps/api/dist/config.js';
import {loadEmbeddingConfig,saveText,indexDocument} from '../apps/api/dist/rag/service.js';

const require=createRequire(new URL('../apps/api/package.json',import.meta.url));
require('dotenv').config({path:fileURLToPath(new URL('../apps/api/.env',import.meta.url))});
const settings=loadConfig(),embedding=loadEmbeddingConfig();
const local=value=>['localhost','127.0.0.1','[::1]'].includes(new URL(value).hostname);
assert.ok(settings.DATABASE_URL&&local(settings.DATABASE_URL)&&embedding&&local(embedding.baseUrl),'Local services required; no cloud fallback');
const nativeFetch=globalThis.fetch;
const provider={attempts:0,awaitingHeaders:0,peakAwaitingHeaders:0,statuses:{}};
globalThis.fetch=async(input,init)=>{
 const url=input instanceof Request?input.url:String(input);
 if(!local(url))throw Error('External request prohibited');
 if(!url.startsWith(embedding.baseUrl))return nativeFetch(input,{...init,redirect:'error'});
 provider.attempts++;provider.awaitingHeaders++;provider.peakAwaitingHeaders=Math.max(provider.peakAwaitingHeaders,provider.awaitingHeaders);
 try{const response=await nativeFetch(input,{...init,redirect:'error'});provider.statuses[response.status]=(provider.statuses[response.status]??0)+1;return response;}
 finally{provider.awaitingHeaders--;}
};
const {Pool}=require('pg'),Fastify=require('fastify');
const pool=new Pool({connectionString:settings.DATABASE_URL,connectionTimeoutMillis:3000,statement_timeout:15000,query_timeout:18000});
const app=Fastify({logger:false}),store=new PgProjectStore(pool),identities=[];
await registerProjectRoutes(app,store);await registerKnowledgeRoutes(app,store,pool,embedding);
let chatFixtureCalls=0;
await registerAgentRoutes(app,store,pool,{baseUrl:'https://example.invalid',apiKey:'test-only-placeholder',model:'SYNTHETIC-NO-REMOTE-CHAT',timeoutMs:1000},embedding,{complete:async(_config,messages)=>{
 chatFixtureCalls++;
 const input=messages[1].content,keys=[...new Set(input.match(/REQ-[a-f0-9]{16}/g))];
 const evidence=JSON.parse(input.split('实际检索资料：\n')[1].split('\n上次校验反馈：')[0]);
 return JSON.stringify({tasks:[{key:'t1',stage:'验证',title:'混合并发合成任务',description:'核对当前账号资料中的完整原文，不执行用户代码。',deliverable:'人工检查权限、完整片段与失败恢复，记录实际结果。',dependsOn:[],citations:evidence.length?[evidence[0].id]:[],requirementIds:keys}]});
}});
const directory=new URL(`../.runtime/embedding-mixed-local-${randomUUID()}/`,import.meta.url);await mkdir(directory,{recursive:true});
const report={scope:'real_loopback_http_postgresql_embeddings_four_synthetic_accounts',realChatModel:false,realStudentUsers:false,productionConfigChanged:false,checks:[],operations:[],observations:{queued:false,queuedCancellation:false,states:[],ownerActivityIsolation:false},startedAt:new Date().toISOString()};
let address,stage='setup',polling=false,pollTask,requests=[];
const observedStates=new Set(),observedIds=identities.map(()=>new Set());
async function call(identity,method,path,body,signal){
 const response=await nativeFetch(address+path,{method,headers:{...(identity?{authorization:`Bearer ${identity.token}`}:{ }),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(90000)]):AbortSignal.timeout(90000),redirect:'error'});
 return {status:response.status,body:await response.json()};
}
async function check(name,run){stage=name;await run();report.checks.push({name,status:'passed'});console.log(`PASS ${name}`);}
function operation(label,identity,method,path,body,signal){
 const start=performance.now();
 const pending=call(identity,method,path,body,signal).then(result=>{report.operations.push({label,status:result.status,durationMs:Math.round(performance.now()-start),errorCode:result.body.error??null});return result;},error=>{report.operations.push({label,status:'transport_stopped',durationMs:Math.round(performance.now()-start),errorType:error.name});throw error;});
 // Attach a handler immediately, even when assertions are made after polling.
 pending.catch(()=>{});requests.push(pending);return pending;
}
const text='审批记录必须保留申请人、审批时间和变更依据；资料只属于当前账号，不得返回其他账号的审批记录。失败时保留原文并明确重试。';
try{
 address=await app.listen({host:'127.0.0.1',port:0});
 for(let n=0;n<4;n++){
  const registration=await call(null,'POST','/auth/register',{name:'混合并发 · 合成账号',email:`mixed-${randomUUID()}@example.test`,password:randomBytes(24).toString('base64url')});assert.equal(registration.status,201);
  identities.push({id:registration.body.user.id,token:registration.body.token});observedIds.push(new Set());
 }
 for(const [index,identity] of identities.entries()){
  const seed=await saveText(pool,identity.id,'已索引的合成审批规范',text);await indexDocument(pool,identity.id,seed.id,embedding);identity.seedId=seed.id;
  // About ten bounded chunks; no synthetic delays or provider error injection.
  if(index<3)identity.document=await saveText(pool,identity.id,'待索引的合成并发资料',Array.from({length:120},(_,n)=>`条目${n+1}：${text}`).join('\n'));
 }
 const project=await call(identities[0],'POST','/projects',{name:'并发Agent · 合成验证',description:'仅验证服务排队和来源，不代表学生项目成果'});assert.equal(project.status,201);
 const base=`/projects/${project.body.project.id}`,requirement=await call(identities[0],'POST',base+'/requirements',{content:text});assert.equal(requirement.status,201);
 assert.equal((await call(identities[0],'POST',base+`/requirements/${requirement.body.requirement.id}/confirm`,{expectedContent:requirement.body.requirement.content})).status,200);
 const beforeCalls=provider.attempts;
 await check('real_mixed_index_search_and_agent_share_one_provider_slot',async()=>{
  const mixed=[operation('index_1',identities[0],'POST',`/knowledge/${identities[0].document.id}/index`)];
  // Authentication/database scheduling may reorder HTTP arrivals. Start the
  // competing requests only after observing actual inference in progress;
  // no provider sleeps or synthetic errors are used to manufacture a queue.
  let inferenceObserved=false;
  const observationDeadline=performance.now()+5000;
  while(performance.now()<observationDeadline){
   const activity=await call(identities[0],'GET','/knowledge/activity');
   if(activity.body.activities.some(row=>row.kind==='index'&&row.state==='running')){inferenceObserved=true;break;}
   await delay(10);
  }
  assert.ok(inferenceObserved,'Must observe real inference before launching competitors');
  for(const [i,identity]of identities.slice(0,3).entries()){
   if(i>0)mixed.push(operation(`index_${i+1}`,identity,'POST',`/knowledge/${identity.document.id}/index`));
   mixed.push(operation(`search_${i+1}`,identity,'POST','/knowledge/search',{query:text}));
  }
  const agent=operation('agent_1',identities[0],'POST',base+'/agent/runs',{requirementId:requirement.body.requirement.id});
  const cancellation=new AbortController();
  const cancelled=operation('queued_search_cancel',identities[3],'POST','/knowledge/search',{query:text},cancellation.signal);
  polling=true;
  pollTask=(async()=>{while(polling){
   const rows=await Promise.all(identities.map(identity=>call(identity,'GET','/knowledge/activity')));
   for(const [index,response]of rows.entries()){
    assert.equal(response.status,200);
    for(const row of response.body.activities){observedIds[index].add(row.id);observedStates.add(row.state);if(row.state==='queued')report.observations.queued=true;
     if(index===3&&row.state==='queued'&&!cancellation.signal.aborted){report.observations.queuedCancellation=true;cancellation.abort();}
    }
   }
   await delay(30);
  }})();pollTask.catch(()=>{});
  const outcomes=await Promise.allSettled([...mixed,agent,cancelled]);polling=false;await pollTask;
  for(let i=0;i<mixed.length;i++){assert.equal(outcomes[i].status,'fulfilled');assert.equal(outcomes[i].value.status,200);if(i%2)assert.ok(outcomes[i].value.body.hits.every(hit=>[identities[(i-1)/2].seedId,identities[(i-1)/2].document.id].includes(hit.document_id)));}
  assert.equal(outcomes[6].status,'fulfilled');assert.equal(outcomes[6].value.status,201);assert.equal(outcomes[6].value.body.run.status,'awaiting_review');
  assert.ok(report.observations.queued,'Actual queued activity must be observed, not inferred from concurrent promises');
  assert.ok(report.observations.queuedCancellation,'Cancellation is only asserted after actual queued status');assert.equal(outcomes[7].status,'rejected');
  assert.equal(provider.peakAwaitingHeaders,1);assert.equal(chatFixtureCalls,1);assert.ok(provider.attempts-beforeCalls<=10,'No unexpected retry storm under this healthy local sample');
 });
 await check('queue_cancel_is_final_and_recovery_preserves_account_isolation',async()=>{
  const activity=await call(identities[3],'GET','/knowledge/activity');assert.ok(activity.body.activities.some(row=>row.kind==='search'&&row.state==='cancelled'));
  const recovered=await operation('cancelled_account_recovery',identities[3],'POST','/knowledge/search',{query:text});assert.equal(recovered.status,200);assert.ok(recovered.body.hits.length>0);assert.ok(recovered.body.hits.every(hit=>hit.document_id===identities[3].seedId));
  for(let i=0;i<observedIds.length;i++)for(let j=i+1;j<observedIds.length;j++)assert.equal([...observedIds[i]].some(id=>observedIds[j].has(id)),false);
  report.observations.ownerActivityIsolation=true;
  assert.equal((await call(identities[3],'POST',`/knowledge/${identities[0].document.id}/index`)).status,404);
  const own=await operation('indexed_source_recovery',identities[0],'POST','/knowledge/search',{query:text});assert.equal(own.status,200);assert.ok(own.body.hits.length>0);assert.ok(own.body.hits.every(hit=>[identities[0].seedId,identities[0].document.id].includes(hit.document_id)));
 });
 await check('actual_index_chunks_remain_complete_after_the_mixed_requests',async()=>{
  for(const identity of identities.slice(0,3)){
   const listing=await call(identity,'GET','/knowledge?limit=20');assert.equal(listing.status,200);assert.equal(listing.body.documents.length,2);
   const document=listing.body.documents.find(row=>row.id===identity.document.id);assert.equal(document.indexCompatibility,'current');assert.equal(document.currentChunks,document.chunkCount);assert.equal(document.chunkCount,identity.document.chunks);
  }
 });
 report.status='passed';
}catch(error){report.status='failed';report.failedStage=stage;report.errorType=error.name;console.log(`FAIL ${stage} (${error.name})`);process.exitCode=1;}
finally{
 polling=false;await pollTask?.catch(()=>{});await Promise.allSettled(requests);
 for(const identity of identities)if(address)await call(identity,'POST','/auth/logout').catch(()=>{});
 await app.close();await pool.end();report.provider={...provider};report.chatFixtureCalls=chatFixtureCalls;report.observations.states=[...observedStates];report.finishedAt=new Date().toISOString();
 await writeFile(new URL('report.json',directory),JSON.stringify(report,null,2));console.log(`Report: ${fileURLToPath(new URL('report.json',directory))}`);
}
