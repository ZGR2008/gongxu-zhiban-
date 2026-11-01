import {createRequire} from 'node:module';
import {randomUUID,randomBytes} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {createApp} from '../apps/api/dist/app.js';
import {PgProjectStore} from '../apps/api/dist/project-store.js';
import {loadConfig} from '../apps/api/dist/config.js';
import {sourceProvenance} from '../evaluation/source-provenance.mjs';

// Local database only, synthetic records retained, no chat/embedding configuration.
const require=createRequire(new URL('../apps/api/package.json',import.meta.url));
require('dotenv').config({path:fileURLToPath(new URL('../apps/api/.env',import.meta.url))});
const config=loadConfig();
if(!config.DATABASE_URL||!['localhost','127.0.0.1','[::1]'].includes(new URL(config.DATABASE_URL).hostname))throw Error('Existing loopback database required');
const {Pool}=require('pg'),pool=new Pool({connectionString:config.DATABASE_URL,max:8,connectionTimeoutMillis:3000,statement_timeout:10000});
const app=await createApp({projectStore:new PgProjectStore(pool),pool,corsOrigin:'http://127.0.0.1:5173'});
const origin=await app.listen({host:'127.0.0.1',port:0});
const directory=new URL(`../.runtime/execution-concurrency-local-${randomUUID()}/`,import.meta.url);await mkdir(directory,{recursive:true});
const report={scope:'real_local_database_http_synthetic_execution_concurrency_no_models',...sourceProvenance(new URL('../',import.meta.url)),startedAt:new Date().toISOString(),checks:[],paidModelCalls:0};
let owner,foreign,project,version;
async function call(method,path,payload,user=owner){const r=await fetch(new URL(path,origin),{method,headers:{...(user?{authorization:'Bearer '+user.token}:{}),...(payload===undefined?{}:{'content-type':'application/json'})},body:payload===undefined?undefined:JSON.stringify(payload),signal:AbortSignal.timeout(15000),redirect:'error'});return {status:r.status,body:await r.json()};}
async function check(name,run){try{await run();report.checks.push({name,status:'passed'});console.log('PASS '+name);}catch(e){report.checks.push({name,status:'failed',errorType:e.constructor.name});process.exitCode=1;console.log('FAIL '+name);}}
async function makeCase(){const r=await pool.query(`INSERT INTO practice_test_cases(project_id,requirement_version_id,category,title,preconditions,steps,expected,model_name) VALUES($1,$2,'normal','执行并发 · 合成用例','','人工核对','保留原记录','fixture-no-model') RETURNING id`,[project,version]);return (await call('GET',`/projects/${project}/test-cases?requirementVersionId=${version}`)).body.cases.find(x=>x.id===r.rows[0].id);}
const path=row=>`/projects/${project}/test-cases/${row.id}`;
// Omission is used only to reproduce the legacy API's actual overwrite. On the
// new API the value must be present and must be the independently read token.
const payload=(row,result,note)=>({result,note,expectedRevision:row.revision,...(Number.isInteger(row.executionRevision)?{expectedExecutionRevision:row.executionRevision}:{})});
async function current(row){return (await call('GET',`/projects/${project}/test-cases?requirementVersionId=${version}`)).body.cases.find(x=>x.id===row.id);}
try{
 for(const other of [false,true]){const r=await call('POST','/auth/register',{name:'执行冲突 · 合成',email:`execution-v4-${randomUUID()}@example.test`,password:randomBytes(24).toString('base64url')},null);assert.equal(r.status,201);if(other)foreign=r.body;else owner=r.body;}
 project=(await call('POST','/projects',{name:'执行并发验证 · 合成',description:'仅本轮合成资料，无真实用户数据'})).body.project.id;
 const r=await call('POST',`/projects/${project}/requirements`,{content:'登记测试结果必须保留并发冲突证据。'});version=r.body.requirement.id;
 assert.equal((await call('POST',`/projects/${project}/requirements/${version}/confirm`,{expectedContent:r.body.requirement.content})).status,200);
 await check('sequential_windows_cannot_replace_same_execution_snapshot',async()=>{
  const row=await makeCase(),a=await call('PATCH',path(row)+'/execution',payload(row,'failed','窗口A实际核对失败'));
  assert.equal(a.status,200);assert.equal(a.body.case.revision,row.revision);
  const b=await call('PATCH',path(row)+'/execution',payload(row,'passed','窗口B仍持旧快照'));
  report.sequentialStatuses=[a.status,b.status];assert.equal(b.status,409);assert.equal(b.body.error,'test_execution_changed');assert.equal((await current(row)).result,'failed');
 });
 await check('parallel_writes_have_one_winner_and_one_conflict',async()=>{
  const row=await makeCase();
  const responses=await Promise.all(['failed','passed'].map(result=>call('PATCH',path(row)+'/execution',payload(row,result,'独立窗口合成登记 '+result))));
  report.parallelStatuses=responses.map(r=>r.status);assert.deepEqual(report.parallelStatuses.toSorted(),[200,409]);
  const winner=responses.find(r=>r.status===200).body.case;assert.equal((await current(row)).result,winner.result);
 });
 await check('first_not_run_write_advances_execution_token_without_changing_definition',async()=>{
  const row=await makeCase(),a=await call('PATCH',path(row)+'/execution',payload(row,'not_run',''));
  assert.equal(a.status,200);assert.equal(a.body.case.revision,1);assert.equal(a.body.case.executionRevision,1);assert.equal(a.body.case.executedAt,null);
  assert.equal((await call('PATCH',path(row)+'/execution',payload(row,'passed','旧初始快照'))).status,409);
 });
 await check('definition_change_resets_result_and_invalidates_old_execution_snapshot',async()=>{
  const row=await makeCase();const first=await call('PATCH',path(row)+'/execution',payload(row,'passed','定义1的人工核对'));assert.equal(first.status,200);
  const changed=await call('PATCH',path(row),{category:row.category,title:row.title,preconditions:row.preconditions,steps:row.steps,expected:'新的预期条件',expectedRevision:row.revision});assert.equal(changed.status,200);
  assert.equal(changed.body.case.revision,2);assert.equal(changed.body.case.executionRevision,first.body.case.executionRevision+1);assert.equal(changed.body.case.result,'not_run');
  assert.equal((await call('PATCH',path(row)+'/execution',payload(first.body.case,'failed','针对旧定义'))).status,409);
  const history=await call('GET',path(row)+'/history');assert.ok(history.body.history.some(x=>x.kind==='definition_changed'&&x.snapshot.result==='passed'));
 });
 await check('missing_execution_precondition_and_foreign_account_are_rejected',async()=>{
  const row=await makeCase();const missing=await call('PATCH',path(row)+'/execution',{result:'not_run',note:'',expectedRevision:1});assert.equal(missing.status,428);assert.equal(missing.body.error,'execution_revision_required');
  assert.equal((await call('PATCH',path(row)+'/execution',payload(row,'failed','外账号不能写'),foreign)).status,404);
  assert.equal((await call('GET',path(row),undefined,foreign)).status,404);
  assert.equal((await call('GET',path(row))).status,200);
 });
 report.status=report.checks.some(x=>x.status==='failed')?'failed':'passed';
}catch(e){report.status='failed';report.setupErrorType=e.constructor.name;process.exitCode=1;console.error('Setup failed; no configuration values printed');}
finally{await app.close();await pool.end();report.finishedAt=new Date().toISOString();await writeFile(new URL('report.json',directory),JSON.stringify(report,null,2));console.log('Report: '+fileURLToPath(new URL('report.json',directory)));}
