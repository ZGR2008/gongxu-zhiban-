import { createRequire } from 'node:module';
import { randomUUID,randomBytes } from 'node:crypto';
import { mkdir,writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { PgProjectStore } from '../apps/api/dist/project-store.js';
import { registerProjectRoutes } from '../apps/api/dist/project-routes.js';
import { registerPracticeRoutes } from '../apps/api/dist/practice/routes.js';
import { registerTraceRoutes } from '../apps/api/dist/trace/routes.js';
import { registerAgentRoutes } from '../apps/api/dist/agent/routes.js';
import { PgDocumentStore } from '../apps/api/dist/documents/store.js';
import { registerDocumentRoutes } from '../apps/api/dist/documents/routes.js';
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
const report={scope:'real_local_database_and_optional_local_embedding',model:'controlled_fixture_no_remote_calls',REVIEW_PLACEHOLDER_575a8dfc08a84f40bc3bRecords:true,checks:[],startedAt:new Date().toISOString()};
let stage='setup',auth={},foreign={},user,foreignUser,project,firstVersion,secondVersion,testCase;
const cases={cases:['normal','boundary','exception'].map(category=>({category,title:`合成${category}用例`,preconditions:'本机隔离回归',steps:'人工检查边界',expected:'保留审批记录'}))};
await registerProjectRoutes(app,store);
await registerPracticeRoutes(app,store,pool,{baseUrl:'https://example.invalid',apiKey:'test-only-placeholder',model:'controlled-fixture',timeoutMs:1000},{complete:async(_config,messages)=>{const key=messages[1].content.match(/REQ-[a-f0-9]{16}/)?.[0];return JSON.stringify({cases:cases.cases.map(item=>({...item,requirementIds:key?[key]:[]}))});}});
await registerTraceRoutes(app,store,pool);
await registerDocumentRoutes(app,store,new PgDocumentStore(pool));
await registerAgentRoutes(app,store,pool,{baseUrl:'https://example.invalid',apiKey:'test-only-placeholder',model:'controlled-fixture',timeoutMs:1000},undefined,{complete:async(_config,messages)=>JSON.stringify({tasks:[{key:'task1',stage:'开发',title:'合成审批任务',description:'实现审批及留档',deliverable:'可复核的审批记录',dependsOn:[],citations:[],requirementIds:[messages[1].content.match(/REQ-[a-f0-9]{16}/)[0]]}]})});
app.get('/health',async()=>({status:'ok',service:'gongxu-api'}));app.get('/ready',async()=>{await pool.query('SELECT 1');return {status:'ready'};});app.get('/ai/status',async()=>({configured:false}));
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
 await check('code_draft_concurrency_noop_and_owner_isolation_without_model',async()=>{
  const url=`${root}/code-draft`;assert.equal((await call('GET',url)).json().draft,null);
  assert.equal((await call('PUT',url,{language:'typescript',code:'missing revision'})).statusCode,428);
  let responses=await Promise.all(['const firstA = 1;','const firstB = 1;'].map(code=>call('PUT',url,{language:'typescript',code,expectedRevision:0})));
  assert.deepEqual(responses.map(row=>row.statusCode).sort(),[201,409]);
  let saved=(await call('GET',url)).json().draft;assert.equal(saved.revision,1);
  responses=await Promise.all(['const updateA = 2;','const updateB = 2;'].map(code=>call('PUT',url,{language:'javascript',code,expectedRevision:1})));
  assert.deepEqual(responses.map(row=>row.statusCode).sort(),[200,409]);saved=(await call('GET',url)).json().draft;assert.equal(saved.revision,2);
  const noop=await call('PUT',url,{language:saved.language,code:saved.code,expectedRevision:2});assert.equal(noop.statusCode,200);assert.equal(noop.json().draft.revision,2);assert.equal(noop.json().draft.updatedAt,saved.updatedAt);
  assert.equal((await call('GET',url,undefined,foreign)).statusCode,404);assert.equal((await call('PUT',url,{language:'typescript',code:'foreign',expectedRevision:2},foreign)).statusCode,404);
  assert.equal((await call('GET',`${root}/code-reviews`)).json().reviews.length,0,'Draft save must not create a model review');
 });
 await check('confirmed_requirement_and_generated_fixture_cases',async()=>{
  let response=await call('POST',`${root}/requirements`,{content:'需求版本一：审批必须留存记录。'});assert.equal(response.statusCode,201);firstVersion=response.json().requirement.id;
  assert.equal((await call('POST',`${root}/requirements/${firstVersion}/confirm`,{expectedContent:response.json().requirement.content})).statusCode,200);
  response=await call('POST',`${root}/test-cases`,{requirementId:firstVersion});assert.equal(response.statusCode,201);testCase=response.json().cases[0];assert.equal(testCase.revision,1);assert.equal(testCase.result,'not_run');
 });
 await check('trace_suggestions_require_human_review_and_never_fake_execution',async()=>{
  const run=await call('POST',`${root}/agent/runs`,{requirementId:firstVersion});assert.equal(run.statusCode,201);assert.ok(run.json().run.plan.review.warnings.some(w=>w.code==='no_source'));
  assert.equal((await call('POST',`${root}/agent/runs/${run.json().run.id}/confirm`,{acknowledged:true,note:'合成计划的人工审核登记，用于本地接口验证'})).statusCode,200);
  let response=await call('GET',`${root}/trace`);assert.equal(response.statusCode,200);let trace=response.json();assert.equal(trace.items.length,1);assert.equal(trace.links.length,4);assert.ok(trace.links.every(link=>link.origin==='model'&&link.status==='suggested'));assert.equal(trace.items[0].coverage.manualEvidence,0);
  const item=trace.items[0];
  for(const [targetKind,target] of [['task',trace.tasks[0]],['case',trace.cases.find(c=>c.id===testCase.id)]]){
   response=await call('POST',`${root}/trace/links`,{itemId:item.id,targetId:target.id,targetKind,decision:'confirmed',note:'合成审核记录，关联对应审批留档',...(targetKind==='case'?{expectedCaseRevision:target.revision}:{})});assert.equal(response.statusCode,200);
  }
  trace=(await call('GET',`${root}/trace`)).json();assert.equal(trace.items[0].coverage.confirmedTasks,1);assert.equal(trace.items[0].coverage.confirmedCases,1);assert.equal(trace.items[0].coverage.manualEvidence,0);
  assert.equal((await call('GET',`${root}/trace`,undefined,foreign)).statusCode,404);
 });
 await check('task_test_pair_requires_reviewed_sources_and_never_infers_execution',async()=>{
  const trace=(await call('GET',`${root}/trace`)).json();assert.deepEqual(trace.taskTests,[]);
  const body={itemId:trace.items[0].id,taskId:trace.tasks[0].id,caseId:testCase.id,expectedCaseRevision:1,decision:'confirmed',note:'合成配对审核：检查审批任务的持久化结果'};
  const unreviewed=trace.cases.find(row=>row.id!==testCase.id);
  assert.equal((await call('POST',`${root}/trace/task-tests`,{...body,caseId:unreviewed.id})).json().error,'trace_source_review_required');
  assert.equal((await call('POST',`${root}/trace/task-tests`,body,foreign)).statusCode,404);
  const before=(await call('GET',`${root}/evidence`)).json().evidence.traceRevision;
  assert.equal((await call('POST',`${root}/trace/task-tests`,body)).statusCode,200);
  const current=(await call('GET',`${root}/trace`)).json();assert.equal(current.taskTests.length,1);assert.equal(current.taskTests[0].evidence.state,'not_run');assert.equal(current.taskTests[0].evidence.manualEvidence,false);
  assert.ok((await call('GET',`${root}/evidence`)).json().evidence.traceRevision>before);
 });
 await check('editing_invalidates_current_result_but_retains_previous_evidence',async()=>{
  const url=`${root}/test-cases/${testCase.id}`;
  let response=await call('PATCH',url+'/execution',{result:'passed',note:'合成人工记录：仅用于验证历史留存，不代表执行了示例代码',expectedRevision:1,expectedExecutionRevision:0});assert.equal(response.statusCode,200);
  assert.equal((await call('GET',`${root}/trace`)).json().items[0].coverage.manualEvidence,1);
  assert.equal((await call('GET',`${root}/trace`)).json().taskTests[0].evidence.manualEvidence,true);
  const {category,title,preconditions,steps}=testCase;
  const beforeHistory=(await call('GET',url+'/history')).json().history.length;
  response=await call('PATCH',url,{category,title,preconditions,steps,expected:testCase.expected,expectedRevision:1});assert.equal(response.statusCode,200);assert.equal(response.json().case.result,'passed');assert.equal(response.json().case.revision,1);assert.equal((await call('GET',url+'/history')).json().history.length,beforeHistory);
  assert.equal((await call('PATCH',url+'/execution',{result:'failed',note:'缺少修订不能覆盖'})).statusCode,428);
  assert.equal((await call('PATCH',url+'/execution',{result:'passed',note:'  ',expectedRevision:1,expectedExecutionRevision:1})).statusCode,422);
  response=await call('PATCH',url,{category,title,preconditions,steps,expected:'新版必须双人审批',expectedRevision:1});assert.equal(response.statusCode,200);assert.equal(response.json().case.revision,2);assert.equal(response.json().case.result,'not_run');
  const trace=(await call('GET',`${root}/trace`)).json();assert.equal(trace.items[0].coverage.manualEvidence,0);assert.equal(trace.items[0].coverage.stale,1);
  assert.equal(trace.taskTests[0].evidence.state,'stale_case');assert.equal(trace.taskTests[0].evidence.manualEvidence,false);
  const history=(await call('GET',url+'/history')).json().history;assert.ok(history.some(row=>row.kind==='definition_changed'&&row.snapshot.result==='passed'&&row.snapshot.execution_note.includes('合成人工记录')));
  response=await call('PATCH',url+'/execution',{result:'passed',note:'旧定义的迟到记录',expectedRevision:1,expectedExecutionRevision:1});assert.equal(response.statusCode,409);
 });
 await check('pair_recheck_preserves_previous_review_and_never_inherits_old_pass',async()=>{
  let trace=(await call('GET',`${root}/trace`)).json();const pair=trace.taskTests[0];const body={itemId:pair.itemId,taskId:pair.taskId,caseId:pair.caseId,expectedCaseRevision:2,decision:'confirmed',note:'变更后人工重新核对双人审批验收方法'};
  assert.equal((await call('POST',`${root}/trace/task-tests`,body)).statusCode,409);
  assert.equal((await call('POST',`${root}/trace/links`,{itemId:pair.itemId,targetId:pair.caseId,targetKind:'case',expectedCaseRevision:2,decision:'confirmed',note:'新定义涵盖双人审批'})).statusCode,200);
  assert.equal((await call('POST',`${root}/trace/task-tests`,{...body,expectedCaseRevision:1})).json().error,'test_case_changed');
  assert.equal((await call('POST',`${root}/trace/task-tests`,body)).statusCode,200);
  trace=(await call('GET',`${root}/trace`)).json();assert.equal(trace.taskTests[0].evidence.state,'not_run');assert.equal(trace.taskTests[0].caseRevision,2);assert.equal(trace.taskTestHistory.length,1);assert.equal(trace.taskTestHistory[0].snapshot.case_revision,1);
 });
 await check('foreign_account_cannot_read_or_write_execution_evidence',async()=>{
  const url=`${root}/test-cases/${testCase.id}`;assert.equal((await call('GET',url+'/history',undefined,foreign)).statusCode,404);assert.equal((await call('PATCH',url+'/execution',{result:'passed',note:'越权合成请求',expectedRevision:2},foreign)).statusCode,404);
 });
 await check('current_version_statistics_do_not_inherit_historical_passes',async()=>{
  const response=await call('POST',`${root}/requirements`,{content:'需求版本二：审批必须由两人确认，并保留原记录。\n失败必须回滚，不能产生重复审批记录。\n普通学生不得查看其他人的审批材料。\n验收时必须提供操作步骤、结果及对应版本。'});assert.equal(response.statusCode,201);secondVersion=response.json().requirement.id;
  assert.equal((await call('POST',`${root}/requirements/${secondVersion}/confirm`,{expectedContent:response.json().requirement.content})).statusCode,200);
  assert.equal((await call('GET',`${root}/test-cases`)).json().cases.length,0);
  assert.equal((await call('GET',`${root}/test-cases?requirementVersionId=${firstVersion}`)).json().cases.length,3);
  assert.equal((await call('POST',`${root}/test-cases`,{requirementId:secondVersion})).statusCode,201);
  const context=await new PgDocumentStore(pool).getContext(user,project,secondVersion);assert.equal(context.testCounts.total,3);assert.equal(context.testCounts.notRun,3);assert.equal(context.testCounts.passed,0);
 });
 await check('trace_version_change_impact_is_reviewed_without_copying_evidence',async()=>{
  let trace=(await call('GET',`${root}/trace`)).json();assert.equal(trace.version.id,secondVersion);assert.equal(trace.items[0].coverage.manualEvidence,0);assert.equal(trace.items[0].coverage.confirmedTasks,0);assert.equal(trace.impact.historicalAssets.tasks,1);assert.equal(trace.impact.historicalAssets.cases,3);
  const itemId=trace.items[0].id,predecessorId=trace.previousItems[0].id;
  assert.equal((await call('POST',`${root}/trace/links`,{itemId,targetId:testCase.id,targetKind:'case',expectedCaseRevision:2,decision:'confirmed',note:'不能使用旧版本用例'})).statusCode,404);
  assert.equal((await call('POST',`${root}/trace/change-review`,{itemId,predecessorId,note:'原审批修改为双人审批，须重新验收'})).statusCode,200);
  trace=(await call('GET',`${root}/trace`)).json();assert.equal(trace.items[0].change,'changed_reviewed');assert.equal(trace.items[0].coverage.manualEvidence,0);
  assert.equal((await call('POST',`${root}/trace/change-review`,{itemId,predecessorId,note:'越权变更关系'},foreign)).statusCode,404);
  const old=(await call('GET',`${root}/trace?requirementVersionId=${firstVersion}`)).json();assert.equal(old.version.current,false);assert.ok(old.history.length>=2);
  assert.equal(trace.taskTests.length,0);const pair=old.taskTests[0];assert.equal((await call('POST',`${root}/trace/task-tests`,{itemId:pair.itemId,taskId:pair.taskId,caseId:pair.caseId,expectedCaseRevision:2,decision:'confirmed',note:'不能把旧需求关联当作当前验证'})).json().error,'trace_version_outdated');
 });
 await check('cross_project_trace_target_rejected_even_for_same_owner',async()=>{
  let response=await call('POST','/projects',{name:'追踪隔离 · 第二个合成项目',description:'仅验证同一账号的项目边界'});assert.equal(response.statusCode,201);const otherRoot=`/projects/${response.json().project.id}`;
  response=await call('POST',`${otherRoot}/requirements`,{content:'其他项目必须单独验收'});assert.equal(response.statusCode,201);const otherRequirement=response.json().requirement.id;
  assert.equal((await call('POST',`${otherRoot}/requirements/${otherRequirement}/confirm`,{expectedContent:response.json().requirement.content})).statusCode,200);
  response=await call('POST',`${otherRoot}/test-cases`,{requirementId:otherRequirement});assert.equal(response.statusCode,201);const otherCase=response.json().cases[0];
  const trace=(await call('GET',`${root}/trace`)).json();
  assert.equal((await call('POST',`${root}/trace/links`,{itemId:trace.items[0].id,targetId:otherCase.id,targetKind:'case',expectedCaseRevision:otherCase.revision,decision:'confirmed',note:'禁止跨项目关联'})).statusCode,404);
 });
 await check('document_concurrent_writes_preserve_history_and_reject_stale_revision',async()=>{
  const docs=new PgDocumentStore(pool);
  const original=await docs.create(user,project,secondVersion,'readme','合成原文：用于验证并发修订','manual-fixture');assert.equal(original.revision,1);
  const url=`${root}/documents/${original.id}`;
  assert.equal((await call('PATCH',url,{content:'没有修订不能写入'})).statusCode,428);
  const responses=await Promise.all(['并发写入甲','并发写入乙'].map(content=>call('PATCH',url,{content,expectedRevision:1})));
  assert.deepEqual(responses.map(row=>row.statusCode).sort(),[200,409]);
  const saved=(await call('GET',url)).json().document;assert.equal(saved.revision,2);assert.ok(['并发写入甲','并发写入乙'].includes(saved.content));
  let history=(await call('GET',url+'/history')).json();assert.equal(history.history.length,1);assert.equal(history.history[0].content,original.content);assert.equal(history.history[0].revision,1);
  assert.equal((await call('PATCH',url,{content:saved.content,expectedRevision:2})).json().document.revision,2);
  assert.equal((await call('PATCH',url,{content:original.content,expectedRevision:2})).json().document.revision,3);
  history=(await call('GET',url+'/history')).json();assert.deepEqual(history.history.map(row=>row.revision),[2,1]);assert.equal(history.history[0].content,saved.content);
  assert.equal((await call('GET',url+'/history?beforeRevision=2')).json().history.length,1);
  for(const suffix of ['', '/history', '/export'])assert.equal((await call('GET',url+suffix,undefined,foreign)).statusCode,404);
  assert.equal((await call('PATCH',url,{content:'越权覆盖',expectedRevision:3},foreign)).statusCode,404);
 });
 if(process.argv.includes('--browser')){
  await check('real_database_desktop_trace_review_keyboard_and_layout',async()=>{
   const apiAddress=await app.listen({host:'127.0.0.1',port:0});
   const {checkLocalDesktop}=await import('./local-desktop-check.mjs');report.desktop=await checkLocalDesktop({apiAddress,authorization:auth.authorization,projectId:project,directory});
  });
 }
 await check('document_source_snapshot_detects_same_version_changes_without_rewriting_document',async()=>{
  const docs=new PgDocumentStore(pool),context=await docs.getContext(user,project,secondVersion);
  const original=await docs.create(user,project,secondVersion,'test_report','合成测试报告，依据读取时未执行记录','controlled-fixture',context.snapshot);
  assert.equal(original.sourceSnapshot.caseRevision,context.snapshot.caseRevision);
  const initial=(await call('GET',`${root}/evidence`)).json().evidence;assert.equal(initial.documentRevision,context.snapshot.documentRevision+1);
  await call('GET',`${root}/trace`);const afterRead=(await call('GET',`${root}/evidence`)).json().evidence;assert.equal(afterRead.traceRevision,initial.traceRevision);
  const currentCase=(await call('GET',`${root}/test-cases`)).json().cases[0];
  assert.equal((await call('PATCH',`${root}/test-cases/${currentCase.id}/execution`,{result:'blocked',note:'合成故障：环境不可用，未执行',expectedRevision:currentCase.revision,expectedExecutionRevision:currentCase.executionRevision})).statusCode,200);
  const changed=(await call('GET',`${root}/documents/${original.id}`)).json();assert.equal(changed.evidence.caseRevision,initial.caseRevision+1);assert.equal(changed.document.sourceSnapshot.caseRevision,initial.caseRevision);assert.equal(changed.document.content,original.content);
  const trace=(await call('GET',`${root}/trace`)).json();
  assert.equal((await call('POST',`${root}/trace/links`,{itemId:trace.items[0].id,targetId:currentCase.id,targetKind:'case',expectedCaseRevision:currentCase.revision,decision:'confirmed',note:'合成核对，仍没有通过执行证据'})).statusCode,200);
  const reviewed=(await call('GET',`${root}/evidence`)).json().evidence;assert.equal(reviewed.traceRevision,changed.evidence.traceRevision+1);
  const edit=await call('PATCH',`${root}/documents/${original.id}`,{content:'人工改写合成报告，来源记录仍保留',expectedRevision:1});assert.equal(edit.statusCode,200);assert.deepEqual(edit.json().document.sourceSnapshot,original.sourceSnapshot);assert.equal(edit.json().evidence.documentRevision,reviewed.documentRevision+1);
  assert.equal((await call('GET',`${root}/evidence`,undefined,foreign)).statusCode,404);
 });
 await check('document_context_and_source_counters_share_one_database_snapshot',async()=>{
  const before=(await call('GET',`${root}/evidence`)).json().evidence;
  const currentCase=(await call('GET',`${root}/test-cases`)).json().cases[0];let interleaved=false;
  const wrapper={connect:async()=>{const client=await pool.connect();return {release:()=>client.release(),query:async(sql,values)=>{
   const result=await client.query(sql,values);
   if(sql.includes('FROM practice_test_cases c JOIN projects p')&&!interleaved){interleaved=true;await pool.query("UPDATE practice_test_cases SET result='passed',execution_note='合成并发登记，不代表自动执行',executed_at=now() WHERE id=$1 AND project_id=$2",[currentCase.id,project]);}
   return result;
  }};}};
  const context=await new PgDocumentStore(wrapper).getContext(user,project,secondVersion);assert.equal(interleaved,true);assert.equal(context.testCounts.passed,0);assert.equal(context.snapshot.caseRevision,before.caseRevision);
  const after=await new PgDocumentStore(pool).getContext(user,project,secondVersion);assert.equal(after.testCounts.passed,1);assert.equal(after.snapshot.caseRevision,before.caseRevision+1);
 });
 await check('trace_pairs_and_case_results_share_one_read_snapshot',async()=>{
  const generated=await call('POST',`${root}/agent/runs`,{requirementId:secondVersion});assert.equal(generated.statusCode,201);
  const adopted=await call('POST',`${root}/agent/runs/${generated.json().run.id}/confirm`,{acknowledged:true,note:'合成并发快照回归'});assert.equal(adopted.statusCode,200);
  const task=adopted.json().tasks[0],before=(await call('GET',`${root}/trace`)).json(),item=before.items[0],test=before.cases.find(c=>c.result==='passed');assert.ok(test);
  const review=async revision=>{
   for(const [targetKind,targetId] of [['task',task.id],['case',test.id]])assert.equal((await call('POST',`${root}/trace/links`,{itemId:item.id,targetKind,targetId,decision:'confirmed',note:'合成快照核对',...(targetKind==='case'?{expectedCaseRevision:revision}:{})})).statusCode,200);
   assert.equal((await call('POST',`${root}/trace/task-tests`,{itemId:item.id,taskId:task.id,caseId:test.id,expectedCaseRevision:revision,decision:'confirmed',note:'合成任务与用例快照关系'})).statusCode,200);
  };
  await review(test.revision);
  let changed=false,release;const changedGate=new Promise(resolve=>release=resolve);
  const query=async(db,sql,values)=>{
   if(sql.startsWith('SELECT id,item_id')&&sql.includes('FROM task_test_links'))await changedGate;
   const result=await db.query(sql,values);
   if(sql.startsWith('SELECT id,title,revision,result')&&!changed){
    changed=true;
    try{
     const updated=await pool.query('UPDATE practice_test_cases SET expected=expected || $2 WHERE id=$1 RETURNING revision',[test.id,'；合成并发追加验收条件']);assert.equal(updated.rows[0].revision,test.revision+1);
     await review(updated.rows[0].revision);
    }finally{release();}
   }
   return result;
  };
  const wrapped={query:(sql,values)=>query(pool,sql,values),connect:async()=>{const client=await pool.connect();return {query:(sql,values)=>query(client,sql,values),release:()=>client.release()};}};
  const probe=Fastify({logger:false});await registerTraceRoutes(probe,store,wrapped);
  try{
   const response=await probe.inject({method:'GET',url:`${root}/trace`,headers:auth});assert.equal(response.statusCode,200);assert.equal(changed,true);
   const captured=response.json(),pair=captured.taskTests.find(p=>p.taskId===task.id&&p.caseId===test.id);
   assert.equal(captured.cases.find(c=>c.id===test.id).revision,test.revision);
   assert.equal(pair.caseRevision,test.revision,'A trace response must not combine an older case with a newer pairing.');
   assert.equal(pair.evidence.manualEvidence,true);
   const next=(await call('GET',`${root}/trace`)).json(),nextPair=next.taskTests.find(p=>p.taskId===task.id&&p.caseId===test.id);
   assert.equal(nextPair.caseRevision,test.revision+1);assert.equal(nextPair.evidence.manualEvidence,false);assert.equal(nextPair.evidence.state,'not_run');
  }finally{release();await probe.close();}
 });
 await check('task_test_pairing_rejects_foreign_project_targets_of_same_owner',async()=>{
  const other=(await pool.query('SELECT c.id,c.revision,c.project_id AS project,c.requirement_version_id AS requirement FROM practice_test_cases c JOIN projects p ON p.id=c.project_id WHERE p.owner_id=$1 AND p.id<>$2 LIMIT 1',[user,project])).rows[0];assert.ok(other);
  const otherRoot=`/projects/${other.project}`,run=await call('POST',`${otherRoot}/agent/runs`,{requirementId:other.requirement});assert.equal(run.statusCode,201);
  const adopted=await call('POST',`${otherRoot}/agent/runs/${run.json().run.id}/confirm`,{acknowledged:true,note:'合成另一项目的隔离验证'});assert.equal(adopted.statusCode,200);
  const before=(await call('GET',`${root}/trace`)).json(),pair=before.taskTests.at(-1);
  const body={itemId:pair.itemId,taskId:pair.taskId,caseId:pair.caseId,expectedCaseRevision:pair.caseRevision,decision:'confirmed',note:'禁止同账号跨项目配对'};
  assert.equal((await call('POST',`${root}/trace/task-tests`,{...body,caseId:other.id,expectedCaseRevision:other.revision})).statusCode,404);
  assert.equal((await call('POST',`${root}/trace/task-tests`,{...body,taskId:adopted.json().tasks[0].id})).statusCode,404);
  const after=(await call('GET',`${root}/trace`)).json();assert.deepEqual(after.taskTests,before.taskTests);assert.deepEqual(after.taskTestHistory,before.taskTestHistory);
 });
 await check('trace_version_change_during_preparation_requires_refresh',async()=>{
  const draft=await store.createRequirement(user,project,'合成第三版：审批更新，需要重新验证。');let changed=false;
  const wrapped={query:async(sql,values)=>{const result=await pool.query(sql,values);if(!changed&&sql.startsWith('INSERT INTO trace_links')&&sql.includes('FROM practice_test_cases')){changed=true;await store.confirmRequirement(user,project,draft.id,draft.content);}return result;},connect:()=>pool.connect()};
  const probe=Fastify({logger:false});await registerTraceRoutes(probe,store,wrapped);
  try{
   const response=await probe.inject({method:'GET',url:`${root}/trace`,headers:auth});assert.equal(changed,true);assert.equal(response.statusCode,409);assert.equal(response.json().error,'trace_refresh_required');
   const refreshed=(await call('GET',`${root}/trace`)).json();assert.equal(refreshed.version.id,draft.id);assert.equal(refreshed.version.current,true);assert.equal(refreshed.items.length,1);
   const historical=(await call('GET',`${root}/trace?requirementVersionId=${secondVersion}`)).json();assert.equal(historical.version.current,false);assert.ok(historical.taskTests.length);
  }finally{await probe.close();}
 });
 await check('trace_snapshot_query_failure_releases_connection_and_recovers',async()=>{
  let released=0,rolledBack=false;
  const wrapped={query:(sql,values)=>pool.query(sql,values),connect:async()=>{const client=await pool.connect();return {query:(sql,values)=>{if(sql.startsWith('SELECT id,version FROM requirement_versions'))throw Error('controlled_read_failure');if(sql==='ROLLBACK')rolledBack=true;return client.query(sql,values);},release:()=>{released++;client.release();}};}};
  const probe=Fastify({logger:false});await registerTraceRoutes(probe,store,wrapped);
  try{assert.equal((await probe.inject({method:'GET',url:`${root}/trace`,headers:auth})).statusCode,500);assert.equal(released,1);assert.equal(rolledBack,true);assert.equal((await call('GET',`${root}/trace`)).statusCode,200);}finally{await probe.close();}
 });
 await check('change_review_cannot_overtake_an_earlier_requirement_confirmation',async()=>{
  const trace=(await call('GET',`${root}/trace`)).json(),item=trace.items[0],predecessor=trace.previousItems[0];assert.ok(item&&predecessor);
  const next=await store.createRequirement(user,project,'合成第四版：并发确认优先，旧变更登记必须拒绝。');
  const blocker=await pool.connect();await blocker.query('BEGIN');await blocker.query('SELECT id FROM projects WHERE id=$1 FOR UPDATE',[project]);
  let confirmationPid,reviewIssued;const reviewGate=new Promise(resolve=>reviewIssued=resolve);
  const confirmationPool={query:(sql,values)=>pool.query(sql,values),connect:async()=>{const client=await pool.connect();confirmationPid=client.processID;return client;}};
  const wrapped={query:(sql,values)=>{const result=pool.query(sql,values);if(sql.startsWith('UPDATE requirement_items'))reviewIssued();return result;},connect:async()=>{const client=await pool.connect();return {query:(sql,values)=>{const result=client.query(sql,values);if(sql.includes('FROM projects')&&sql.includes('FOR UPDATE'))reviewIssued();return result;},release:()=>client.release()};}};
  const confirmation=Fastify({logger:false}),review=Fastify({logger:false});await registerProjectRoutes(confirmation,new PgProjectStore(confirmationPool));await registerTraceRoutes(review,store,wrapped);
  let pendingConfirmation,pendingReview;
  try{
   pendingConfirmation=confirmation.inject({method:'POST',url:`${root}/requirements/${next.id}/confirm`,headers:auth,payload:{expectedContent:next.content}}).then(r=>r);
   const deadline=Date.now()+3000;let waiting=false;
   while(Date.now()<deadline){if(confirmationPid){const state=await pool.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1',[confirmationPid]);if(state.rows[0]?.wait_event_type==='Lock'){waiting=true;break;}}await new Promise(r=>setTimeout(r,10));}
   assert.equal(waiting,true,'The earlier confirmation must be waiting for the project lock.');
   pendingReview=review.inject({method:'POST',url:`${root}/trace/change-review`,headers:auth,payload:{itemId:item.id,predecessorId:predecessor.id,note:'不应越过更早的需求确认'}}).then(r=>r);
   await Promise.race([reviewGate,new Promise((_,reject)=>setTimeout(()=>reject(Error('review_not_issued')),3000))]);
   assert.equal(await Promise.race([pendingReview.then(()=> 'completed'),new Promise(resolve=>setTimeout(()=>resolve('pending'),150))]),'pending','The later review must share the project lock, not update an about-to-be-historical version.');
   await blocker.query('COMMIT');assert.equal((await pendingConfirmation).statusCode,200);assert.equal((await pendingReview).statusCode,409);
   const stored=(await pool.query('SELECT predecessor_id,change_review_note FROM requirement_items WHERE id=$1',[item.id])).rows[0];assert.equal(stored.predecessor_id,item.predecessorId);assert.notEqual(stored.change_review_note,'不应越过更早的需求确认');
  }finally{await blocker.query('ROLLBACK');blocker.release();await Promise.allSettled([pendingConfirmation,pendingReview].filter(Boolean));await confirmation.close();await review.close();}
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
}catch(error){report.checks.push({name:stage,status:'failed',errorType:error.constructor.name});console.log(`FAIL ${stage}`);console.log((error.stack??'').split('\n').filter(line=>line.includes('reliability-local.mjs')).slice(0,2).join('\n'));process.exitCode=1;}
finally{for(const headers of [auth,foreign])if(headers.authorization)await call('POST','/auth/logout',undefined,headers).catch(()=>{});await app.close();await pool.end();report.finishedAt=new Date().toISOString();await writeFile(new URL('report.json',directory),JSON.stringify(report,null,2));}
