import {createRequire} from 'node:module';
import {randomUUID,randomBytes} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {loadConfig} from '../apps/api/dist/config.js';
import {PgProjectStore} from '../apps/api/dist/project-store.js';
import {registerProjectRoutes} from '../apps/api/dist/project-routes.js';
import {registerAgentRoutes} from '../apps/api/dist/agent/routes.js';
import {createRuntimeDatabase} from '../apps/api/dist/database.js';

// Existing dotenv configuration is consumed by the program only. Only synthetic
// records are created; no credentials, response bodies or business data are logged.
const require=createRequire(new URL('../apps/api/package.json',import.meta.url));require('dotenv').config();
const config=loadConfig();if(!config.DATABASE_URL||!['127.0.0.1','localhost','[::1]'].includes(new URL(config.DATABASE_URL).hostname))throw Error('Loopback database required');
const Fastify=require('fastify'),pool=createRuntimeDatabase(config.DATABASE_URL);
const app=Fastify({logger:false}),store=new PgProjectStore(pool);
const directory=new URL(`../.runtime/agent-recovery-${randomUUID()}/`,import.meta.url);await mkdir(directory,{recursive:true});
const report={scope:'real_local_postgresql_controlled_model_no_remote_calls',syntheticRecords:true,checks:[],startedAt:new Date().toISOString()};
let auth={},foreign={},project,requirement,stage='setup',calls=0,release,started,mode='normal';
const plan=JSON.stringify({tasks:[{key:'t1',stage:'开发',title:'合成任务',description:'用于恢复回归',deliverable:'可核对的合成产物',dependsOn:[],citations:[]}]});
await registerProjectRoutes(app,store);
await registerAgentRoutes(app,store,pool,{baseUrl:'https://example.invalid',apiKey:'fixture-only',model:'fixture',timeoutMs:1000},undefined,{complete:async()=>{calls++;if(mode==='pending'){started?.();return new Promise(resolve=>{release=()=>resolve(plan);});}return plan;}});
const call=(method,url,payload,headers=auth)=>app.inject({method,url,headers,...(payload===undefined?{}:{payload})});
async function check(name,work){stage=name;await work();report.checks.push({name,status:'passed'});console.log(`PASS ${name}`);}
try{
 await check('runtime_database_timeout_is_active_and_cancelled_statement_can_recover',async()=>{
  const client=await pool.connect();try{
   assert.equal((await client.query('SHOW statement_timeout')).rows[0].statement_timeout,'15s');
   await client.query('BEGIN');await client.query("SET LOCAL statement_timeout='10ms'");
   await assert.rejects(client.query('SELECT pg_sleep(1)'),error=>error.code==='57014');await client.query('ROLLBACK');assert.equal((await client.query('SELECT 1 AS ready')).rows[0].ready,1);
  }finally{client.release();}
 });
 await check('isolated_synthetic_accounts_project_and_confirmed_requirement',async()=>{
  for(const isForeign of [false,true]){const r=await call('POST','/auth/register',{name:'中断恢复 · 合成账号',email:`recovery-${randomUUID()}@example.test`,password:randomBytes(24).toString('base64url')},{});assert.equal(r.statusCode,201);if(isForeign)foreign={authorization:`Bearer ${r.json().token}`};else auth={authorization:`Bearer ${r.json().token}`};}
  let r=await call('POST','/projects',{name:'运行恢复 · 合成项目',description:'仅验证实际数据库状态恢复，不是真实学生数据'});assert.equal(r.statusCode,201);project=r.json().project.id;
  r=await call('POST',`/projects/${project}/requirements`,{content:'保存任务并验证中断不会伪装成功。'});assert.equal(r.statusCode,201);requirement=r.json().requirement.id;assert.equal((await call('POST',`/projects/${project}/requirements/${requirement}/confirm`,{expectedContent:r.json().requirement.content})).statusCode,200);
 });
 const base=`/projects/${project}/agent/runs`;
 await check('expired_heartbeat_recovers_running_children_but_keeps_completed_tool_evidence',async()=>{
  const r=await pool.query("INSERT INTO agent_runs(project_id,requirement_version_id,model_name,status,created_at,heartbeat_at,deadline_at) VALUES($1,$2,'fixture','running',now()-INTERVAL '5 minutes',now()-INTERVAL '2 minutes',now()+INTERVAL '5 minutes') RETURNING id",[project,requirement]);const id=r.rows[0].id;
  const done=await pool.query("INSERT INTO agent_steps(run_id,stage,status,output_summary) VALUES($1,'knowledge_search','succeeded','已完成的合成检索证据') RETURNING id",[id]);
  await pool.query("INSERT INTO agent_tool_calls(step_id,tool_name,status,input_summary,output_summary) VALUES($1,'knowledge_search','succeeded','合成输入','保留此结果')",[done.rows[0].id]);
  const active=await pool.query("INSERT INTO agent_steps(run_id,stage,status) VALUES($1,'plan_1','running') RETURNING id",[id]);await pool.query("INSERT INTO agent_tool_calls(step_id,tool_name,status,input_summary) VALUES($1,'validate_plan','running','合成未完成校验')",[active.rows[0].id]);
  assert.equal((await call('GET',base,undefined,foreign)).statusCode,404);assert.equal((await pool.query('SELECT status FROM agent_runs WHERE id=$1',[id])).rows[0].status,'running');
  const response=await call('GET',`${base}/${id}`);assert.equal(response.statusCode,200);const data=response.json();assert.equal(data.run.status,'failed');assert.equal(data.run.errorCode,'agent_interrupted');
  assert.equal(data.steps.find(row=>row.id===done.rows[0].id).tools[0].outputSummary,'保留此结果');assert.equal(data.steps.find(row=>row.id===active.rows[0].id).status,'failed');assert.equal(data.steps.find(row=>row.id===active.rows[0].id).tools[0].status,'failed');assert.equal(calls,0);
 });
 await check('total_deadline_expires_even_with_a_recent_heartbeat',async()=>{
  const r=await pool.query("INSERT INTO agent_runs(project_id,requirement_version_id,model_name,status,heartbeat_at,deadline_at) VALUES($1,$2,'fixture','running',now(),now()-INTERVAL '1 second') RETURNING id",[project,requirement]);
  const response=await call('GET',`${base}/${r.rows[0].id}`);assert.equal(response.json().run.errorCode,'agent_deadline_exceeded');assert.equal(calls,0);
 });
 await check('explicit_cancel_is_owned_and_late_model_output_cannot_resurrect_run',async()=>{
  mode='pending';const observed=new Promise(resolve=>{started=resolve;});const pending=call('POST',base,{requirementId:requirement}).then(value=>value);await observed;
  const records=(await call('GET',base)).json().runs;const running=records.find(row=>row.status==='running');assert.ok(running);
  assert.equal((await call('POST',`${base}/${running.id}/cancel`,undefined,foreign)).statusCode,404);
  assert.equal((await call('POST',`${base}/${running.id}/cancel`)).statusCode,200);
  const response=await pending;assert.equal(response.statusCode,409);assert.equal(response.json().error,'agent_cancelled');release();await new Promise(resolve=>setTimeout(resolve,20));
  const data=(await call('GET',`${base}/${running.id}`)).json();assert.equal(data.run.status,'failed');assert.equal(data.run.errorCode,'agent_cancelled');assert.equal(data.run.plan,null);assert.ok(data.steps.every(step=>step.status!=='running'));assert.equal(calls,1);
  assert.equal((await call('POST',`${base}/${running.id}/cancel`)).statusCode,200);
 });
 await check('human_restart_creates_a_new_run_and_keeps_failure_history',async()=>{
  mode='normal';const response=await call('POST',base,{requirementId:requirement});assert.equal(response.statusCode,201);assert.equal(response.json().run.status,'awaiting_review');assert.equal(calls,2);
  const rows=(await call('GET',base)).json().runs;assert.equal(rows.filter(row=>row.status==='failed').length,3);assert.equal(rows.filter(row=>row.status==='awaiting_review').length,1);
  assert.equal((await call('POST',`${base}/${response.json().run.id}/cancel`)).statusCode,409);
 });
 await check('duplicate_request_identity_never_duplicates_model_calls',async()=>{
  const before=calls,requestKey=randomUUID();const first=await call('POST',base,{requirementId:requirement,requestKey});assert.equal(first.statusCode,201);assert.equal(first.json().run.requestKey,requestKey);
  const repeat=await call('POST',base,{requirementId:requirement,requestKey});assert.equal(repeat.statusCode,409);assert.equal(repeat.json().error,'agent_request_exists');assert.equal(calls,before+1);
 });
 await check('human_plan_adoption_is_persisted_and_cannot_be_forged_by_client_metadata',async()=>{
  const run=(await call('GET',base)).json().runs.find(row=>row.status==='awaiting_review');assert.ok(run);assert.equal(run.humanReview,null);
  const url=`${base}/${run.id}/confirm`;
  assert.equal((await call('POST',url)).statusCode,428);
  assert.equal((await call('POST',url,{acknowledged:true,reviewedBy:'forged'})).statusCode,428);
  assert.equal((await call('POST',url,{acknowledged:true,note:'已核对合成需求和计划；无资料引用仍需补充'},foreign)).statusCode,404);
  const response=await call('POST',url,{acknowledged:true,note:'已核对合成需求和计划；无资料引用仍需补充'});assert.equal(response.statusCode,200);assert.equal(response.json().tasks.length,1);
  const detail=(await call('GET',`${base}/${run.id}`)).json();assert.equal(detail.run.status,'confirmed');const audit=detail.run.humanReview;
  assert.equal(audit.scope,'human_plan_adoption_not_execution_verification');assert.equal(audit.requirementVersionId,requirement);assert.match(audit.planSha256,/^[a-f0-9]{64}$/);assert.ok(audit.reviewedAt);assert.ok(audit.warningCount>0);assert.equal(audit.note,'已核对合成需求和计划；无资料引用仍需补充');
  assert.equal((await call('POST',url,{acknowledged:true,note:'重复确认不得覆盖审核'})).statusCode,409);
  assert.deepEqual((await call('GET',`${base}/${run.id}`)).json().run.humanReview,audit);
 });
}catch(error){report.checks.push({name:stage,status:'failed',errorType:error.constructor.name});console.log(`FAIL ${stage}`);console.log((error.stack??'').split('\n').filter(line=>line.includes('agent-recovery-local.mjs')).slice(0,2).join('\n'));process.exitCode=1;}
finally{release?.();for(const headers of [auth,foreign])if(headers.authorization)await call('POST','/auth/logout',undefined,headers).catch(()=>{});await app.close();await pool.end();report.finishedAt=new Date().toISOString();await writeFile(new URL('report.json',directory),JSON.stringify(report,null,2));}
