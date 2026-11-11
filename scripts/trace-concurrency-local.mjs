import {createRequire} from 'node:module';
import {randomUUID,randomBytes} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {createApp} from '../apps/api/dist/app.js';
import {PgProjectStore} from '../apps/api/dist/project-store.js';
import {loadConfig} from '../apps/api/dist/config.js';

const require=createRequire(new URL('../apps/api/package.json',import.meta.url));
require('dotenv').config({path:fileURLToPath(new URL('../apps/api/.env',import.meta.url))});
const config=loadConfig();
if(!config.DATABASE_URL||!['127.0.0.1','localhost','[::1]'].includes(new URL(config.DATABASE_URL).hostname))throw Error('Existing local database required');
const {Pool}=require('pg'),pool=new Pool({connectionString:config.DATABASE_URL,max:16,connectionTimeoutMillis:3000,statement_timeout:15000,query_timeout:18000});
let materializationGate=null;
const tracePool={connect:()=>pool.connect(),query:async(sql,values)=>{
 const gate=materializationGate;
 if(gate&&sql.startsWith('INSERT INTO requirement_items')){
  gate.arrivals++;if(gate.arrivals===12){materializationGate=null;gate.release();}
  await gate.wait;
 }
 return pool.query(sql,values);
}};
const app=await createApp({projectStore:new PgProjectStore(pool),pool:tracePool,corsOrigin:'http://127.0.0.1:5173'});
const origin=await app.listen({host:'127.0.0.1',port:0});
const directory=new URL(`../.runtime/trace-concurrency-local-${randomUUID()}/`,import.meta.url);await mkdir(directory,{recursive:true});
const report={scope:'real_local_http_and_database_concurrent_trace_initialization',realModel:false,externalCalls:0,REVIEW_PLACEHOLDER_575a8dfc08a84f40bc3bRecords:true,checks:[],startedAt:new Date().toISOString()};
let stage='setup',owner,foreign,project,first,second,firstTrace;
async function call(method,path,payload,identity=owner){
 const response=await fetch(new URL(path,origin),{method,headers:{...(identity?{authorization:'Bearer '+identity.token}:{}),...(payload===undefined?{}:{'content-type':'application/json'})},body:payload===undefined?undefined:JSON.stringify(payload),redirect:'error',signal:AbortSignal.timeout(20000)});
 return {status:response.status,body:await response.json()};
}
async function check(name,run){stage=name;await run();report.checks.push({name,status:'passed'});console.log(`PASS ${name}`);}
async function version(content){const r=await call('POST',`/projects/${project}/requirements`,{content});assert.equal(r.status,201);const value=r.body.requirement;assert.equal((await call('POST',`/projects/${project}/requirements/${value.id}/confirm`,{expectedContent:value.content})).status,200);return value;}
const trace=()=>`/projects/${project}/trace`;
try{
 for(const other of [false,true]){
  const r=await call('POST','/auth/register',{name:'追踪并发 · 合成',email:`trace-read-${randomUUID()}@example.test`,password:randomBytes(24).toString('base64url')},null);assert.equal(r.status,201);if(other)foreign=r.body;else owner=r.body;
 }
 const p=await call('POST','/projects',{name:'追踪初始化竞争 · 合成',description:'仅使用本机新建资料，不代表学生试用'});assert.equal(p.status,201);project=p.body.project.id;
 const lines=Array.from({length:120},(_,i)=>`条件${i+1}：必须保留对应的审批与执行说明。`);first=await version(lines.join('\n'));
 await check('twelve_first_reads_initialize_all_items_without_duplicate_key_errors',async()=>{
  let release;const gate={arrivals:0,release:()=>release(),wait:new Promise(resolve=>{release=resolve;})};materializationGate=gate;
  const timer=setTimeout(()=>{materializationGate=null;release();},5000);
  let results;
  try{results=await Promise.all(Array.from({length:12},()=>call('GET',trace())));}finally{clearTimeout(timer);release();materializationGate=null;}
  report.initialBarrierArrivals=gate.arrivals;assert.equal(gate.arrivals,12,'All real queries must arrive before release');report.initialStatuses=results.map(r=>r.status);
  assert.ok(results.every(r=>r.status===200));firstTrace=results[0].body;
  assert.equal(firstTrace.items.length,120);assert.equal(new Set(firstTrace.items.map(i=>i.id)).size,120);
  for(const r of results){assert.equal(r.body.version.id,first.id);assert.deepEqual(r.body.items,firstTrace.items);}
 });
 await check('current_and_historical_reads_keep_version_ids_and_original_offsets_separate',async()=>{
  second=await version(['条件1：必须由第二位审核人复核审批。',...lines.slice(1)].join('\n'));
  const results=await Promise.all(Array.from({length:12},(_,i)=>call('GET',trace()+(i%2?`?requirementVersionId=${first.id}`:''))));
  for(const [i,r] of results.entries()){
   assert.equal(r.status,200);const source=i%2?first:second;assert.equal(r.body.version.id,source.id);assert.equal(r.body.version.current,!Boolean(i%2));assert.equal(r.body.items.length,120);
   for(const item of r.body.items)assert.equal(source.content.slice(item.start,item.end),item.text);
   if(i%2)assert.deepEqual(r.body.items,firstTrace.items);else assert.equal(r.body.previousItems.length,120);
  }
 });
 await check('repeat_reads_preserve_human_change_review_without_incrementing_evidence',async()=>{
  const before=await call('GET',trace());assert.equal(before.status,200);const item=before.body.items[0],predecessor=before.body.previousItems.find(i=>i.position===1);
  const r=await call('POST',trace()+'/change-review',{itemId:item.id,predecessorId:predecessor.id,note:'合成人工登记：新版明确第二位审核人的职责'});assert.equal(r.status,200);
  const reviewed=(await call('GET',trace())).body,currentItem=reviewed.items.find(i=>i.id===item.id),evidence=(await call('GET',`/projects/${project}/evidence`)).body.evidence;
  assert.equal(currentItem.predecessorId,predecessor.id);assert.ok(currentItem.changeReviewNote.includes('第二位审核人'));assert.ok(currentItem.changeReviewedAt);
  const results=await Promise.all(Array.from({length:12},()=>call('GET',trace())));
  for(const result of results){assert.equal(result.status,200);assert.deepEqual(result.body.items.find(i=>i.id===item.id),currentItem);assert.equal(result.body.items[0].coverage.manualEvidence,0);}
  const after=(await call('GET',`/projects/${project}/evidence`)).body.evidence;
  for(const key of ['taskRevision','caseRevision','traceRevision','documentRevision'])assert.equal(after[key],evidence[key]);
 });
 await check('foreign_account_cannot_read_or_initialize_owned_trace',async()=>{
  const r=await call('GET',trace(),undefined,foreign);assert.equal(r.status,404);assert.deepEqual(r.body,{error:'not_found'});
  const stored=await pool.query('SELECT requirement_version_id,count(*)::int AS count FROM requirement_items WHERE project_id=$1 GROUP BY requirement_version_id',[project]);
  assert.equal(stored.rows.length,2);assert.ok(stored.rows.every(row=>row.count===120));
 });
 report.status='passed';
}catch(error){report.status='failed';report.failedStage=stage;report.errorType=error.code??error.constructor.name;console.error(`FAILED ${stage} (${report.errorType})`);process.exitCode=1;}
finally{await app.close();await pool.end();report.finishedAt=new Date().toISOString();await writeFile(new URL('report.json',directory),JSON.stringify(report,null,2));console.log(`Report: ${directory.pathname}`);}
