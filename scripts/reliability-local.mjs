import { createRequire } from 'node:module';
import { randomUUID,randomBytes } from 'node:crypto';
import { mkdir,writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { PgProjectStore } from '../apps/api/dist/project-store.js';
import { registerProjectRoutes } from '../apps/api/dist/project-routes.js';
import { registerPracticeRoutes } from '../apps/api/dist/practice/routes.js';
import { PgDocumentStore } from '../apps/api/dist/documents/store.js';
import { loadConfig } from '../apps/api/dist/config.js';
import { loadEmbeddingConfig,saveText,indexDocument,retrieveKnowledge } from '../apps/api/dist/rag/service.js';

// Run from apps/api so the normal dotenv loader uses the existing local configuration.
// Values, tokens and business bodies are never printed or written to reports.
const require=createRequire(new URL('../apps/api/package.json',import.meta.url));
require('dotenv').config();
const settings=loadConfig();
if(!settings.DATABASE_URL||!['localhost','127.0.0.1','[::1]'].includes(new URL(settings.DATABASE_URL).hostname))throw Error('Local database required');
const {Pool}=require('pg'),Fastify=require('fastify');
const pool=new Pool({connectionString:settings.DATABASE_URL,connectionTimeoutMillis:3000});
const store=new PgProjectStore(pool),app=Fastify({logger:false});
const directory=new URL(`../.runtime/reliability-local-${randomUUID()}/`,import.meta.url);await mkdir(directory,{recursive:true});
const report={scope:'real_local_database_and_optional_local_embedding',model:'controlled_fixture_no_remote_calls',syntheticRecords:true,checks:[],startedAt:new Date().toISOString()};
let stage='setup',auth={},foreign={},user,foreignUser,project,firstVersion,secondVersion,testCase;
const cases={cases:['normal','boundary','exception'].map(category=>({category,title:`合成${category}用例`,preconditions:'本机隔离回归',steps:'人工检查边界',expected:'保留审批记录'}))};
await registerProjectRoutes(app,store);
await registerPracticeRoutes(app,store,pool,{baseUrl:'https://example.invalid',apiKey:'test-only-placeholder',model:'controlled-fixture',timeoutMs:1000},{complete:async()=>JSON.stringify(cases)});
async function call(method,url,payload,headers=auth){return app.inject({method,url,headers,...(payload===undefined?{}:{payload})});}
async function check(name,work){stage=name;await work();report.checks.push({name,status:'passed'});console.log(`PASS ${name}`);}
try{
 await check('isolated_accounts_and_owned_project',async()=>{
  for(const other of [false,true]){
   const response=await call('POST','/auth/register',{name:'可靠性验证 · 合成账号',email:`reliability-${randomUUID()}@example.test`,password:randomBytes(24).toString('base64url')},{});assert.equal(response.statusCode,201);
   const data=response.json();if(other){foreign={authorization:`Bearer ${data.token}`};foreignUser=data.user.id;}else{auth={authorization:`Bearer ${data.token}`};user=data.user.id;}
  }
  const response=await call('POST','/projects',{name:'可靠性回归 · 合成项目',description:'仅用于回归验证，不代表真实学生数据'});assert.equal(response.statusCode,201);project=response.json().project.id;
 });
 const root=`/projects/${project}`;
 await check('confirmed_requirement_and_generated_fixture_cases',async()=>{
  let response=await call('POST',`${root}/requirements`,{content:'需求版本一：审批必须留存记录。'});assert.equal(response.statusCode,201);firstVersion=response.json().requirement.id;
  assert.equal((await call('POST',`${root}/requirements/${firstVersion}/confirm`)).statusCode,200);
  response=await call('POST',`${root}/test-cases`,{requirementId:firstVersion});assert.equal(response.statusCode,201);testCase=response.json().cases[0];assert.equal(testCase.revision,1);assert.equal(testCase.result,'not_run');
 });
 await check('editing_invalidates_current_result_but_retains_previous_evidence',async()=>{
  const url=`${root}/test-cases/${testCase.id}`;
  let response=await call('PATCH',url+'/execution',{result:'passed',note:'合成人工记录：仅用于验证历史留存，不代表执行了示例代码',expectedRevision:1});assert.equal(response.statusCode,200);
  const {category,title,preconditions,steps}=testCase;
  response=await call('PATCH',url,{category,title,preconditions,steps,expected:'新版必须双人审批',expectedRevision:1});assert.equal(response.statusCode,200);assert.equal(response.json().case.revision,2);assert.equal(response.json().case.result,'not_run');
  const history=(await call('GET',url+'/history')).json().history;assert.ok(history.some(row=>row.kind==='definition_changed'&&row.snapshot.result==='passed'&&row.snapshot.execution_note.includes('合成人工记录')));
  response=await call('PATCH',url+'/execution',{result:'passed',note:'旧定义的迟到记录',expectedRevision:1});assert.equal(response.statusCode,409);
 });
 await check('foreign_account_cannot_read_or_write_execution_evidence',async()=>{
  const url=`${root}/test-cases/${testCase.id}`;assert.equal((await call('GET',url+'/history',undefined,foreign)).statusCode,404);assert.equal((await call('PATCH',url+'/execution',{result:'passed',note:'越权合成请求',expectedRevision:2},foreign)).statusCode,404);
 });
 await check('current_version_statistics_do_not_inherit_historical_passes',async()=>{
  const response=await call('POST',`${root}/requirements`,{content:'需求版本二：审批必须由两人确认，并保留原记录。'});assert.equal(response.statusCode,201);secondVersion=response.json().requirement.id;
  assert.equal((await call('POST',`${root}/requirements/${secondVersion}/confirm`)).statusCode,200);
  assert.equal((await call('GET',`${root}/test-cases`)).json().cases.length,0);
  assert.equal((await call('GET',`${root}/test-cases?requirementVersionId=${firstVersion}`)).json().cases.length,3);
  assert.equal((await call('POST',`${root}/test-cases`,{requirementId:secondVersion})).statusCode,201);
  const context=await new PgDocumentStore(pool).getContext(user,project,secondVersion);assert.equal(context.testCounts.total,3);assert.equal(context.testCounts.notRun,3);assert.equal(context.testCounts.passed,0);
 });
 let embedding;
 try{embedding=loadEmbeddingConfig();}catch{report.checks.push({name:'real_local_embedding',status:'not_run',reason:'configuration_invalid'});}
 if(embedding&&['localhost','127.0.0.1','[::1]'].includes(new URL(embedding.baseUrl).hostname)){
  await check('real_local_embedding_concurrent_index_search_and_owner_isolation',async()=>{
   const text='合成回归规则：审批必须由两人共同确认，保存审批记录后才能交付。';
   const doc=await saveText(pool,user,'并发索引回归 · 合成资料',text);
   const [indexed]=await Promise.all([indexDocument(pool,user,doc.id,embedding),retrieveKnowledge(pool,user,text,embedding)]);assert.equal(indexed.status,'ready');
   const hits=await retrieveKnowledge(pool,user,text,embedding);assert.ok(hits.some(hit=>hit.document_id===doc.id));
   const foreignHits=await retrieveKnowledge(pool,foreignUser,text,embedding);assert.equal(foreignHits.some(hit=>hit.document_id===doc.id),false);
  });
 }else if(!report.checks.some(row=>row.name==='real_local_embedding'))report.checks.push({name:'real_local_embedding',status:'not_run',reason:'no_authorized_local_provider'});
}catch(error){report.checks.push({name:stage,status:'failed',errorType:error.constructor.name});console.log(`FAIL ${stage}`);process.exitCode=1;}
finally{for(const headers of [auth,foreign])if(headers.authorization)await call('POST','/auth/logout',undefined,headers).catch(()=>{});await app.close();await pool.end();report.finishedAt=new Date().toISOString();await writeFile(new URL('report.json',directory),JSON.stringify(report,null,2));}
