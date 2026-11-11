// Synthetic identities in a fresh retained database. No real-account sessions or model calls.
import {createRequire} from 'node:module';
import {randomUUID,randomBytes} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {isolatedVerificationDatabase} from './isolated-verification-db.mjs';
import {importRecordingMaterials} from './recording-import-core.mjs';
import {recordingKit as kit} from '../demo/recording-kit-v1.mjs';
import {createApp} from '../apps/api/dist/app.js';
import {PgProjectStore} from '../apps/api/dist/project-store.js';
const require=createRequire(new URL('../apps/api/package.json',import.meta.url)),{Pool}=require('pg');
const out=new URL('../.runtime/recording-verify-'+randomUUID()+'/',import.meta.url);
await mkdir(out,{recursive:true});
const report={status:'running',paidModelCalls:0,modelFixtures:0,realUserSessionsUsed:false,checks:[],screenshots:[],scope:'REVIEW_PLACEHOLDER_575a8dfc08a84f40bc3b_isolated_postgresql_api_and_browser_imported_materials'};
let pool,app,browser;
const check=async(name,fn,layer='database_api')=>{await fn();report.checks.push({name,layer,status:'passed'});console.log('PASS '+name);};
try {
  const isolated=await isolatedVerificationDatabase(); report.isolation=isolated.evidence;
  pool=new Pool({connectionString:isolated.env.DATABASE_URL,connectionTimeoutMillis:4000,statement_timeout:15000});
  app=await createApp({pool,database:{query:s=>pool.query(s),end:async()=>{}},projectStore:new PgProjectStore(pool),corsOrigin:'http://127.0.0.1:5173'});
  const origin=await app.listen({host:'127.0.0.1',port:0});
  const users=[];
  for(const name of ['教师夹具','学生夹具','其他账号夹具']){
    const email=`recording-${randomUUID()}@example.test`;
    const r=await app.inject({method:'POST',url:'/auth/register',payload:{email,name,password:randomBytes(24).toString('base64url')}});
    assert.equal(r.statusCode,201);users.push({...r.json(),email});
  }
  const [teacher,student,other]=users;
  await pool.query("INSERT INTO teaching_roles(user_id,role) VALUES($1,'teacher')",[teacher.user.id]);
  const options={teacherEmail:teacher.email,studentEmail:student.email,kit,apply:true};
  const api=(u,path,method='GET',payload)=>app.inject({method,url:path,headers:{authorization:'Bearer '+u.token},payload});
  const old=(await api(student,'/projects','POST',{name:'保留的既有合成项目',description:'导入不可覆盖'})).json().project;
  let imported;
  await check('dry_run_no_mutation_and_exact_identity_guards',async()=>{
    const pre=await importRecordingMaterials(pool,{...options,apply:false});assert.equal(pre.identitiesVerified,true);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM teaching_classes')).rows[0].n,0);
    await assert.rejects(importRecordingMaterials(pool,{...options,teacherEmail:student.email}),/distinct_accounts_required/);
    await assert.rejects(importRecordingMaterials(pool,{...options,teacherEmail:other.email}),/teacher_role_required/);
    await assert.rejects(importRecordingMaterials(pool,{...options,studentEmail:'absent@example.test'}),/student_not_unique/);
  });
  await check('concurrent_imports_commit_one_complete_kit_without_duplication',async()=>{
    const results=await Promise.all([importRecordingMaterials(pool,options),importRecordingMaterials(pool,options)]);
    assert.equal(results.filter(x=>x.applied).length,1);assert.equal(results.filter(x=>x.reused).length,1);
    imported=results.find(x=>x.applied);report.kitHash=imported.kitHash;report.requirementHash=imported.requirementHash;assert.equal(results[0].projectId,results[1].projectId);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM teaching_classes')).rows[0].n,1);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM teaching_audit')).rows[0].n,1);
    assert.equal((await api(student,'/projects/'+old.id)).json().project.description,'导入不可覆盖');
  });
  await check('truthful_draft_states_no_agent_execution_submission_or_review',async()=>{
    const r=(await pool.query('SELECT status,confirmed_at FROM requirement_versions WHERE id=$1',[imported.requirementId])).rows[0];assert.equal(r.status,'draft');assert.equal(r.confirmed_at,null);
    const cases=(await pool.query('SELECT result,executor_id,executed_at,execution_revision,suggested_requirement_keys,model_name FROM practice_test_cases WHERE project_id=$1',[imported.projectId])).rows;
    assert.equal(cases.length,10);for(const c of cases){assert.equal(c.result,'not_run');assert.equal(c.executed_at,null);assert.equal(c.executor_id,null);assert.equal(c.execution_revision,0);assert.deepEqual(c.suggested_requirement_keys,[]);assert.equal(c.model_name,kit.source);}
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM project_documents WHERE project_id=$1 AND source_snapshot IS NULL',[imported.projectId])).rows[0].n,6);
    for(const table of ['agent_runs','tasks','teaching_submissions','teaching_feedback','teaching_decisions','ai_call_receipts'])assert.equal((await pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n,0);
    const versions=(await pool.query('SELECT number,state FROM teaching_assignment_versions ORDER BY number')).rows;assert.deepEqual(versions,[{number:1,state:'published'},{number:2,state:'draft'}]);
  });
  await check('owner_can_read_teacher_and_other_account_cannot_read_private_drafts',async()=>{
    for(const suffix of ['', '/documents','/test-cases']){
      assert.equal((await api(student,'/projects/'+imported.projectId+suffix)).statusCode,200);
      for(const u of [teacher,other])assert.equal((await api(u,'/projects/'+imported.projectId+suffix)).statusCode,404);
    }
    const a=(await api(student,'/teaching/assignments/'+imported.assignmentId)).json();assert.equal(a.draft,null);assert.equal(a.versions.length,1);
    const t=(await api(teacher,'/teaching/assignments/'+imported.assignmentId)).json();assert.equal(t.draft.number,2);
    assert.equal((await api(other,'/teaching/assignments/'+imported.assignmentId)).statusCode,404);
  });
  await check('rerun_never_overwrites_student_edits_or_silently_replaces_changed_kit',async()=>{
    const changed=kit.briefV1+'\n本人待审核补充。';
    const r=await api(student,`/projects/${imported.projectId}/requirements/${imported.requirementId}`,'PATCH',{content:changed,expectedContent:kit.briefV1});assert.equal(r.statusCode,200);
    const again=await importRecordingMaterials(pool,options);assert.equal(again.reused,true);assert.equal(again.current.originalRequirementChanged,true);
    assert.equal((await api(student,'/projects/'+imported.projectId)).json().requirements[0].content,changed);
    const revised=structuredClone(kit);revised.briefV1+=' changed';await assert.rejects(importRecordingMaterials(pool,{...options,kit:revised}),/kit_changed_requires_new_review/);
  });
  await check('revoked_teacher_cannot_reimport_or_expand_access',async()=>{
    await pool.query("UPDATE teaching_roles SET active=false WHERE user_id=$1",[teacher.user.id]);
    await assert.rejects(importRecordingMaterials(pool,options),/teacher_role_required/);
    await pool.query("UPDATE teaching_roles SET active=true WHERE user_id=$1",[teacher.user.id]);
  });
  await check('mid_import_failure_rolls_back_all_new_objects',async()=>{
    const before=(await pool.query('SELECT count(*)::int AS n FROM teaching_classes')).rows[0].n;
    const failing={connect:async()=>{const client=await pool.connect();return {release:()=>client.release(),query:(sql,params)=>{if(sql.startsWith('INSERT INTO project_documents'))throw Error('controlled_import_failure');return client.query(sql,params);}};}};
    await assert.rejects(importRecordingMaterials(failing,{...options,kit:{...kit,key:kit.key+'-failure'}}),/controlled_import_failure/);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM teaching_classes')).rows[0].n,before);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM teaching_audit')).rows[0].n,1);
  });
  if(process.argv.includes('--browser')){
    browser=await chromium.launch({headless:true,channel:'msedge'});const errors=[];
    async function pageFor(user,path){
      const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
      await context.addInitScript(token=>localStorage.setItem('gongxu_token',token),user.token);
      const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',()=>errors.push('page_error'));
      await page.route('**/*',async r=>{const u=new URL(r.request().url());if(!['127.0.0.1','localhost'].includes(u.hostname))return r.abort();if(u.pathname.startsWith('/api/'))return r.fulfill({response:await r.fetch({url:origin+u.pathname.slice(4)+u.search})});return r.continue();});
      await page.goto('http://127.0.0.1:5173'+path);await page.locator('.connection-dot.online').waitFor();return page;
    }
    const s=await pageFor(student,`/projects/${imported.projectId}/requirements`);
    await check('student_confirms_imported_draft_in_ui_then_sees_ten_truthful_cases',async()=>{
      await s.getByRole('button',{name:/确认最新版本/}).click();await s.getByRole('button',{name:/确认最新版本/}).waitFor({state:'detached'});
      await s.goto(`http://127.0.0.1:5173/projects/${imported.projectId}/tests`);
      await s.getByText('完整版本共 10 条 · 第 1 页 · 本页 10 条',{exact:true}).waitFor();
      await s.getByText(/演示资料导入 · AI 辅助编写 · 未调用平台模型 · 待人工审核/).first().waitFor();
      const body=await s.locator('body').innerText();assert.ok(!body.includes('模型生成用例'));assert.ok(body.includes('未执行，未登记执行结果'));
      await s.screenshot({path:fileURLToPath(new URL('student-tests.png',out)),fullPage:false});report.screenshots.push('student-tests.png');
    },'browser_ui');
    await check('student_reads_six_documents_and_teacher_opens_prepared_revision_draft',async()=>{
      await s.goto(`http://127.0.0.1:5173/projects/${imported.projectId}/documents`);
      await s.getByText(/演示资料导入 · AI 辅助编写 · 未调用平台模型 · 待人工审核/).first().waitFor();
      await s.getByRole('button',{name:/软件设计文档/}).click();await s.getByRole('textbox',{name:/内容|正文|Markdown/}).count();
      const t=await pageFor(teacher,'/teaching');const card=t.locator('.teaching-task').filter({hasText:kit.assignmentTitle});
      await card.getByRole('button',{name:'编辑或修订任务',exact:true}).click();
      const editor=t.getByRole('form',{name:'实训任务编辑器'});
      await editor.getByLabel('任务要求',{exact:true}).waitFor();
      await t.waitForFunction(()=>{const field=document.querySelector('textarea[aria-label="任务要求"]');return field&&!field.disabled&&field.value.length>0;});
      assert.equal(await editor.getByLabel('任务要求',{exact:true}).inputValue(),kit.briefV2,'Prepared revision text must match the complete reviewed v2');
      await t.screenshot({path:fileURLToPath(new URL('teacher-revision.png',out)),fullPage:false});report.screenshots.push('teacher-revision.png');
      assert.deepEqual(errors,[]);
    },'browser_ui');
  }else report.browser='not_run_use_--browser';
  report.status='passed';
}catch(error){report.status='failed';report.failure=String(error?.message??'verification_failed').slice(0,400);report.failureLocation=String(error?.stack??'').split('\n').find(line=>line.includes('recording-import-local.mjs'))?.trim();console.error('Verification failed; inspect local REVIEW_PLACEHOLDER_575a8dfc08a84f40bc3b report.');process.exitCode=1;}
finally{
  await browser?.close();await app?.close();await pool?.end();report.finishedAt=new Date().toISOString();
  await writeFile(new URL('report.json',out),JSON.stringify(report,null,2)+'\n');console.log(fileURLToPath(new URL('report.json',out)));
}
