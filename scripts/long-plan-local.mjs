// Isolated PostgreSQL + actual HTTP routes. All generated answers are labeled
// deterministic protocol fixtures; never imports AI configuration or makes fees.
import {createRequire} from 'node:module';import {randomUUID,randomBytes} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';import assert from 'node:assert/strict';
import {loadConfig} from '../apps/api/dist/config.js';import {PgProjectStore} from '../apps/api/dist/project-store.js';
import {registerProjectRoutes} from '../apps/api/dist/project-routes.js';import {registerLongPlanRoutes} from '../apps/api/dist/long-plan/routes.js';
import {AiError} from '../apps/api/dist/ai/model.js';import {hash} from '../apps/api/dist/long-plan/domain.js';
import {sourceProvenance} from '../evaluation/source-provenance.mjs';
import {longBusinessCase} from '../evaluation/long-business-cases.mjs';
import {registerAgentRoutes} from '../apps/api/dist/agent/routes.js';
import {registerTraceRoutes} from '../apps/api/dist/trace/routes.js';
const require=createRequire(new URL('../apps/api/package.json',import.meta.url));require('dotenv').config({path:fileURLToPath(new URL('../apps/api/.env',import.meta.url))});const config=loadConfig();
const local=url=>['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname);
if(!config.DATABASE_URL||!local(config.DATABASE_URL))throw Error('Existing local database required');
const {Pool}=require('pg'),Fastify=require('fastify'),admin=new Pool({connectionString:config.DATABASE_URL,connectionTimeoutMillis:3000});
const name='gx_long_v5_'+randomUUID().replaceAll('-','');assert.match(name,/^gx_long_v5_[a-f0-9]{32}$/);const dest=new URL(config.DATABASE_URL);dest.pathname='/'+name;
const out=new URL(`../.runtime/long-plan-local-${randomUUID()}/`,import.meta.url);await mkdir(out,{recursive:true});
const report={scope:'isolated_real_postgresql_actual_http_model_protocol_fixtures',...sourceProvenance(new URL('../',import.meta.url)),startedAt:new Date().toISOString(),paidModelCalls:0,checks:[],retainedSyntheticDatabase:name};
const originalFetch=globalThis.fetch;globalThis.fetch=(input,options)=>{if(!local(input instanceof Request?input.url:String(input)))throw Error('External calls forbidden');return originalFetch(input,options);};
let pool,app,origin,worker,user,other,stubCalls=0,mode='normal',lastPayload;const ai={baseUrl:'https://model.invalid',apiKey:'synthetic-only',model:'protocol-fixture',timeoutMs:1000,maxOutputTokens:4096};
const complete=async(_config,messages,_fetcher,options)=>{
 stubCalls++;lastPayload=JSON.parse(messages[1].content);
 if(mode==='timeout')throw new AiError('ai_timeout');if(mode==='429')throw new AiError('ai_rate_limited');
 if(mode==='hold')return new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(new AiError('ai_cancelled')),{once:true}));
 const ids=lastPayload.conditions.map(c=>c.key),output={tasks:[{key:'T1',stage:'实现',title:'核对本段业务约束',description:'按原文实现权限、状态与异常处理，人工补充业务细节。',deliverable:'使用对应条件的正常与拒绝输入核对记录；这是协议替身的验收建议。',dependsOn:[],conditionIds:ids,citations:[]}],fragments:ids.map(id=>({conditionId:id,taskKeys:['T1'],note:'协议替身将完整条件映射到候选任务；不是模型质量结果。'})),unresolved:[]};
 return {content:mode==='invalid'?'{}':JSON.stringify(output),usage:{inputTokens:10,outputTokens:8,totalTokens:18,cacheHitTokens:null,cacheMissTokens:null,reasoningTokens:null},finishReason:'stop',durationMs:1};
};
async function start(){app=Fastify();const store=new PgProjectStore(pool);await registerProjectRoutes(app,store);await registerAgentRoutes(app,store,pool);await registerTraceRoutes(app,store,pool);app.get('/health',async()=>({status:'ok',service:'gongxu-api'}));app.get('/ready',async()=>{await pool.query('SELECT 1');return {status:'ready'};});app.get('/ai/status',async()=>({configured:false}));worker=await registerLongPlanRoutes(app,store,pool,ai,undefined,{complete});origin=await app.listen({host:'127.0.0.1',port:0});}
async function call(method,path,data,identity=user){const r=await fetch(new URL(path,origin),{method,redirect:'error',headers:{...(identity?{authorization:'Bearer '+identity.token}:{}),...(data?{'content-type':'application/json'}:{})},body:data?JSON.stringify(data):undefined,signal:AbortSignal.timeout(20000)});return {status:r.status,body:await r.json()};}
const ok=(r,status=200)=>{assert.equal(r.status,status,JSON.stringify(r.body).slice(0,300));return r.body;};
async function check(name,run){await run();report.checks.push({name,status:'passed'});console.log('PASS '+name);}
async function setup(source='学生申请借用设备😀。\n教师检查库存后才能批准。\n末尾禁止申请人自批。'){
 const project=ok(await call('POST','/projects',{name:'分段规划合成 '+randomUUID().slice(0,5),description:'隔离协议检查，不代表真实模型质量'}),201).project.id;
 const root=`/projects/${project}`,version=ok(await call('POST',root+'/requirements',{content:source}),201).requirement.id;
 ok(await call('POST',`${root}/requirements/${version}/confirm`,{expectedContent:source}));
 const schemePath=`${root}/requirements/${version}/planning-scheme`;let scheme=ok(await call('GET',schemePath));scheme.scheme.conditions.forEach(c=>{c.kind='acceptance';c.crossNote='跨段含义需要全局合并人工核对';});
 // force a real multi-part run without ever splitting a Unicode surrogate pair
 const boundary=source.indexOf('\n')+1;if(boundary>0)scheme.scheme.boundaries=[boundary,source.length];
 if(source.length>6000)scheme.scheme.boundaries=ok(await call('GET',schemePath)).scheme.boundaries;
 scheme=ok(await call('PUT',schemePath,{expectedRevision:scheme.revision,scheme:scheme.scheme}));
 scheme=ok(await call('POST',schemePath+'/review',{expectedRevision:scheme.revision,note:'逐条检查原文范围、分类与跨段含义；只是协议夹具审核。',acknowledged:true}));
 return {project,root,version,schemePath,scheme};
}
async function create(f,key=randomUUID()){const result=await call('POST',f.root+'/long-plans',{versionId:f.version,schemeRevision:f.scheme.revision,requestKey:key,acknowledgeExternalCall:true});ok(result,202);return result.body.job.id;}
async function read(f,id){return ok(await call('GET',f.root+'/long-plans/'+id));}
async function waitFor(f,id,predicate){for(let i=0;i<100;i++){const d=await read(f,id);if(predicate(d))return d;await new Promise(r=>setTimeout(r,20));}throw Error('State deadline');}
async function review(f,id){let d=await read(f,id);return ok(await call('POST',`${f.root}/long-plans/${id}/review`,{expectedRevision:d.job.revision,note:'合成协议验收人工入口：结构映射不代表实际测试通过。',acknowledged:true,resolutions:d.audit.warnings.map(w=>({key:w.key,decision:'accepted_limitation',note:'这是合成协议夹具，人工质量审核在真实评测中仍待完成。'}))}));}
try{
 assert.equal((await admin.query('SELECT rolcreatedb OR rolsuper AS allowed FROM pg_roles WHERE rolname=current_user')).rows[0].allowed,true);
 await admin.query(`CREATE DATABASE ${name} TEMPLATE template0`);
 await promisify(execFile)(process.execPath,[fileURLToPath(new URL('../apps/api/dist/migrate.js',import.meta.url))],{cwd:fileURLToPath(new URL('../apps/api/',import.meta.url)),env:{...process.env,DATABASE_URL:dest.href},timeout:30000,maxBuffer:128000,windowsHide:true});
 pool=new Pool({connectionString:dest.href,max:8,connectionTimeoutMillis:3000,statement_timeout:15000});await start();
 for(const i of [0,1]){const r=ok(await call('POST','/auth/register',{name:'分段验收合成',email:`long-${randomUUID()}@example.test`,password:randomBytes(24).toString('base64url')},null),201);if(i)other=r;else user=r;}
 let f=await setup(),id,d;
 await check('scheme_full_source_hash_review_conflict_and_history',async()=>{
  assert.equal(f.scheme.source_hash,hash(f.scheme.source_content));assert.equal(f.scheme.audit.errors.length,0);
  assert.equal((await call('PUT',f.schemePath,{expectedRevision:1,scheme:f.scheme.scheme})).status,409);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM long_plan_scheme_history WHERE scheme_id=$1',[f.scheme.id])).rows[0].n,2);
 });
 await check('double_click_creates_one_job_and_actual_fragment_outputs_not_only_ids',async()=>{
  const body={versionId:f.version,schemeRevision:f.scheme.revision,requestKey:randomUUID(),acknowledgeExternalCall:true};const rs=await Promise.all([call('POST',f.root+'/long-plans',body),call('POST',f.root+'/long-plans',body)]);assert.deepEqual(rs.map(r=>r.status).sort(),[200,202]);assert.equal(rs[0].body.job.id,rs[1].body.job.id);id=rs[0].body.job.id;await worker.idle();d=await read(f,id);assert.equal(d.job.status,'awaiting_review');assert.equal(d.parts.length,2);assert.equal(d.attempts.length,2);assert.ok(d.parts.every(p=>p.result.tasks[0].deliverable.length>6));assert.ok(d.attempts.at(-1).request_snapshot.messages[1].content.includes('禁止申请人自批'));assert.equal(d.audit.errors.length,0);
 });
 await check('cross_account_and_unreviewed_adoption_are_rejected',async()=>{assert.equal((await call('GET',`${f.root}/long-plans/${id}`,undefined,other)).status,404);assert.equal((await call('POST',`${f.root}/long-plans/${id}/adopt`,{expectedRevision:d.job.revision,acknowledged:true})).status,409);});
 await check('merge_omission_blocks_review_and_revision_keeps_prior_draft',async()=>{
  const original=d.job.merge_draft;let edited=ok(await call('PUT',`${f.root}/long-plans/${id}/merge`,{expectedRevision:d.job.revision,draft:{tasks:[original.tasks[0]]},note:'删除末段任务暴露遗漏，稍后恢复原始候选'}));assert.ok(edited.audit.errors.some(e=>e.code==='condition_omitted'));assert.equal((await call('POST',`${f.root}/long-plans/${id}/review`,{expectedRevision:edited.job.revision,note:'此处不应通过有条件遗漏的草案',acknowledged:true,resolutions:[]})).status,422);
  d=ok(await call('PUT',`${f.root}/long-plans/${id}/merge`,{expectedRevision:edited.job.revision,draft:original,note:'完整恢复之前的候选，旧草案仍有历史记录'}));assert.equal((await call('PUT',`${f.root}/long-plans/${id}/merge`,{expectedRevision:edited.job.revision,draft:original,note:'旧窗口不得覆盖新的已保存结果'})).status,409);
 });
 await check('human_review_and_concurrent_adoption_create_tasks_once_without_verification',async()=>{
  d=await review(f,id);const b={expectedRevision:d.job.revision,acknowledged:true};const rs=await Promise.all([call('POST',`${f.root}/long-plans/${id}/adopt`,b),call('POST',`${f.root}/long-plans/${id}/adopt`,b)]);rs.forEach(r=>ok(r));assert.equal(rs[0].body.runId,rs[1].body.runId);const tasks=(await pool.query('SELECT status FROM tasks WHERE agent_run_id=$1',[rs[0].body.runId])).rows;assert.equal(tasks.length,2);assert.ok(tasks.every(t=>t.status==='todo'));assert.equal((await pool.query('SELECT count(*)::int AS n FROM practice_test_cases')).rows[0].n,0);
 });
 await check('scheme_edit_invalidates_review_and_old_job_cannot_be_adopted',async()=>{f=await setup();id=await create(f);await worker.idle();d=await review(f,id);const edited=ok(await call('PUT',f.schemePath,{expectedRevision:f.scheme.revision,scheme:f.scheme.scheme}));assert.equal(edited.reviewed_revision,null);assert.equal((await call('POST',`${f.root}/long-plans/${id}/adopt`,{expectedRevision:d.job.revision,acknowledged:true})).body.error,'scheme_revision_changed');});
 await check('requirement_replacement_blocks_old_job_adoption',async()=>{f=await setup();id=await create(f);await worker.idle();d=await review(f,id);const next=ok(await call('POST',f.root+'/requirements',{content:'新版规定双人复核，旧证据不能冒充新版验证。'}),201).requirement;ok(await call('POST',`${f.root}/requirements/${next.id}/confirm`,{expectedContent:next.content}));assert.equal((await call('POST',`${f.root}/long-plans/${id}/adopt`,{expectedRevision:d.job.revision,acknowledged:true})).body.error,'requirement_version_outdated');});
 await check('timeout_retains_uncertain_attempt_and_never_auto_retries',async()=>{mode='timeout';f=await setup();const before=stubCalls;id=await create(f);await worker.idle();d=await read(f,id);assert.equal(stubCalls,before+1);assert.equal(d.job.status,'paused');assert.equal(d.parts[0].status,'uncertain');assert.equal(d.attempts[0].status,'uncertain');assert.equal((await call('POST',`${f.root}/long-plans/${id}/resume`,{expectedRevision:d.job.revision,acknowledgeExternalCall:true})).body.error,'part_requires_review');});
 await check('retry_requires_charge_ack_and_bounded_backoff_then_preserves_completed_parts',async()=>{
  const path=`${f.root}/long-plans/${id}/retry-part`,payload={expectedRevision:d.job.revision,segmentKey:d.parts[0].segment_key,note:'明确理解之前请求结果未知，可能产生重复费用'};
  assert.equal((await call('POST',path,payload)).status,400);assert.equal((await call('POST',path,{...payload,acknowledgePossibleDuplicateCharge:true})).status,429);
  // Advance fixture timestamp instead of burning wall time; real cooldown policy is tested above.
  await pool.query("UPDATE long_plan_attempts SET started_at=now()-interval '1 minute' WHERE job_id=$1",[id]);d=ok(await call('POST',path,{...payload,acknowledgePossibleDuplicateCharge:true}));mode='normal';ok(await call('POST',`${f.root}/long-plans/${id}/resume`,{expectedRevision:d.job.revision,acknowledgeExternalCall:true}));await worker.idle();d=await read(f,id);assert.equal(d.job.status,'awaiting_review');assert.equal(d.parts[0].attempts,2);assert.equal(d.parts[1].attempts,1);assert.equal(d.attempts[0].status,'uncertain');
 });
 await check('invalid_output_raw_preserved_and_human_correction_has_distinct_provenance',async()=>{
  mode='invalid';f=await setup('只有教师可以登记库存。');id=await create(f);await worker.idle();d=await read(f,id);assert.equal(d.attempts[0].raw_output,'{}');assert.equal(d.parts[0].status,'needs_attention');mode='normal';const result=await complete(ai,d.attempts[0].request_snapshot.messages,undefined,{});const before=stubCalls;
  d=ok(await call('POST',`${f.root}/long-plans/${id}/correct-part`,{expectedRevision:d.job.revision,segmentKey:d.parts[0].segment_key,output:result.content,note:'明确登记人工修正的协议样例，不冒充真实模型输出'}));assert.equal(stubCalls,before);assert.equal(d.job.status,'awaiting_review');assert.equal(d.parts[0].result_origin,'human_correction');assert.equal(d.attempts[0].raw_output,'{}');
 });
 await check('cancel_inflight_keeps_unknown_charge_and_is_not_resubmitted',async()=>{
  mode='hold';f=await setup();const before=stubCalls;id=await create(f);d=await waitFor(f,id,d=>d.attempts.length===1&&stubCalls===before+1);ok(await call('POST',`${f.root}/long-plans/${id}/cancel`,{expectedRevision:d.job.revision}));await worker.idle();d=await read(f,id);assert.equal(d.job.status,'cancelled');assert.equal(d.parts[0].status,'uncertain');assert.equal(stubCalls,before+1);
 });
 await check('service_restart_recovers_durable_dispatch_without_automatic_charge',async()=>{
  await app.close();await pool.query("UPDATE long_plan_jobs SET status='running',lease_token=$2 WHERE id=$1",[id,randomUUID()]);await pool.query("UPDATE long_plan_parts SET status='running' WHERE job_id=$1 AND position=1",[id]);await pool.query("UPDATE long_plan_attempts SET status='dispatching' WHERE job_id=$1",[id]);const before=stubCalls;await start();d=await read(f,id);assert.equal(d.job.status,'paused');assert.equal(d.parts[0].status,'uncertain');assert.equal(d.attempts[0].error_code,'service_interrupted');assert.equal(stubCalls,before);
 });
 await check('known_429_is_rejected_not_success_and_attempt_limit_blocks_fourth_charge',async()=>{
  mode='429';f=await setup();id=await create(f);await worker.idle();d=await read(f,id);assert.equal(d.attempts[0].status,'rejected');assert.equal(d.attempts[0].error_code,'ai_rate_limited');await pool.query('UPDATE long_plan_parts SET attempts=3 WHERE job_id=$1 AND position=1',[id]);assert.equal((await call('POST',`${f.root}/long-plans/${id}/retry-part`,{expectedRevision:d.job.revision,segmentKey:d.parts[0].segment_key,acknowledgePossibleDuplicateCharge:true,note:'第四次请求必须拒绝，不能重复产生模型费用'})).body.error,'part_attempt_limit');
 });
 await check('multi_chapter_long_business_source_preserves_all_ranges_and_tail_through_durable_outputs',async()=>{
  mode='normal';const sample=longBusinessCase();f=await setup(sample.source);id=await create(f);await worker.idle();d=await read(f,id);assert.equal(d.job.status,'awaiting_review');assert.ok(d.parts.length>5);assert.equal(d.attempts.map(a=>JSON.parse(a.request_snapshot.messages[1].content).segment.content).join(''),sample.source);assert.equal(d.audit.errors.length,0);assert.ok(d.attempts.at(-1).raw_output.includes(f.scheme.scheme.conditions.at(-1).key));assert.equal(d.parts.every(p=>p.status==='succeeded'),true);
 });
 await check('bounded_queue_and_separate_workers_do_not_dispatch_duplicate_requests',async()=>{
  mode='hold';const first=await setup(),second=await setup(),third=await setup();const before=stubCalls;const one=await create(first);await waitFor(first,one,d=>d.attempts.length===1&&stubCalls===before+1);const two=await create(second);
  const rejected=await call('POST',third.root+'/long-plans',{versionId:third.version,schemeRevision:third.scheme.revision,requestKey:randomUUID(),acknowledgeExternalCall:true});assert.equal(rejected.status,429);assert.equal(rejected.body.error,'planning_queue_full');
  const {LongPlanWorker}=await import('../apps/api/dist/long-plan/worker.js'),{LongPlanStore}=await import('../apps/api/dist/long-plan/store.js');const another=new LongPlanWorker(new LongPlanStore(pool),ai,undefined,{complete});another.kick();await another.idle();assert.equal(stubCalls,before+1);await another.close();
  for(const [fixture,j] of [[second,two],[first,one]]){const current=await read(fixture,j);ok(await call('POST',`${fixture.root}/long-plans/${j}/cancel`,{expectedRevision:current.job.revision}));}await worker.idle();assert.equal(stubCalls,before+1);
 });
 if(process.argv.includes('--browser'))await check('actual_desktop_browser_to_isolated_database_generates_reviews_adopts_and_shows_unverified_trace',async()=>{
  mode='normal';f=await setup();const {chromium}=await import('playwright');const browser=await chromium.launch({headless:true,channel:'msedge'});
  try{
   const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});await context.addInitScript(token=>localStorage.setItem('gongxu_token',token),user.token);const page=await context.newPage();page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',()=>errors.push('browser_runtime_error'));
   await page.route('**/*',async route=>{const u=new URL(route.request().url());if(!local(u.href))return route.abort();if(u.pathname.startsWith('/api/')){const r=await route.fetch({url:origin+u.pathname.slice(4)+u.search});return route.fulfill({response:r});}return route.continue();});
   await page.goto(`http://127.0.0.1:5173${f.root}/agent`);await page.locator('.connection-dot.online').waitFor();assert.match(await page.locator('.connection').innerText(),/服务可使用/);await page.getByRole('button',{name:'展开分段规划',exact:true}).click();await page.getByLabel(/我理解启动或恢复/).check();await page.getByRole('button',{name:'启动分段规划',exact:true}).click();await page.getByRole('heading',{name:'3. 合并检查与人工采纳',exact:true}).waitFor();
   const jobs=ok(await call('GET',f.root+'/long-plans'));id=jobs.jobs[0].id;d=await read(f,id);assert.equal(d.job.status,'awaiting_review');
   for(let i=0;i<d.audit.warnings.length;i++){const field=page.getByLabel(`合并检查${i+1}结论`,{exact:true});await field.locator('xpath=ancestor::details[1]').locator('summary').click();await field.selectOption('accepted_limitation');await page.getByLabel(`合并检查${i+1}说明`,{exact:true}).fill('合成数据库与模型协议替身验收；这里只核对交互，不代表真实模型质量。');}
   await page.getByLabel(/我已逐项核对全文/).check();await page.getByRole('button',{name:'保存合并审核',exact:true}).click();await page.getByText('合并审核已保存；仍需主动采纳才会创建任务。',{exact:true}).waitFor();await page.getByRole('button',{name:'采纳为正式计划',exact:true}).click();await page.getByText('计划已采纳，任务处于待开始状态，条件关联仍需在追踪区核对。',{exact:true}).waitFor();
   const adopted=await read(f,id);assert.equal(adopted.job.status,'adopted');assert.equal((await pool.query('SELECT count(*)::int AS n FROM tasks WHERE agent_run_id=$1',[adopted.job.adopted_run_id])).rows[0].n,2);const trace=ok(await call('GET',f.root+'/trace'));assert.ok(trace.items.length);assert.equal((await pool.query('SELECT count(*)::int AS n FROM practice_test_cases WHERE project_id=$1',[f.project])).rows[0].n,0);assert.deepEqual(errors,[]);
   await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:fileURLToPath(new URL('desktop-adopted-1440.png',out))});report.browser={engine:'Edge Chromium',version:browser.version(),viewport:'1440x1000',realDatabase:true,model:'protocol_fixture',runtimeErrors:errors};
  }finally{await browser.close();}
 });
 report.status='passed';
}catch(error){report.status='failed';report.errorType=error.name;report.safeMessage=error instanceof assert.AssertionError?String(error.message).slice(0,500):'Setup or query failed; configuration suppressed';process.exitCode=1;console.log('FAIL '+report.safeMessage);}
finally{await app?.close();await pool?.end();await admin.end();report.protocolFixtureCalls=stubCalls;report.finishedAt=new Date().toISOString();await writeFile(new URL('report.json',out),JSON.stringify(report,null,2));console.log('Report: '+fileURLToPath(new URL('report.json',out)));}
