import {createRequire} from 'node:module';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {loadConfig} from '../apps/api/dist/config.js';
import {PgProjectStore} from '../apps/api/dist/project-store.js';
import {registerProjectRoutes} from '../apps/api/dist/project-routes.js';
import {registerKnowledgeRoutes} from '../apps/api/dist/rag/routes.js';
import {loadEmbeddingConfig,saveText,indexDocument,retrieveKnowledge} from '../apps/api/dist/rag/service.js';

// Real local HTTP disconnection, database and embedding. Chat is always a
// controlled fixture, even if a real key is already configured in the API .env.
const require=createRequire(new URL('../apps/api/package.json',import.meta.url));
require('dotenv').config({path:fileURLToPath(new URL('../apps/api/.env',import.meta.url))});
const config=loadConfig(),embedding=loadEmbeddingConfig();
const local=value=>['127.0.0.1','localhost','[::1]'].includes(new URL(value).hostname);
if(!config.DATABASE_URL||!local(config.DATABASE_URL)||!embedding||!local(embedding.baseUrl))throw Error('Existing local database and embedding required');
const originalFetch=globalThis.fetch;
globalThis.fetch=(input,init)=>{if(!local(input instanceof Request?input.url:String(input)))throw Error('External request prohibited');return originalFetch(input,{...init,redirect:'error'});};
const {Pool}=require('pg'),Fastify=require('fastify');
const pool=new Pool({connectionString:config.DATABASE_URL,connectionTimeoutMillis:3000,statement_timeout:15000,query_timeout:18000});
const store=new PgProjectStore(pool),app=Fastify({logger:false});
const directory=new URL(`../.runtime/knowledge-answer-local-${randomUUID()}/`,import.meta.url);await mkdir(directory,{recursive:true});
const report={scope:'real_local_http_disconnect_database_embedding_chat_fixture',realModel:false,REVIEW_PLACEHOLDER_575a8dfc08a84f40bc3bRecords:true,checks:[],startedAt:new Date().toISOString()};
let owner,foreign,address,stage='setup',mode='normal',calls=0,retrievalSignal,modelSignal,retainedHits=[],retrievalStarted=false;
const releases=[],pending=[];
const held=()=>new Promise(resolve=>releases.push(resolve));
const overall=AbortSignal.timeout(180000);
async function waitFor(predicate){
  const until=Date.now()+15000;
  while(!predicate()){overall.throwIfAborted();if(Date.now()>until)throw Error('Controlled event not observed');await new Promise(resolve=>setTimeout(resolve,10));}
}
async function check(name,work){stage=name;await work();report.checks.push({name,status:'passed'});console.log(`PASS ${name}`);}
await registerProjectRoutes(app,store);
await registerKnowledgeRoutes(app,store,pool,embedding,{baseUrl:'https://example.invalid',apiKey:'fixture-only',model:'controlled-fixture',timeoutMs:1000},{
 retrieve:async(...args)=>{
  const hits=await retrieveKnowledge(...args);retainedHits=hits;
  if(mode==='hold_retrieval'){retrievalSignal=args[4]?.signal;retrievalStarted=true;await held();}
  return hits;
 },
 complete:async(_config,_messages,_fetcher,options)=>{
  calls++;modelSignal=options?.signal;const sources=[...retainedHits];
  if(mode==='hold_model')await held(); // Deliberately ignores abort; route must still finish.
  if(mode==='insufficient')return JSON.stringify({status:'insufficient_evidence',answer:'合成模型判断：已召回的审批资料没有给出另一个版本的规则，需补充资料。',citations:[]});
  return JSON.stringify({answer:'合成模型回答：提交前由教师确认验收，不代表真实模型效果。',citations:sources.length?[sources[0].id]:[]});
 },
});
const query='提交前由教师确认验收，审批记录不得省略';
async function answer(identity=owner,signal=overall){
 const response=await fetch(address+'/knowledge/answer',{method:'POST',headers:{authorization:`Bearer ${identity.token}`,'content-type':'application/json'},body:JSON.stringify({query}),signal});
 return{status:response.status,body:await response.json()};
}
function beginCancelledRequest(){
 const controller=new AbortController();
 const promise=answer(owner,AbortSignal.any([overall,controller.signal])).then(()=>({aborted:false}),()=>({aborted:controller.signal.aborted}));pending.push(promise);
 return{controller,promise};
}
try{
 for(const other of [false,true]){
  const result=await app.inject({method:'POST',url:'/auth/register',payload:{name:'知识回答取消 · 合成',email:`answer-cancel-${randomUUID()}@example.test`,password:randomBytes(24).toString('base64url')}});assert.equal(result.statusCode,201);
  const data=result.json(),identity={id:data.user.id,token:data.token};if(other)foreign=identity;else owner=identity;
 }
 const saved=await saveText(pool,owner.id,'知识回答取消 · 原创合成资料',query+'。这是独立测试账号的人工编写资料，仅用于本地流程验证。');
 await indexDocument(pool,owner.id,saved.id,embedding,{signal:overall});
 address=await app.listen({host:'127.0.0.1',port:0});
 await check('real_retrieval_then_http_disconnect_never_starts_chat',async()=>{
  mode='hold_retrieval';const request=beginCancelledRequest();await waitFor(()=>retrievalStarted);assert.ok(retainedHits.length>0);
  request.controller.abort();assert.equal((await request.promise).aborted,true);await waitFor(()=>retrievalSignal?.aborted);releases.shift()();
  const activity=await app.inject({method:'GET',url:'/knowledge/activity',headers:{authorization:`Bearer ${owner.token}`}});assert.ok(activity.json().activities.some(row=>row.kind==='answer'&&row.state==='cancelled'));assert.equal(calls,0);
 });
 await check('three_http_model_disconnects_forward_signal_and_release_active_capacity',async()=>{
  mode='hold_model';
  for(let index=1;index<=3;index++){
   modelSignal=undefined;const request=beginCancelledRequest();await waitFor(()=>calls===index);assert.ok(modelSignal);
   request.controller.abort();assert.equal((await request.promise).aborted,true);await waitFor(()=>modelSignal.aborted);
  }
  // All three adapters are still held. A fourth normal request must be admitted.
  mode='normal';const next=await answer();assert.equal(next.status,200);assert.equal(calls,4);assert.ok(next.body.sources.length>0);
  for(const release of releases.splice(0))release();
 });
 await check('actual_sources_and_foreign_account_no_evidence_remain_correct',async()=>{
  const recovered=await answer();assert.equal(recovered.status,200);assert.equal(recovered.body.sources[0].document_id,saved.id);assert.ok(recovered.body.sources[0].content.includes(query));
  const before=calls,isolated=await answer(foreign);assert.equal(isolated.status,200);assert.equal(isolated.body.reason,'no_evidence');assert.equal(isolated.body.answer,null);assert.equal(calls,before);
  const rows=await pool.query('SELECT status FROM knowledge_documents WHERE id=$1 AND owner_id=$2',[saved.id,owner.id]);assert.equal(rows.rows[0].status,'ready');
 });
 await check('real_retrieval_can_return_uncited_insufficiency_without_losing_candidate_provenance',async()=>{
  mode='insufficient';const before=calls,result=await answer();assert.equal(result.status,200);assert.equal(calls,before+1);
  assert.equal(result.body.reason,'insufficient_evidence');assert.deepEqual(result.body.sources,[]);assert.ok(result.body.candidates.length>0);assert.ok(result.body.candidates.every(hit=>hit.document_id===saved.id));assert.ok(result.body.candidates[0].content.includes(query));
  mode='normal';const normal=await answer();assert.equal(normal.status,200);assert.equal(normal.body.reason,null);assert.equal(normal.body.candidates,undefined);assert.equal(normal.body.sources[0].document_id,saved.id);
 });
 report.status='passed';
}catch(error){report.status='failed';report.failedStage=stage;report.errorType=error.constructor.name;process.exitCode=1;console.log(`FAIL ${stage} (${error.constructor.name})`);}
finally{
 for(const release of releases.splice(0))release();await Promise.allSettled(pending);
 for(const identity of [owner,foreign])if(identity)await app.inject({method:'POST',url:'/auth/logout',headers:{authorization:`Bearer ${identity.token}`}}).catch(()=>{});
 await app.close();await pool.end();globalThis.fetch=originalFetch;report.chatFixtureCalls=calls;report.finishedAt=new Date().toISOString();await writeFile(new URL('report.json',directory),JSON.stringify(report,null,2));console.log(`Report: ${fileURLToPath(new URL('report.json',directory))}`);
}
