// Real current UI + real isolated PostgreSQL. Synthetic people and imported design; no cloud model.
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {randomUUID,randomBytes} from 'node:crypto';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {isolatedVerificationDatabase} from './isolated-verification-db.mjs';
import {importRecordingMaterials} from './recording-import-core.mjs';
import {recordingKit as kit} from '../demo/recording-kit-v1.mjs';
import {videoScenes} from '../demo/video-recording-20261103.mjs';
import {createApp} from '../apps/api/dist/app.js';
import {PgProjectStore} from '../apps/api/dist/project-store.js';
import {curriculum} from '../knowledge/teaching-v6/catalog.mjs';
import {savePublicLesson} from '../apps/api/dist/rag/public.js';
import {loadEmbeddingConfig,indexDocument} from '../apps/api/dist/rag/service.js';
const require=createRequire(new URL('../apps/api/package.json',import.meta.url)),{Pool}=require('pg');
const quick=process.argv.includes('--quick');
assert.ok(process.argv.slice(2).every(a=>a==='--quick'));
const narration=JSON.parse(await readFile(new URL('../.runtime/video-production-20261103/narration-20261103-202045/manifest.json',import.meta.url),'utf8'));
process.env.PLAYWRIGHT_BROWSERS_PATH=fileURLToPath(new URL('../.runtime/browsers/',import.meta.url));
const {chromium}=await import('playwright');
const out=new URL('../.runtime/teaching-video-'+(quick?'rehearsal-':'')+randomUUID()+'/',import.meta.url);
await mkdir(out,{recursive:true});
const report={status:'running',quick,scope:'isolated_REVIEW_PLACEHOLDER_575a8dfc08a84f40bc3b_real_ui',viewport:{width:1920,height:960},recordingSize:{width:1920,height:1080},paidModelCalls:0,modelFixtures:0,primaryDataModified:false,independentHumanReview:false,startedAt:new Date().toISOString(),scenes:[],pageErrors:[],knowledge:[],checks:[]};
const local=s=>['127.0.0.1','localhost','[::1]'].includes(new URL(s).hostname);
const originalFetch=globalThis.fetch;
globalThis.fetch=(url,init)=>{if(!local(url instanceof Request?url.url:String(url)))throw Error('External request blocked');return originalFetch(url,init);};
let pool,app,browser,page,context,stage='setup',origin,project,teacher,student,sceneStart=0;
const front='http://127.0.0.1:5173';
const pause=ms=>delay(quick?50:ms);
// Wait at actual pages to match the local narration; do not accelerate actions or fake states.
const cue=seconds=>quick?Promise.resolve():delay(Math.max(0,seconds*1000-(performance.now()-sceneStart)));
const button=(p,name)=>p.getByRole('button',{name,exact:true});
const label=(p,name)=>p.getByLabel(name,{exact:true});
async function click(locator){await locator.scrollIntoViewIfNeeded();await pause(700);await locator.click();await pause(850);}
async function look(locator,ms=2600){await locator.scrollIntoViewIfNeeded();await pause(ms);}
async function go(user,path){
  await page.evaluate(token=>localStorage.setItem('gongxu_token',token),user.token);
  await page.goto(front+path);await page.locator('.connection-dot.online').waitFor();
  await page.getByText('正在读取真实状态…',{exact:true}).waitFor({state:'hidden'});await pause(1100);
}
async function scene(id,user,path,action){
  stage=id;const spec=videoScenes.find(s=>s.id===id);assert.ok(spec);console.log('SCENE '+id);
  const start=performance.now();sceneStart=start;
  context=await browser.newContext({viewport:{width:1920,height:960},reducedMotion:'reduce',...(quick?{}:{recordVideo:{dir:fileURLToPath(out),size:{width:1920,height:1080}}})});
  await context.addInitScript(token=>{
    if(!localStorage.getItem('gongxu_token'))localStorage.setItem('gongxu_token',token);
    // Visible pointer assists viewers; it does not change application state or click targets.
    addEventListener('DOMContentLoaded',()=>{const dot=document.createElement('div');dot.setAttribute('aria-hidden','true');dot.style.cssText='position:fixed;width:20px;height:20px;border:2px solid #61e9ff;border-radius:50%;pointer-events:none;z-index:2147483646;left:-100px;top:-100px;box-shadow:0 0 8px #61e9ff80';document.body.append(dot);addEventListener('pointermove',e=>{dot.style.left=(e.clientX-10)+'px';dot.style.top=(e.clientY-10)+'px';});});
  },user.token);
  page=await context.newPage();page.setDefaultTimeout(18000);
  page.on('pageerror',()=>report.pageErrors.push(stage));
  await page.route('**/*',async r=>{
    const u=new URL(r.request().url());if(!local(u.href))return r.abort();
    if(u.pathname==='/recording-history')return r.fulfill({status:200,contentType:'text/html; charset=utf-8',body:await readFile(new URL('../output/ai-review-v10-444998a5-da9b-4796-9825-d2df17741b6e/read-responses.html',import.meta.url))});
    if(u.pathname.startsWith('/api/'))return r.fulfill({response:await r.fetch({url:origin+u.pathname.slice(4)+u.search})});
    return r.continue();
  });
  await page.goto(front+path);await page.locator('.connection-dot.online').waitFor();await pause(1100);
  await action();
  const audio=narration.scenes.find(s=>s.id===id);assert.equal(audio.spoken,spec.spoken);
  await cue(Math.ceil(Math.max(spec.durationSec,audio.audioSeconds+2))-2);await pause(1500);
  const screenshot=fileURLToPath(new URL(id+'.png',out));await page.screenshot({path:screenshot,fullPage:false});
  const video=page.video();await context.close();context=null;
  report.scenes.push({id,title:spec.title,rawVideo:video?await video.path():null,screenshot,actionSeconds:(performance.now()-start)/1000});
  await writeFile(new URL('recording.json',out),JSON.stringify(report,null,2)+'\n');
}
async function submit(note){
  const card=page.locator('.teaching-task').filter({hasText:kit.assignmentTitle});
  await click(button(card,'核对成果并提交'));await label(page,'提交说明').fill(note);
  await look(page.getByRole('heading',{name:/提交预览/}),3200);
  await page.getByLabel('我已核对快照和缺口，同意提交给本班教师',{exact:true}).check();
  await click(button(page,'确认共享并提交'));await page.getByText('固定快照已提交，教师可查看本次内容',{exact:true}).waitFor();
}
async function latest(){
  const row=page.locator('tbody tr').filter({hasText:kit.assignmentTitle}).filter({hasText:'最新'});
  await click(button(row,'查看快照与反馈'));await page.getByRole('heading',{name:'起草教师反馈',exact:true}).waitFor();
}
try{
  const isolated=await isolatedVerificationDatabase();report.isolation=isolated.evidence;
  const embedding=loadEmbeddingConfig();assert.ok(embedding&&local(embedding.baseUrl),'Local embedding required, no cloud fallback');
  pool=new Pool({connectionString:isolated.env.DATABASE_URL,connectionTimeoutMillis:4000,statement_timeout:15000});
  app=await createApp({pool,database:{query:s=>pool.query(s),end:async()=>{}},projectStore:new PgProjectStore(pool),corsOrigin:front,embeddingConfig:embedding});
  origin=await app.listen({host:'127.0.0.1',port:0});
  const users=[];for(const name of ['演示教师（合成账号）','演示学生（合成账号）']){
    const email='video-'+randomUUID()+'@example.test';
    const r=await app.inject({method:'POST',url:'/auth/register',payload:{name,email,password:randomBytes(24).toString('base64url')}});assert.equal(r.statusCode,201);users.push({...r.json(),email});
  }[teacher,student]=users;
  await pool.query("INSERT INTO teaching_roles(user_id,role) VALUES($1,'teacher')",[teacher.user.id]);
  project=await importRecordingMaterials(pool,{teacherEmail:teacher.email,studentEmail:student.email,kit,apply:true});report.kitHash=project.kitHash;
  // Reuse only checked-in original public teaching examples, never production account data.
  for(const lesson of curriculum){
    const saved=await savePublicLesson(pool,lesson);const indexed=await indexDocument(pool,null,saved.id,embedding);
    report.knowledge.push({lessonId:lesson.lessonId,status:indexed?.status,chunks:indexed?.chunks});
    if(report.knowledge.length%10===0)console.log('INDEXED '+report.knowledge.length);
  }
  assert.equal(report.knowledge.length,51);assert.ok(report.knowledge.every(x=>x.status==='ready'));
  browser=await chromium.launch({headless:true,channel:'msedge'});
  const base='/projects/'+project.projectId;
  await scene('intro',teacher,'/teaching',async()=>{
    const card=page.locator('.teaching-task').filter({hasText:kit.assignmentTitle});await look(card,3200);
    await click(card.locator('summary',{hasText:'任务要求与验收依据'}));await look(card.locator('.teaching-pre').first(),4200);
    await cue(21);await go(student,'/classroom');await look(page.locator('.teaching-task'),2500);
  });
  await scene('materials',student,base+'/requirements',async()=>{
    await label(page,'需求内容').count();await look(page.locator('#requirement'),4000);
    await click(page.getByRole('button',{name:/确认最新版本/}));await page.getByRole('button',{name:/确认最新版本/}).waitFor({state:'detached'});
    await cue(13);await go(student,base+'/tests');await page.getByText('完整版本共 10 条 · 第 1 页 · 本页 10 条',{exact:true}).waitFor();
    await look(page.getByText('完整版本共 10 条 · 第 1 页 · 本页 10 条',{exact:true}),3000);
    const card=page.locator('.case-item').filter({hasText:'七日上界与八日拒绝'});await look(card,3800);
    await cue(30);await go(student,base+'/documents');await click(page.getByRole('button',{name:/软件设计文档/}));await page.locator('#doc-content').waitFor();
    await look(page.locator('#doc-content'),3500);await page.locator('#doc-content').evaluate(el=>{el.scrollTop=220;});
  });
  await scene('submission',student,'/classroom',async()=>{
    await submit('合成账号自动操作演示：提交七日需求与10条未执行设计。六份文档为导入材料，正式任务与执行证据仍缺失；不代表真实学生成果或独立教师审核。');
    await cue(14);await go(teacher,'/teaching');await latest();await look(page.getByRole('heading',{name:/第 1 次提交/}),2500);
    const form=page.locator('form').filter({has:page.getByRole('heading',{name:'起草教师反馈',exact:true})});
    await label(form,'指出依据、缺口与下一步').fill('合成教学流程演示反馈：R02与CASE-04已有禁止自审批要求。请补充可理解的拒绝提示；三日版发布后核对3/4/7日边界并修订个人需求。以上是设计建议，未执行借用程序，不代表独立教师评价。');
    await cue(27);await look(form,7000);await click(button(form,'保存草稿'));await click(button(page,'我已核对内容，确认发布'));
    await label(page,'本次验收或退回的理由').fill('合成演示退回：补充拒绝提示与需求换版后的验收设计，保留未执行及其他缺口。');
    await page.getByLabel('已核对提交版本、实际缺口与证据；验收不会自动将测试改为通过',{exact:true}).check();
    await cue(43);await click(button(page,'退回并要求修改'));await page.getByText('已退回，学生可修改并重新提交',{exact:true}).waitFor();
    await look(page.locator('.teaching-feedback'),2500);
  });
  await scene('revision',teacher,'/teaching',async()=>{
    const card=page.locator('.teaching-task').filter({hasText:kit.assignmentTitle});await click(button(card,'编辑或修订任务'));
    const edit=page.getByRole('form',{name:'实训任务编辑器'});
    await page.waitForFunction(()=>{const f=document.querySelector('textarea[aria-label="任务要求"]');return f&&!f.disabled&&f.value.includes('三日版');});
    assert.equal(await label(edit,'任务要求').inputValue(),kit.briefV2);await look(label(edit,'任务要求'),3500);await look(label(edit,'变更说明'),3000);
    await cue(14);await click(button(card,'确认并发布任务'));await page.getByText('任务版本已由教师确认发布',{exact:true}).waitFor();
    await go(student,'/classroom');await page.getByRole('region',{name:'已领取任务变更',exact:true}).waitFor();
    await click(page.getByText('比较新版要求与验收依据',{exact:true}));await look(page.getByText('比较新版要求与验收依据',{exact:true}),4000);
    await cue(28);await label(page,'变更处理说明').fill('合成流程演示：比较并采纳三日规则，个人需求、测试和文档仍由后续操作核对，不自动沿用旧版依据。');
    await page.getByLabel('已阅读版本差异；个人需求、测试和文档由我手动核对与修订',{exact:true}).check();
    await click(button(page,'采纳任务新版，保留个人项目'));
    await page.getByRole('region',{name:'已领取任务变更',exact:true}).waitFor({state:'hidden'});
    await cue(39);await go(student,base+'/requirements');
    await page.locator('#requirement').fill(kit.briefV2+'\n\n返修设计：3日允许；4日与7日拒绝且不产生有效申请。自审批提示“不能审批自己的申请”，拒绝后申请与库存不变。以上为合成演示的待执行设计，正式任务与新版测试仍待补齐。');
    await look(page.locator('#requirement'),2800);await click(page.getByRole('button',{name:/保存需求草稿/}));
    await click(page.getByRole('button',{name:/确认最新版本/}));await page.getByRole('button',{name:/确认最新版本/}).waitFor({state:'detached'});
  });
  await scene('impact',student,base+'/requirements',async()=>{
    await look(page.getByRole('region',{name:'需求到验证证据追踪'}),4200);
    await cue(12);await go(student,base+'/tests');await page.getByText('此需求版本暂无测试用例，其他版本的结果不会自动继承。',{exact:true}).waitFor();
    await look(page.getByText('此需求版本暂无测试用例，其他版本的结果不会自动继承。',{exact:true}),4000);
    await cue(24);await label(page,'测试来源需求版本').selectOption(project.requirementId);await page.getByText('完整版本共 10 条 · 第 1 页 · 本页 10 条',{exact:true}).waitFor();
    await look(page.getByText('完整版本共 10 条 · 第 1 页 · 本页 10 条',{exact:true}),3200);
    await label(page,'测试来源需求版本').selectOption('current');await pause(1200);
    await cue(39);await go(student,base+'/documents');await page.locator('.document-source-state').waitFor();await look(page.locator('.document-source-state'),3200);
  });
  await scene('resubmit',student,'/classroom',async()=>{
    await submit('合成账号演示第二次提交：已更新三日需求与拒绝提示设计。旧七日用例保留历史，当前任务、测试与执行依据仍有缺口，保持待复核。');
    await cue(16);await go(teacher,'/teaching');await latest();await look(page.getByRole('heading',{name:/第 2 次提交/}),4000);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM teaching_decisions WHERE decision=\'accept\'')).rows[0].n,0);
  });
  await scene('knowledge',student,'/knowledge',async()=>{
    const publicSection=page.getByRole('region',{name:'平台公共教学知识库'});await publicSection.count();
    await cue(8);await page.locator('#knowledge-query').fill('借用上限从七日改成三日后，哪些边界测试与需求版本证据需要重新核对？');
    const [response]=await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/knowledge/search')&&r.request().method()==='POST'),click(page.getByRole('button',{name:/^检索知识/}))]);
    assert.equal(response.status(),200);const found=await response.json();assert.ok(found.hits.length>0);assert.ok(found.hits.every(h=>h.scope==='platform_public'));
    await page.getByRole('heading',{name:'检索来源',exact:true}).waitFor();
    await look(page.getByRole('heading',{name:'检索来源',exact:true}),3800);
    report.retrieval={uiSearchCompleted:true,sourceCount:found.hits.length,publicOnly:true,localEmbedding:true,chatAnswerGenerated:false};
    await cue(24);await click(page.getByRole('button',{name:/展开原始片段/}).first());await pause(3000);
  });
  await scene('evidence',student,base+'/agent',async()=>{
    await pause(1600);await page.goto(front+'/recording-history');await page.locator('h1').waitFor();await look(page.locator('h1'),4500);
    const last=page.locator('article').filter({has:page.getByRole('heading',{name:'L13 · 第 13 段',exact:true})});
    await cue(16);await look(last.getByRole('heading',{name:'L13 · 第 13 段',exact:true}),3000);
    await look(last.getByRole('heading',{name:'模型原始回答（未人工修改）',exact:true}),4500);
    const merged=page.locator('article').filter({has:page.getByRole('heading',{name:'合并候选与检查',exact:true})});
    await cue(31);await look(merged.getByRole('heading',{name:'合并候选与检查',exact:true}),2500);
    await click(merged.getByText('结构错误、跨段与语义审核提示',{exact:true}));
    await merged.getByText('结构错误、跨段与语义审核提示',{exact:true}).evaluate(el=>el.scrollIntoView({block:'start'}));
    await pause(4500);
  });
  await scene('closing',student,'/classroom',async()=>{
    await look(page.locator('.teaching-task'),5000);await cue(12);await look(page.locator('table'),3000);
  });
  assert.deepEqual(report.pageErrors,[]);
  const counts=(await pool.query(`SELECT (SELECT count(*)::int FROM teaching_submissions) AS submissions,
    (SELECT count(*)::int FROM teaching_decisions WHERE decision='accept') AS accepted,
    (SELECT count(*)::int FROM practice_test_cases WHERE result='not_run') AS not_run,
    (SELECT count(*)::int FROM ai_call_receipts) AS model_calls`)).rows[0];
  assert.deepEqual(counts,{submissions:2,accepted:0,not_run:10,model_calls:0});report.checks.push({name:'final_REVIEW_PLACEHOLDER_575a8dfc08a84f40bc3b_state',...counts});
  report.status='recorded';
}catch(error){report.status='failed';report.failedStage=stage;report.errorType=error?.constructor?.name;report.safeError=String(error?.name).includes('Timeout')||error?.name==='AssertionError'?String(error.message).slice(0,450):'Check local REVIEW_PLACEHOLDER_575a8dfc08a84f40bc3b failure screenshot; configuration omitted';console.log('FAILED '+stage+' '+report.errorType);if(page&&!page.isClosed())await page.screenshot({path:fileURLToPath(new URL('failure.png',out))}).catch(()=>{});process.exitCode=1;}
finally{
  await context?.close();await browser?.close();await app?.close();await pool?.end();globalThis.fetch=originalFetch;
  report.finishedAt=new Date().toISOString();await writeFile(new URL('recording.json',out),JSON.stringify(report,null,2)+'\n');console.log('Recording: '+fileURLToPath(new URL('recording.json',out)));
}
