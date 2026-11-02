// Synthetic identities via API and fixture-only role setup; all teaching/project operations below use UI.
// Real local HTTP/PostgreSQL, deterministic local model protocol, no videos or paid calls.
import {createRequire} from 'node:module';import {randomUUID,randomBytes} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';import assert from 'node:assert/strict';
import {chromium} from 'playwright';import {createApp} from '../apps/api/dist/app.js';import {PgProjectStore} from '../apps/api/dist/project-store.js';
const require=createRequire(new URL('../apps/api/package.json',import.meta.url));require('dotenv').config({path:fileURLToPath(new URL('../apps/api/.env',import.meta.url)),quiet:true});
const local=s=>['localhost','127.0.0.1','[::1]'].includes(new URL(s).hostname);assert.ok(local(process.env.DATABASE_URL));
const {Pool}=require('pg'),Fastify=require('fastify'),admin=new Pool({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:3000}),name='gx_ui_v7_'+randomUUID().replaceAll('-','');
const dbUrl=new URL(process.env.DATABASE_URL);dbUrl.pathname='/'+name;const out=new URL(`../.runtime/teaching-full-ui-v7-${randomUUID()}/`,import.meta.url);await mkdir(out,{recursive:true});
const report={status:'running',startedAt:new Date().toISOString(),scope:'isolated_real_http_sql_full_business_ui_model_fixture',apiSetup:['synthetic_account_registration','fixture_only_role_grants'],businessDataPreparedByApi:false,paidModelCalls:0,modelFixtureCalls:[],checks:[],screenshots:[],videoRecorded:false,retainedDatabase:name};
const originalFetch=globalThis.fetch;globalThis.fetch=(u,o)=>{if(!local(u instanceof Request?u.url:String(u)))throw Error('External traffic forbidden');return originalFetch(u,o);};
let pool,app,model,browser,origin;const pages=[],errors=[];const label=(p,t)=>p.getByLabel(t,{exact:true}),button=(p,t)=>p.getByRole('button',{name:t,exact:true});
const initial='合成教学案例：校园物品借用的需求与测试设计。\n借用期限最多七日，超过期限必须拒绝。\n申请人不得审批自己的申请。\n保留归还记录，人工核对测试依据；未实现的借用服务不得声称执行通过。';
const changed=initial.replace('七日','三日');let teacher,student,projectId;
async function shot(page,name,locator){const viewport=page.viewportSize();if(locator)await page.setViewportSize({width:1180,height:1000});await page.evaluate(()=>window.scrollTo(0,0));const path=fileURLToPath(new URL(name+'.png',out));if(locator)await locator.screenshot({path});else await page.screenshot({path,fullPage:false});report.screenshots.push({name,path,scope:'unaltered_actual_ui_synthetic_business_model_fixture'});await page.setViewportSize(viewport);}
async function createPage(user,path){const context=await browser.newContext({viewport:{width:1536,height:1000},reducedMotion:'reduce'});await context.addInitScript(token=>localStorage.setItem('gongxu_token',token),user.token);const page=await context.newPage();pages.push(page);page.setDefaultTimeout(18000);page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',async r=>{const u=new URL(r.request().url());if(!local(u.href))return r.abort();if(u.pathname.startsWith('/api/')){const res=await r.fetch({url:origin+u.pathname.slice(4)+u.search});return r.fulfill({response:res});}return r.continue();});await page.goto('http://127.0.0.1:5173'+path);await page.locator('.connection-dot.online').waitFor();return page;}
async function go(page,path){await page.goto('http://127.0.0.1:5173'+path);await page.locator('.connection-dot.online').waitFor();}
async function check(name,fn){await fn();report.checks.push({name,status:'passed',channel:'browser_ui'});console.log('PASS '+name);}
async function prepareProject(page,version){
 await go(page,`/projects/${projectId}/requirements`);await button(page,'确认最新版本 ✓').count();
 const confirm=page.getByRole('button',{name:/确认最新版本/});if(await confirm.count()){await confirm.click();await confirm.waitFor({state:'detached'});}
 await page.locator('.trace-panel').count();
 await go(page,`/projects/${projectId}/agent`);await page.getByRole('button',{name:/开始规划/}).click();await page.getByRole('button',{name:/确认计划并创建任务/}).waitFor();
 await page.getByLabel(/我已核对缺项、验收方法及知识原文/).check();await page.getByRole('button',{name:/确认计划并创建任务/}).click();await page.getByText('计划已确认，任务和人工审核记录已保存。',{exact:true}).waitFor();
 await go(page,`/projects/${projectId}/tests`);await page.getByRole('button',{name:/生成测试用例/}).click();await page.locator('.case-item').first().waitFor();
 const testcase=page.locator('.case-item').first();await label(testcase,'人工执行结果').selectOption('blocked');await label(testcase,'执行说明 / 证据').fill(`合成流程登记 v${version}：只验证需求与测试设计，借用服务未实现，未执行学生代码；保留阻塞证据。`);await button(testcase,'保存执行结果').click();await testcase.getByText('人工执行记录已保存。',{exact:true}).waitFor();
 await go(page,`/projects/${projectId}/documents`);await page.getByRole('button',{name:/^生成草稿/}).click();await page.getByText('已生成草稿，请核实并编辑。',{exact:true}).waitFor();
}
async function submit(page,description){await go(page,'/classroom');const task=page.locator('.teaching-task').filter({hasText:'校园借用设计实训'});await button(task,'核对成果并提交').click();await label(page,'提交说明').fill(description);await page.getByLabel('我已核对快照和缺口，同意提交给本班教师',{exact:true}).check();await button(page,'确认共享并提交').click();await page.getByText('固定快照已提交，教师可查看本次内容',{exact:true}).waitFor();}
async function openLatest(t){await button(t,'刷新状态').click();await t.getByText('正在读取真实状态…',{exact:true}).waitFor({state:'hidden'});const row=t.locator('tbody tr').filter({hasText:'校园借用设计实训'}).filter({hasText:'最新'});await button(row,'查看快照与反馈').click();await t.getByRole('heading',{name:'起草教师反馈'}).waitFor();await t.getByLabel('本次验收或退回的理由',{exact:true}).waitFor();}
try{
 await admin.query(`CREATE DATABASE ${name} TEMPLATE template0`);await promisify(execFile)(process.execPath,[fileURLToPath(new URL('../apps/api/dist/migrate.js',import.meta.url))],{cwd:fileURLToPath(new URL('../apps/api/',import.meta.url)),env:{...process.env,DATABASE_URL:dbUrl.href},windowsHide:true,maxBuffer:128000});
 pool=new Pool({connectionString:dbUrl.href,statement_timeout:12000});model=Fastify();model.post('/chat/completions',async req=>{
  const messages=req.body.messages,system=messages[0].content,input=messages.at(-1).content,keys=[...new Set(input.match(/REQ-[a-f0-9]{16}/g)??[])];let content,kind;
  if(system.includes('任务规划器')){kind='plan';content=JSON.stringify({tasks:[{key:'T1',stage:'需求与设计',title:'借用期限和审批约束设计（协议替身）',description:'按完整原文核对期限与禁止自批，未实现借用服务。',deliverable:'人工核对需求、正常/边界/拒绝输入；实际执行缺口保留。',dependsOn:[],citations:[],requirementIds:keys}]});}
  else if(system.includes('JSON')&&system.includes('cases')){kind='cases';content=JSON.stringify({cases:['normal','boundary','exception'].map((category,i)=>({category,title:['借用设计正常条件','期限边界条件','申请人自批拒绝'][i]+'（协议替身）',preconditions:'原创合成任务，尚未实现外部借用程序',steps:'人工检查原文、预期与所需证据；未实现时登记阻塞',expected:input.includes('三日')?'最多三日且禁止申请人自批':'最多七日且禁止申请人自批',requirementIds:keys}))});}
  else {kind='document';content='# 校园借用设计说明\n\n本段为本地协议替身，用于验证文档生成与来源快照流程。\n\n需求和测试属于设计，借用程序未实现。人工登记存在阻塞，不能声称运行通过。具体期限以当前已确认需求为准。';}
  report.modelFixtureCalls.push({kind,model:'local-protocol-fixture-v7'});return {choices:[{message:{content},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:10,total_tokens:20}};
 });const modelOrigin=await model.listen({host:'127.0.0.1',port:0});app=await createApp({pool,database:{query:s=>pool.query(s),end:async()=>{}},projectStore:new PgProjectStore(pool),corsOrigin:'http://127.0.0.1:5173',aiConfig:{baseUrl:modelOrigin,apiKey:'synthetic-fixture-only',model:'local-protocol-fixture-v7',timeoutMs:8000,maxOutputTokens:4096}});origin=await app.listen({host:'127.0.0.1',port:0});
 const users=[];for(const role of ['teacher','student']){const r=await fetch(origin+'/auth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:role==='teacher'?'合成评阅教师':'合成实训学生',email:`full-ui-${randomUUID()}@example.test`,password:randomBytes(24).toString('base64url')})});assert.equal(r.status,201);users.push(await r.json());}[teacher,student]=users;await pool.query("INSERT INTO teaching_roles(user_id,role) VALUES($1,'teacher')",[teacher.user.id]);
 browser=await chromium.launch({headless:true,channel:'msedge'});const t=await createPage(teacher,'/teaching'),s=await createPage(student,'/classroom');let classId,code,assignmentId;
 await check('teacher_creates_class_and_updates_same_draft_in_ui',async()=>{
  await t.locator('summary').filter({hasText:'班级与任务发布'}).click();await label(t,'班级名称').fill('校园借用案例 · 合成实训班');await button(t,'创建班级').click();await label(t,'选择本人班级').selectOption({label:'校园借用案例 · 合成实训班'});classId=await label(t,'选择本人班级').inputValue();code=await t.locator('code').filter({hasText:/^[a-f0-9]{24}$/}).innerText();
  const editor=t.getByRole('form',{name:'实训任务编辑器'});await label(editor,'任务名称').fill('校园借用设计实训');await label(editor,'任务要求').fill(initial);await label(editor,'人工验收依据').fill('检查需求、测试设计与版本，未实现借用服务保留阻塞，不得冒称通过。');await button(editor,'保存草稿').dblclick();await editor.getByText('同一任务草稿已保存，尚未发布。',{exact:true}).waitFor();
  await label(editor,'人工验收依据').fill('检查七日期限、禁止自批、版本和执行来源；未实现的借用服务保留阻塞。');await button(editor,'保存草稿').click();await editor.getByText('同一任务草稿已保存，尚未发布。',{exact:true}).waitFor();assert.equal(await t.locator('.teaching-task').count(),1);
  assignmentId=(await pool.query('SELECT id FROM teaching_assignments WHERE class_id=$1',[classId])).rows[0].id;
  const other=await createPage(teacher,'/teaching');await button(other.locator('.teaching-task'),'编辑或修订任务').click();const second=other.getByRole('form',{name:'实训任务编辑器'});await label(second,'任务名称').waitFor();await label(second,'人工验收依据').fill('另一窗口待合并：核对边界与实际证据，不伪造执行。');
  await label(editor,'人工验收依据').fill('窗口一已更新验收依据：七日期限和禁止自批。');await button(editor,'保存草稿').click();await editor.getByText('同一任务草稿已保存，尚未发布。',{exact:true}).waitFor();
  await button(second,'保存草稿').click();await second.getByRole('alert').waitFor();assert.match(await label(second,'人工验收依据').inputValue(),/另一窗口待合并/);await button(second,'读取服务端版本比较').click();await second.getByRole('region',{name:'任务冲突比较'}).getByText(/窗口一已更新/).waitFor();await button(second,'已比较，以当前输入更新草稿').click();await button(second,'保存草稿').click();await second.getByText('同一任务草稿已保存，尚未发布。',{exact:true}).waitFor();
  await other.route(`**/api/teaching/assignments/${assignmentId}`,async r=>r.request().method()==='PATCH'?r.fulfill({status:503,contentType:'application/json',body:'{"error":"fixture_failure"}'}):r.fallback());await label(second,'任务名称').fill('失败时仍保留的任务名称');await button(second,'保存草稿').click();await second.getByRole('alert').waitFor();assert.equal(await label(second,'任务名称').inputValue(),'失败时仍保留的任务名称');await other.unroute(`**/api/teaching/assignments/${assignmentId}`);await label(second,'任务名称').fill('校园借用设计实训');await button(second,'保存草稿').click();await second.getByText('同一任务草稿已保存，尚未发布。',{exact:true}).waitFor();
  report.checks.push({name:'draft_second_window_409_comparison_and_failed_save_preserve_input',status:'passed',channel:'browser_ui_one_injected_503'});await other.close();pages.pop();
  await go(t,'/teaching');await button(t.locator('.teaching-task'),'编辑或修订任务').click();await button(t.locator('.teaching-task'),'确认并发布任务').click();await t.locator('.teaching-task').getByText('已发布',{exact:true}).waitFor();
 });
 await check('student_joins_claims_confirms_requirement_and_builds_evidence_in_ui',async()=>{
  await s.locator('summary').filter({hasText:'加入班级'}).click();await label(s,'教师提供的班级邀请码').fill(code);await button(s,'加入班级').click();const task=s.locator('.teaching-task').filter({hasText:'校园借用设计实训'});await button(task,'领取并创建私有项目').click();await button(task,'打开项目与追踪').click();await s.waitForURL(/\/projects\//);projectId=new URL(s.url()).pathname.split('/')[2];await prepareProject(s,1);await shot(s,'01-original-document',s.locator('.module-page--documents'));
 });
 await check('teacher_publishes_revision_student_compares_and_old_evidence_becomes_historical',async()=>{
  const task=t.locator('.teaching-task').filter({hasText:'校园借用设计实训'});await button(task,'编辑或修订任务').click();const editor=t.getByRole('form',{name:'实训任务编辑器'});await button(editor,'创建修订草稿').click();await label(editor,'任务要求').fill(changed);await label(editor,'变更说明').fill('借用上限由七日改成三日，原边界用例和文档依据需重新核对。');await label(editor,'适用范围').selectOption('offer_existing');await button(editor,'保存草稿').click();await editor.getByText('同一任务草稿已保存，尚未发布。',{exact:true}).waitFor();await button(task,'确认并发布任务').click();
  await go(s,'/classroom');const update=s.getByRole('region',{name:'已领取任务变更'});await update.getByText(/你当前按 v1/).waitFor();await shot(s,'02-assignment-change',update);await label(update,'变更处理说明').fill('已比较期限变化，采纳三日任务并手动修改需求、测试与文档。');await update.getByLabel('已阅读版本差异；个人需求、测试和文档由我手动核对与修订',{exact:true}).check();await button(update,'采纳任务新版，保留个人项目').click();await update.waitFor({state:'detached'});
  await go(s,`/projects/${projectId}/requirements`);await label(s,'需求内容').count();await s.locator('#requirement').fill(changed);await s.getByRole('button',{name:/保存需求草稿/}).click();await s.getByRole('button',{name:/确认最新版本/}).click();await shot(s,'03-requirement-change',s.locator('.requirements-layout'));
  await go(s,`/projects/${projectId}/documents`);await s.locator('.document-source-state').filter({hasText:/变化|旧|历史|待/}).waitFor();await shot(s,'04-stale-document',s.locator('.document-source-state'));
  await prepareProject(s,2);await submit(s,'已手动修改为三日需求。保留合成测试阻塞，申请教师检查设计与证据。');
 });
 await check('teacher_feedback_return_student_revise_resubmit_and_accept_entirely_in_ui',async()=>{
  await openLatest(t);const form=t.locator('form').filter({has:t.getByRole('heading',{name:'起草教师反馈'})});await label(form,'指出依据、缺口与下一步').fill('三日需求已更新，但自批拒绝步骤缺少明确输入。请补充设计，不得把未执行写为通过。');await button(form,'保存草稿').click();await button(t,'我已核对内容，确认发布').click();await t.getByText(/人工反馈 · 教师已确认发布/).waitFor();await label(t,'本次验收或退回的理由').fill('请补充自批拒绝的具体操作输入，保留未实现服务的阻塞说明。');await t.getByLabel('已核对提交版本、实际缺口与证据；验收不会自动将测试改为通过',{exact:true}).check();await button(t,'退回并要求修改').click();await t.getByText('已退回，学生可修改并重新提交',{exact:true}).waitFor();await shot(t,'05-teacher-feedback',t.locator('.teaching-feedback'));
  await go(s,'/classroom');await s.locator('.teaching-task').getByText('已退回 · 请修改',{exact:true}).waitFor();await button(s.locator('tbody tr').filter({hasText:'最新'}),'查看快照与反馈').click();await s.getByText(/请补充设计，不得把未执行写为通过/).waitFor();
  await go(s,`/projects/${projectId}/tests`);const test=s.locator('.case-item').filter({hasText:'申请人自批拒绝'});await test.getByRole('button',{name:/编辑用例/}).click();await label(test,'步骤和输入').fill('以申请人账号提交借用申请后，尝试审批自己的同一申请；预期拒绝。合成设计，借用服务未实现，未执行。');await button(test,'保存用例').click();await test.getByText('用例已保存，变更的定义需重新执行。',{exact:true}).waitFor();await shot(s,'06-student-revision',test);
  await submit(s,'已补充自批拒绝的设计步骤；实际借用服务未实现，保留未执行与阻塞，不申请全部测试通过。');await openLatest(t);await t.getByRole('heading',{name:'第 2 次提交 · 合成实训学生',exact:true}).waitFor();
  for(const name of ['已核对需求完整性与原文','已核对测试依据、执行来源与缺口','已核对任务、需求及提交版本一致性','已核对提交版本、实际缺口与证据；验收不会自动将测试改为通过'])await t.getByLabel(name,{exact:true}).check();await label(t,'本次验收或退回的理由').fill('本次只验收需求和测试设计阶段，步骤修订已核对。');await label(t,'例外验收理由').fill('接受阶段性设计成果；借用程序未实现，未执行和阻塞继续保留，完整执行证据后续补充。');await button(t,'确认验收本次提交').click();await t.getByText('教师验收决定已登记，测试状态未改变',{exact:true}).waitFor();await shot(t,'07-reviewed-acceptance',t.locator('.teaching-review .alert.success'));
  await button(t,'刷新班级进度').click();await t.getByRole('region',{name:'本班进度概览'}).getByRole('cell',{name:'1',exact:true}).waitFor();
  const states=(await pool.query('SELECT result FROM practice_test_cases WHERE project_id=$1',[projectId])).rows;assert.ok(states.every(x=>x.result!=='passed'));assert.equal((await pool.query('SELECT count(*)::int AS n FROM teaching_submissions s JOIN teaching_claims c ON c.id=s.claim_id WHERE c.project_id=$1',[projectId])).rows[0].n,2);
 });
 // Faults happen after a real isolated commit, not merely before the request reaches the API.
 // Collect both regressions before failing so their independent red evidence is retained.
 const recoveryFailures=[];
 async function recoveryCheck(name,fn){try{await check(name,fn);}catch(e){recoveryFailures.push(name);report.checks.push({name,status:'failed',channel:'browser_ui',failure:e.message});console.error('FAIL '+name+': '+e.message);}}
 await recoveryCheck('assignment_initial_read_failure_cannot_create_another_task',async()=>{
  const p=await createPage(teacher,'/teaching');
  try{
   let createRequests=0;
   await p.route('**/api/teaching/classes/*/assignments',async r=>{if(r.request().method()==='POST')createRequests++;return r.fallback();});
   await p.route(`**/api/teaching/assignments/${assignmentId}`,async r=>r.request().method()==='GET'?r.fulfill({status:503,contentType:'application/json',body:'{"error":"fixture_read_failure"}'}):r.fallback());
   await button(p.locator('.teaching-task').filter({hasText:'校园借用设计实训'}),'编辑或修订任务').click();const edit=p.getByRole('form',{name:'实训任务编辑器'});await edit.getByRole('alert').waitFor();
   assert.equal(await label(edit,'任务名称').isDisabled(),true,'Existing assignment must remain locked after its initial read fails');
   assert.equal(await button(edit,'保存草稿').isDisabled(),true,'An unread existing assignment must never use creation fallback');
   await p.unroute(`**/api/teaching/assignments/${assignmentId}`);await button(edit,'重新读取任务').click();await button(edit,'创建修订草稿').waitFor();
   assert.equal(await label(edit,'任务名称').inputValue(),'校园借用设计实训');assert.equal(createRequests,0);
  }finally{await p.close();pages.pop();}
 });
 await recoveryCheck('assignment_committed_create_response_lost_changed_retry_preserves_unsaved_input',async()=>{
  const p=await createPage(teacher,'/teaching');
  try{
   await p.locator('summary').filter({hasText:'班级与任务发布'}).click();await label(p,'班级名称').fill('断线恢复专用合成班');await button(p,'创建班级').click();await label(p,'选择本人班级').selectOption({label:'断线恢复专用合成班'});const recoveryClassId=await label(p,'选择本人班级').inputValue();
   const edit=p.getByRole('form',{name:'实训任务编辑器'}),createPattern=`**/api/teaching/classes/${recoveryClassId}/assignments`;let attempts=0,committedId;
   await p.route(createPattern,async r=>{
    if(r.request().method()!=='POST')return r.fallback();attempts++;
    if(attempts!==1)return r.fallback();
    const response=await r.fetch({url:origin+new URL(r.request().url()).pathname.slice(4)});assert.equal(response.status(),200);committedId=(await response.json()).assignment.id;await r.abort('failed');
   });
   await label(edit,'任务名称').fill('请求A已成功落库');await label(edit,'任务要求').fill(initial);await label(edit,'人工验收依据').fill('核对原文及实际证据，不伪造执行。');await button(edit,'保存草稿').click();await edit.getByRole('alert').waitFor();assert.ok(committedId);
   await p.route(`**/api/teaching/assignments/${committedId}`,async r=>r.request().method()==='GET'?r.fulfill({status:503,contentType:'application/json',body:'{"error":"fixture_recovery_read_failure"}'}):r.fallback());
   await label(edit,'任务名称').fill('响应丢失后编辑B');await button(edit,'保存草稿').click();await edit.getByRole('alert').waitFor();
   assert.equal(await label(edit,'任务名称').inputValue(),'响应丢失后编辑B');assert.equal(await button(edit,'保存草稿').isDisabled(),true,'A known recovered ID must not fall back to POST if reading it fails');
   await p.unroute(`**/api/teaching/assignments/${committedId}`);await button(edit,'重新读取任务').click();await edit.getByText(/当前输入尚未保存/).waitFor();
   assert.equal(attempts,2);assert.equal(await label(edit,'任务名称').inputValue(),'响应丢失后编辑B');
   let rows=(await pool.query('SELECT id,title FROM teaching_assignments WHERE class_id=$1',[recoveryClassId])).rows;assert.equal(rows.length,1);assert.equal(rows[0].id,committedId);assert.equal(rows[0].title,'请求A已成功落库');
   await button(p,'新建另一项任务').click();const guard=p.getByRole('dialog',{name:'保留未保存的编辑'});await guard.waitFor();await button(guard,'留在此页').click();assert.equal(await label(edit,'任务名称').inputValue(),'响应丢失后编辑B');
   await button(edit,'保存草稿').click();await edit.getByText('同一任务草稿已保存，尚未发布。',{exact:true}).waitFor();
   rows=(await pool.query('SELECT id,title FROM teaching_assignments WHERE class_id=$1',[recoveryClassId])).rows;assert.equal(rows.length,1);assert.equal(rows[0].id,committedId);assert.equal(rows[0].title,'响应丢失后编辑B');assert.equal(attempts,2,'Recovery must PATCH the recovered assignment, not POST again');
  }finally{await p.close();pages.pop();}
 });
 assert.deepEqual(recoveryFailures,[],'Assignment recovery regressions must pass');
 assert.deepEqual(errors,[]);report.status='passed';report.browser=browser.version();report.businessDataPreparedByApi=false;
}catch(e){report.status='failed';report.failure=e.message;process.exitCode=1;console.error(e.message);for(const [i,p] of pages.entries()){await writeFile(new URL(`failure-${i}.txt`,out),p.url()+'\n'+await p.locator('body').innerText());await p.screenshot({path:fileURLToPath(new URL(`failure-${i}.png`,out))});}}
finally{await browser?.close();await app?.close();await model?.close();await pool?.end();await admin.end();globalThis.fetch=originalFetch;report.finishedAt=new Date().toISOString();await writeFile(new URL('report.json',out),JSON.stringify(report,null,2));console.log(fileURLToPath(new URL('report.json',out)));}
