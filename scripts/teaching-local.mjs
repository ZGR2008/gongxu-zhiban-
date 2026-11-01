// Local PostgreSQL and real routes; synthetic identities only. No external model or network calls.
import {createRequire} from 'node:module';import {randomUUID,randomBytes} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';import assert from 'node:assert/strict';
import {loadConfig} from '../apps/api/dist/config.js';import {PgProjectStore} from '../apps/api/dist/project-store.js';
import {registerProjectRoutes} from '../apps/api/dist/project-routes.js';import {registerTeachingRoutes} from '../apps/api/dist/teaching/routes.js';
import {aiCaller,reserveCall} from '../apps/api/dist/teaching/quota.js';
import {registerPublicKnowledgeRoutes,savePublicLesson} from '../apps/api/dist/rag/public.js';
import {saveText} from '../apps/api/dist/rag/service.js';
import {searchKnowledge} from '../apps/api/dist/rag/search.js';
import {sourceProvenance} from '../evaluation/source-provenance.mjs';
const require=createRequire(new URL('../apps/api/package.json',import.meta.url));require('dotenv').config({path:fileURLToPath(new URL('../apps/api/.env',import.meta.url)),quiet:true});
const config=loadConfig(),local=url=>['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname);
if(!config.DATABASE_URL||!local(config.DATABASE_URL))throw Error('Local database required');
const {Pool}=require('pg'),Fastify=require('fastify'),admin=new Pool({connectionString:config.DATABASE_URL,connectionTimeoutMillis:3000});
const name='gx_teaching_v6_'+randomUUID().replaceAll('-','');assert.match(name,/^gx_teaching_v6_[a-f0-9]{32}$/);
const dest=new URL(config.DATABASE_URL);dest.pathname='/'+name;
const out=new URL(`../.runtime/teaching-local-${randomUUID()}/`,import.meta.url);await mkdir(out,{recursive:true});
const report={scope:'isolated_real_database_real_http_synthetic_accounts',...sourceProvenance(new URL('../',import.meta.url)),startedAt:new Date().toISOString(),paidModelCalls:0,checks:[],retainedSyntheticDatabase:name};
const originalFetch=globalThis.fetch;globalThis.fetch=(url,opts)=>{if(!local(url instanceof Request?url.url:String(url)))throw Error('External traffic forbidden');return originalFetch(url,opts);};
let pool,app,origin,student,teacher,teacherB,peer,adminUser,classId,assignment,claim,submission,preview;
async function start(){app=Fastify();const store=new PgProjectStore(pool);await registerProjectRoutes(app,store);await registerTeachingRoutes(app,store,pool);await registerPublicKnowledgeRoutes(app,store,pool);app.get('/health',async()=>({status:'ok',service:'gongxu-api'}));app.get('/ready',async()=>({status:'ready'}));app.get('/ai/status',async()=>({configured:false}));origin=await app.listen({host:'127.0.0.1',port:0});}
async function call(method,path,body,user=student){const r=await fetch(new URL(path,origin),{method,headers:{...(user?{authorization:'Bearer '+user.token}:{}),...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});return{status:r.status,body:await r.json()};}
const ok=(r,status=200)=>{assert.equal(r.status,status,JSON.stringify(r.body));return r.body;};
async function check(name,fn){await fn();report.checks.push({name,status:'passed'});console.log('PASS '+name);}
async function confirm(projectId,text){const draft=ok(await call('POST',`/projects/${projectId}/requirements`,{content:text}),201).requirement;ok(await call('POST',`/projects/${projectId}/requirements/${draft.id}/confirm`,{expectedContent:text}));return draft;}
try{
 await admin.query(`CREATE DATABASE ${name} TEMPLATE template0`);
 await promisify(execFile)(process.execPath,[fileURLToPath(new URL('../apps/api/dist/migrate.js',import.meta.url))],{cwd:fileURLToPath(new URL('../apps/api/',import.meta.url)),env:{...process.env,DATABASE_URL:dest.href},windowsHide:true,maxBuffer:128000,timeout:30000});
 pool=new Pool({connectionString:dest.href,max:10,statement_timeout:12000,connectionTimeoutMillis:3000});await start();
 const users=[];for(let i=0;i<5;i++)users.push(ok(await call('POST','/auth/register',{name:['合成学生','合成教师','其他班教师','合成同学','合成管理员'][i],email:`teaching-${randomUUID()}@example.test`,password:randomBytes(24).toString('base64url')},null),201));
 [student,teacher,teacherB,peer,adminUser]=users;
 // Explicit fixture-only setup. No production user IDs or role mutations.
 await pool.query("INSERT INTO teaching_roles(user_id,role) VALUES($1,'teacher'),($2,'teacher'),($3,'admin')",[teacher.user.id,teacherB.user.id,adminUser.user.id]);
 await check('registration_cannot_self_elevate_and_roles_are_rechecked',async()=>{
  assert.deepEqual(ok(await call('GET','/teaching/me')).roles,['student']);
  assert.equal((await call('POST','/teaching/classes',{name:'不能自建教师班'})).status,403);
  assert.equal((await call('GET','/teaching/admin/accounts')).status,403);
  assert.equal((await call('GET','/teaching/classes',undefined,null)).status,401);
 });
 await check('teacher_class_publish_explicit_student_join_and_cross_class_rejection',async()=>{
  const c=ok(await call('POST','/teaching/classes',{name:'校园借用实训 · 合成班'},teacher)).class;classId=c.id;
  assert.equal((await call('GET',`/teaching/classes/${classId}/members`,undefined,teacherB)).status,404);
  assignment=ok(await call('POST',`/teaching/classes/${classId}/assignments`,{title:'校园物品借用',brief:'学生申请借用设备，教师审核库存。必须禁止申请人自行审批，归还后登记验收。',rubric:'核对需求到任务和人工测试证据；不得将关联存在视为验收通过。'},teacher)).assignment;
  assert.equal(ok(await call('GET','/teaching/assignments')).assignments.length,0);
  ok(await call('POST','/teaching/join',{code:c.joinCode}));
  assert.equal(ok(await call('GET','/teaching/assignments')).assignments.length,0);
  ok(await call('POST',`/teaching/assignments/${assignment.id}/publish`,{expectedRevision:1,confirmed:true},teacher));
  assert.equal((await call('POST',`/teaching/assignments/${assignment.id}/claim`,{},peer)).status,404);
  assert.equal(ok(await call('GET','/teaching/assignments')).assignments.length,1);
 });
 await check('concurrent_claim_is_idempotent_and_teacher_admin_cannot_read_private_project',async()=>{
  const rs=await Promise.all([call('POST',`/teaching/assignments/${assignment.id}/claim`,{}),call('POST',`/teaching/assignments/${assignment.id}/claim`,{})]);
  rs.forEach(r=>ok(r));claim=rs[0].body.claim;assert.equal(claim.id,rs[1].body.claim.id);
  for(const user of [teacher,teacherB,peer,adminUser])assert.equal((await call('GET',`/projects/${claim.project_id}`,undefined,user)).status,404);
  assert.equal(ok(await call('GET','/teaching/submissions?role=teacher',undefined,teacher)).submissions.length,0);
  assert.equal((await call('GET',`/teaching/claims/${claim.id}/preview`,undefined,teacher)).status,404);
  assert.equal((await call('GET',`/teaching/claims/${claim.id}/preview`)).status,422);
 });
 await confirm(claim.project_id,'学生申请借用设备。教师审核库存；禁止申请人自批。😀 归还后必须复核损坏记录。');
 await check('submit_checks_version_fingerprint_and_preserves_old_personal_projects',async()=>{
  const privateProject=ok(await call('POST','/projects',{name:'未共享旧项目',description:'只属于学生'}),201).project;
  preview=ok(await call('GET',`/teaching/claims/${claim.id}/preview`));assert.ok(preview.snapshot.gaps.some(g=>g.code==='no_tests'));
  await confirm(claim.project_id,'新版借用最多七日。禁止申请人自行审批。');
  assert.equal((await call('POST',`/teaching/claims/${claim.id}/submit`,{expectedRevision:1,fingerprint:preview.fingerprint,requestKey:randomUUID(),note:'旧窗口不能提交',shareSnapshot:true})).body.error,'submission_source_changed');
  preview=ok(await call('GET',`/teaching/claims/${claim.id}/preview`));
  const payload={expectedRevision:1,fingerprint:preview.fingerprint,requestKey:randomUUID(),note:'提交的是合成方案，测试尚未执行，请教师反馈。',shareSnapshot:true};
  const rs=await Promise.all([call('POST',`/teaching/claims/${claim.id}/submit`,payload),call('POST',`/teaching/claims/${claim.id}/submit`,payload)]);rs.forEach(r=>ok(r));submission=rs[0].body.submission;
  assert.equal(submission.id,rs[1].body.submission.id);
  const teacherList=ok(await call('GET','/teaching/submissions?role=teacher',undefined,teacher)).submissions;assert.equal(teacherList.length,1);
  const visible=ok(await call('GET',`/teaching/submissions/${submission.id}?role=teacher`,undefined,teacher));assert.equal(visible.submission.snapshot.requirement.content,'新版借用最多七日。禁止申请人自行审批。');
  assert.ok(!JSON.stringify(visible).includes(privateProject.id));
  for(const user of [peer,teacherB,adminUser])assert.equal((await call('GET',`/teaching/submissions/${submission.id}`,undefined,user)).status,404);
 });
 await check('feedback_is_private_until_teacher_confirms_then_return_and_resubmit_keeps_history',async()=>{
  const f=ok(await call('POST',`/teaching/submissions/${submission.id}/feedback`,{content:'请补充七日到期与自审批被拒绝的人工执行证据。'},teacher)).feedback;
  assert.equal(ok(await call('GET',`/teaching/submissions/${submission.id}`)).feedback.length,0);
  assert.equal((await call('POST',`/teaching/feedback/${f.id}/publish`,{expectedRevision:1,content:'直接发布缺少确认'},teacher)).status,400);
  ok(await call('POST',`/teaching/feedback/${f.id}/publish`,{expectedRevision:1,content:'请补充七日到期与自审批被拒绝的人工执行证据。',teacherConfirmed:true},teacher));
  assert.equal(ok(await call('GET',`/teaching/submissions/${submission.id}`)).feedback.length,1);
  const rs=await Promise.all(['return','accept'].map(decision=>call('POST',`/teaching/submissions/${submission.id}/decision`,{expectedRevision:2,decision,note:'先补充证据再验收，本次为合成流程验证。',reviewedEvidence:true},teacher)));
  assert.deepEqual(rs.map(r=>r.status).sort(),[200,409]);assert.equal(rs[0].status,200);
  const original=ok(await call('GET',`/teaching/submissions/${submission.id}`)).submission.snapshot;
  await confirm(claim.project_id,'第二次提交：借用七日到期，禁止自批，归还后复核。');
  const next=ok(await call('GET',`/teaching/claims/${claim.id}/preview`));
  const s2=ok(await call('POST',`/teaching/claims/${claim.id}/submit`,{expectedRevision:3,fingerprint:next.fingerprint,requestKey:randomUUID(),note:'按反馈修改后的合成提交，保留未运行的证据状态。',shareSnapshot:true})).submission;
  assert.equal(s2.number,2);assert.deepEqual(ok(await call('GET',`/teaching/submissions/${submission.id}`)).submission.snapshot,original);
  assert.equal((await call('POST',`/teaching/submissions/${submission.id}/decision`,{expectedRevision:4,decision:'accept',note:'不应验收旧提交',reviewedEvidence:true},teacher)).body.error,'submission_outdated');
  ok(await call('POST',`/teaching/submissions/${s2.id}/decision`,{expectedRevision:4,decision:'accept',note:'仅验收合成流程；未执行测试的缺口已明确记录，不代表代码质量通过。',reviewedEvidence:true},teacher));
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM practice_test_cases')).rows[0].n,0);submission=s2;
 });
 await check('role_and_membership_revocation_blocks_existing_session_and_draft_access',async()=>{
  ok(await call('PUT',`/teaching/admin/accounts/${teacher.user.id}/roles`,{role:'teacher',active:false,expectedRevision:1,reason:'合成撤权回归'},adminUser));
  assert.equal((await call('GET','/teaching/submissions?role=teacher',undefined,teacher)).status,403);
  assert.equal((await call('POST','/teaching/classes',{name:'撤权后不可创建'},teacher)).status,403);
  ok(await call('PUT',`/teaching/admin/accounts/${teacher.user.id}/roles`,{role:'teacher',active:true,expectedRevision:2,reason:'合成恢复角色'},adminUser));
  ok(await call('PATCH',`/teaching/classes/${classId}/members`,{studentId:student.user.id,active:false,expectedRevision:1},teacher));
  assert.equal((await call('GET',`/teaching/submissions/${submission.id}?role=teacher`,undefined,teacher)).status,404);
  assert.equal((await call('GET',`/teaching/claims/${claim.id}/preview`)).status,404);
  assert.equal((await call('GET',`/projects/${claim.project_id}`)).status,200);
  ok(await call('PATCH',`/teaching/classes/${classId}/members`,{studentId:student.user.id,active:true,expectedRevision:2},teacher));
 });
 await check('atomic_call_quota_and_disabled_account_apply_without_paid_requests',async()=>{
  ok(await call('PATCH',`/teaching/admin/accounts/${peer.user.id}`,{disabled:false,monthlyCallLimit:1,expectedRevision:1,reason:'并发配额合成验证'},adminUser));
  const rs=await Promise.allSettled([1,2].map(()=>aiCaller.run({pool,userId:peer.user.id},()=>reserveCall('no-network-fixture'))));
  assert.equal(rs.filter(r=>r.status==='fulfilled').length,1);assert.equal(rs.find(r=>r.status==='rejected').reason.code,'ai_call_quota_exhausted');
  await rs.find(r=>r.status==='fulfilled').value.finish('fixture_no_network');
  ok(await call('PATCH',`/teaching/admin/accounts/${peer.user.id}`,{disabled:true,monthlyCallLimit:1,expectedRevision:2,reason:'禁用会话合成验证'},adminUser));
  assert.equal((await call('GET','/projects',undefined,peer)).status,401);
  const log=ok(await call('GET','/teaching/admin/audit',undefined,adminUser));assert.ok(log.events.some(e=>e.action==='role_changed'));
  assert.ok(!JSON.stringify(log).includes('password'));assert.ok(!JSON.stringify(log).includes('token'));
 });
 await check('service_restart_retains_immutable_submissions_and_decisions',async()=>{await app.close();await start();const data=ok(await call('GET',`/teaching/submissions/${submission.id}`));assert.equal(data.decision.decision,'accept');assert.equal(data.submission.number,2);});
 await check('public_curriculum_is_login_readable_readonly_to_ordinary_roles_and_never_publishes_private_data',async()=>{
  const lesson={lessonId:'GX-PROTOCOL-01',version:'1.0.0',title:'公共权限协议夹具',category:'安全权限',sources:[],text:'这是合成协议夹具，不是实际课程资料。公共资料仅对登录账号可见；个人草稿必须保持私有。\n'.repeat(12)};
  for(const who of [student,teacher,teacherB])assert.equal((await call('POST','/knowledge/public',lesson,who)).status,403);
  assert.equal((await call('GET','/knowledge/public',undefined,null)).status,401);
  const published=ok(await call('POST','/knowledge/public',lesson,adminUser));
  const newcomer=ok(await call('POST','/auth/register',{name:'公共资料后注册合成账号',email:`later-${randomUUID()}@example.test`,password:randomBytes(24).toString('base64url')},null),201);
  assert.equal(ok(await call('GET','/knowledge/public',undefined,newcomer)).total,1);
  assert.equal((await call('POST','/knowledge/public',lesson,newcomer)).status,403);
  assert.equal((await savePublicLesson(pool,lesson)).id,published.id);
  const privateDoc=await saveText(pool,student.user.id,'合成私人内容','此段只应属于合成学生，不得被公共资料路由或其他账号检索读取。');
  for(const who of [student,teacher,teacherB,adminUser]){const list=ok(await call('GET','/knowledge/public',undefined,who));assert.equal(list.total,1);assert.equal(list.documents[0].id,published.id);assert.equal(list.documents[0].scope,'platform_public');assert.equal((await call('GET',`/knowledge/public/${privateDoc.id}`,undefined,who)).status,404);ok(await call('GET',`/knowledge/public/${published.id}`,undefined,who));}
  for(const who of [student,teacher])assert.equal((await call('POST',`/knowledge/public/${published.id}/index`,{},who)).status,403);
  await pool.query("UPDATE knowledge_documents SET status='ready' WHERE id=ANY($1::uuid[])",[[published.id,privateDoc.id]]);
  await pool.query("UPDATE knowledge_chunks SET embedding='[1,0]'::vector,embedding_model='synthetic-scope-fixture' WHERE document_id=ANY($1::uuid[])",[[published.id,privateDoc.id]]);
  const own=await searchKnowledge(pool,student.user.id,'synthetic-scope-fixture',[1,0],20);
  const other=await searchKnowledge(pool,teacher.user.id,'synthetic-scope-fixture',[1,0],20);
  assert.ok(own.some(h=>h.document_id===privateDoc.id));assert.ok(other.length>0);assert.ok(other.every(h=>h.document_id===published.id&&h.scope==='platform_public'));
  assert.ok(other.every(h=>h.document_name.startsWith('【平台公共教学示例】')));
  assert.equal((await pool.query('SELECT visibility FROM knowledge_documents WHERE id=$1',[privateDoc.id])).rows[0].visibility,'personal');
 });
 const {teachingFaults}=await import('./teaching-faults.mjs');await teachingFaults({pool,student,teacher,teacherB,adminUser,classId,check});
 if(process.argv.includes('--browser')){const {curriculum}=await import('../knowledge/teaching-v6/catalog.mjs');for(const lesson of curriculum)await savePublicLesson(pool,lesson);const {teachingBrowser}=await import('./teaching-browser.mjs');report.browser=await teachingBrowser({origin,student,teacher,adminUser,classId,call,ok,out});}
 report.status='passed';
}catch(error){report.status='failed';report.failure=error instanceof Error?error.message:'unknown';console.error(report.failure);process.exitCode=1;}
finally{await app?.close();await pool?.end();await admin.end();globalThis.fetch=originalFetch;report.finishedAt=new Date().toISOString();await writeFile(new URL('report.json',out),JSON.stringify(report,null,2));console.log('Report: '+fileURLToPath(new URL('report.json',out)));}
