// Original website, subtitles and clicks only. No toolbar, trajectory, wheel or dragging.
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {randomUUID,randomBytes} from 'node:crypto';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import assert from 'node:assert/strict';
import {isolatedVerificationDatabase} from './isolated-verification-db.mjs';
import {importRecordingMaterials} from './recording-import-core.mjs';
import {recordingKit as kit} from '../demo/recording-kit-v1.mjs';
import {createApp} from '../apps/api/dist/app.js';
import {PgProjectStore} from '../apps/api/dist/project-store.js';
import {curriculum} from '../knowledge/teaching-v6/catalog.mjs';
import {savePublicLesson} from '../apps/api/dist/rag/public.js';
import {loadEmbeddingConfig,indexDocument} from '../apps/api/dist/rag/service.js';
const quick=process.argv.includes('--quick');assert.ok(process.argv.slice(2).every(a=>a==='--quick'));
const narration=JSON.parse(await readFile(new URL('../.runtime/narration-730-20261107-slow/manifest.json',import.meta.url),'utf8').then(s=>s.replace(/^\uFEFF/,'')));
assert.equal(narration.rate,-2);assert.equal(narration.paidModelCalls,0);
const speeches=new Map(narration.scenes.map(s=>[s.id,s]));
const require=createRequire(new URL('../apps/api/package.json',import.meta.url)),{Pool}=require('pg');
process.env.PLAYWRIGHT_BROWSERS_PATH=fileURLToPath(new URL('../.runtime/browsers/',import.meta.url));
const {chromium}=await import('playwright');
const out=new URL('../.runtime/narrated-730-video-20261107-'+(quick?'rehearsal-':'')+randomUUID()+'/',import.meta.url);await mkdir(out,{recursive:true});
const front='http://127.0.0.1:5173',local=s=>['127.0.0.1','localhost','[::1]'].includes(new URL(s).hostname);
const originalFetch=globalThis.fetch;globalThis.fetch=(url,init)=>{if(!local(url instanceof Request?url.url:String(url)))throw Error('Non-local request blocked');return originalFetch(url,init);};
const report={status:'preparing',quick,requestedSeconds:450,scope:'continuous_isolated_REVIEW_PLACEHOLDER_575a8dfc08a84f40bc3b_real_ui',presentation:'original_site_slow_narration_subtitles_clicks_only',audio:false,narrationManifest:fileURLToPath(new URL('../.runtime/narration-730-20261107-slow/manifest.json',import.meta.url)),narrationRate:-2,paidModelCalls:0,primaryDatabaseModified:false,events:[],captions:[],chapters:[],pageErrors:[],knowledge:[],programmaticPageLoads:0,pointerMoves:0,clicks:0,scrolls:0};
let pool,app,browser,context,page,frame,origin,start=0,chapter='',history=false,project,teacher,student,stage='prepare',cursor={x:60,y:60};
const clock=()=>start?(performance.now()-start)/1000:0;
const pause=ms=>delay(quick?15:ms);
const b=(root,name)=>root.getByRole('button',{name,exact:true});
const l=(root,name)=>root.getByLabel(name,{exact:true});
async function checkpoint(){await writeFile(new URL('recording.json',out),JSON.stringify(report,null,2)+'\n');}
async function cue(id,work=async()=>{}){
 const speech=speeches.get(id);assert.ok(speech,'Unknown narration cue');
 const began=performance.now();const entry={id,seconds:clock(),chapter,text:speech.spoken,audioSeconds:speech.audioSeconds};
 report.captions.push(entry);await page.evaluate(v=>window.videoText(v.chapter,v.text),{chapter,text:speech.spoken});
 const actionStart=performance.now();await work();entry.actionSeconds=(performance.now()-actionStart)/1000;
 if(!quick)await delay(Math.max(0,(speech.audioSeconds+.55)*1000-(performance.now()-began)));
 entry.finishedSeconds=clock();await checkpoint();
}
async function at(seconds){if(!quick)await delay(Math.max(0,seconds*1000-(performance.now()-start)));}
async function begin(name){chapter=name;stage=name;report.chapters.push({title:name,startSeconds:clock()});console.log('CHAPTER '+name);await checkpoint();}
async function move(x,y){await page.mouse.move(x,y);cursor={x,y};report.pointerMoves++;}
async function reveal(locator){await locator.waitFor({state:'attached'});await locator.scrollIntoViewIfNeeded();let box=await locator.boundingBox();if(box&&(box.y<90||box.y+Math.min(box.height,80)>940)){await locator.evaluate(el=>el.scrollIntoView({block:'center',behavior:'instant'}));box=await locator.boundingBox();}if(!box)throw Error('Control not visible');return box;}
async function click(locator){const box=await reveal(locator);await move(Math.min(1870,box.x+Math.min(box.width/2,240)),Math.min(1010,box.y+Math.min(box.height/2,35)));await pause(200);const before=frame?await frame.evaluate(()=>location.pathname).catch(()=>''):'';await page.mouse.down();await pause(70);await page.mouse.up();report.clicks++;await pause(550);const after=frame?await frame.evaluate(()=>location.pathname).catch(()=>''):'';report.events.push({seconds:clock(),type:'click_only',from:before,to:after});}
async function fill(locator,value){await click(locator);await locator.fill(value);await pause(400);}
async function show(locator,hold=3200){await reveal(locator);await pause(hold);}
async function nav(name){await click(frame.getByRole('navigation',{name:'主导航'}).getByRole('link',{name,exact:true}));await frame.locator('.connection-dot.online').waitFor();await pause(500);}
async function tab(name){await click(frame.getByRole('navigation',{name:'项目内导航'}).getByRole('button',{name,exact:true}));await pause(500);}
async function login(user){await frame.locator('#email').waitFor();await fill(frame.locator('#email'),user.email);await fill(frame.locator('#password'),user.password);await click(b(frame,/登录工作空间/));await frame.locator('#workspace-role').waitFor();await pause(450);}
async function teacherHome(){const select=frame.locator('#workspace-role');await click(select);await select.press('End');await select.press('Enter');await frame.getByRole('heading',{name:'教师工作台',exact:true}).waitFor();await pause(550);}
async function swap(user,isTeacher=false){await click(frame.getByRole('button',{name:/^退出登录/}));await login(user);if(isTeacher)await teacherHome();else await nav('班级实训');}
async function openProject(){await click(b(frame,'打开项目与追踪'));await frame.getByRole('navigation',{name:'项目内导航'}).getByRole('button',{name:'AI 项目导师',exact:true}).waitFor();}
async function submit(note){await click(b(frame,'核对成果并提交'));await fill(l(frame,'提交说明'),note);await click(frame.getByLabel('我已核对快照和缺口，同意提交给本班教师',{exact:true}));await click(b(frame,'确认共享并提交'));await frame.getByText('固定快照已提交，教师可查看本次内容',{exact:true}).waitFor();}
async function latest(){const row=frame.locator('tbody tr').filter({hasText:kit.assignmentTitle}).filter({hasText:'最新'});await click(b(row,'查看快照与反馈'));await frame.getByRole('heading',{name:'起草教师反馈',exact:true}).waitFor();}
try{
 const isolated=await isolatedVerificationDatabase();report.isolation=isolated.evidence;
 const embedding=loadEmbeddingConfig();assert.ok(embedding&&local(embedding.baseUrl));pool=new Pool({connectionString:isolated.env.DATABASE_URL,connectionTimeoutMillis:4000,statement_timeout:15000});
 app=await createApp({pool,database:{query:s=>pool.query(s),end:async()=>{}},projectStore:new PgProjectStore(pool),corsOrigin:front,embeddingConfig:embedding});origin=await app.listen({host:'127.0.0.1',port:0});
 const users=[];for(const [name,email] of [['演示教师（合成账号）','teacher-video@example.test'],['演示学生（合成账号）','student-video@example.test']]){const password=randomBytes(18).toString('base64url');const r=await app.inject({method:'POST',url:'/auth/register',payload:{name,email,password}});assert.equal(r.statusCode,201);users.push({...r.json(),name,email,password});}[teacher,student]=users;
 await pool.query("INSERT INTO teaching_roles(user_id,role) VALUES($1,'teacher')",[teacher.user.id]);project=await importRecordingMaterials(pool,{teacherEmail:teacher.email,studentEmail:student.email,kit,apply:true});
 for(const lesson of curriculum){const saved=await savePublicLesson(pool,lesson),indexed=await indexDocument(pool,null,saved.id,embedding);report.knowledge.push({id:lesson.lessonId,status:indexed?.status,chunks:indexed?.chunks});}assert.ok(report.knowledge.length===51&&report.knowledge.every(x=>x.status==='ready'));
 browser=await chromium.launch({headless:true,channel:'msedge'});context=await browser.newContext({viewport:{width:1920,height:1080},reducedMotion:'no-preference',...(quick?{}:{recordVideo:{dir:fileURLToPath(out),size:{width:1920,height:1080}}})});
 await context.addInitScript({path:fileURLToPath(new URL('../demo/narrated-video-overlay.js',import.meta.url))});
 page=await context.newPage();page.setDefaultTimeout(20000);page.on('pageerror',()=>report.pageErrors.push(stage));
 await page.route('**/*',async r=>{const u=new URL(r.request().url());if(!local(u.href))return r.abort();if(u.pathname.startsWith('/api/'))return r.fulfill({response:await r.fetch({url:origin+u.pathname.slice(4)+u.search})});return r.continue();});
 // One initial load of the real site. Subsequent page changes use existing visible controls.
 await page.goto(front+'/dashboard');report.programmaticPageLoads++;frame=page;
 await login(teacher);await nav('项目工作台');
 const artwork=frame.frameLocator('.workspace-orbit-frame');await artwork.locator('body[data-motion="running"]').waitFor();
 assert.equal(await frame.locator('.workspace-visual--webgl button,.workspace-visual--webgl a').count(),0);
 report.artwork={autoplay:true,controls:false};
 await pause(800);await page.evaluate(()=>window.videoStart());start=performance.now();report.status='recording';
 await begin('01｜项目价值与教师课题');
 await cue('intro');await cue('problem');await cue('scope',async()=>{await teacherHome();});
 const task=()=>frame.locator('.teaching-task').filter({hasText:kit.assignmentTitle});
 await cue('teacher',async()=>{await click(task().locator('summary',{hasText:'任务要求与验收依据'}));});
 await cue('rule',async()=>{await show(task().locator('.teaching-pre').first(),1200);});

 await begin('02｜学生需求、测试与文档');
 await cue('student',async()=>{await swap(student);});
 await cue('requirements',async()=>{await openProject();await tab('AI 项目导师');await show(frame.locator('#requirement'),1200);await click(frame.getByRole('button',{name:/确认最新版本/}));await frame.getByRole('button',{name:/确认最新版本/}).waitFor({state:'detached'});});
 await cue('tests',async()=>{await tab('智能测试');await frame.getByText('完整版本共 10 条 · 第 1 页 · 本页 10 条',{exact:true}).waitFor();});
 await cue('boundary',async()=>{await show(frame.locator('.case-item').filter({hasText:'七日上界与八日拒绝'}),1200);});
 await cue('documents',async()=>{await tab('项目文档');await click(frame.getByRole('button',{name:/软件设计文档/}));await show(frame.locator('#doc-content'),1200);await click(frame.locator('#doc-content'));await frame.locator('#doc-content').press('Control+Home');});

 await begin('03｜学生主动共享固定快照');
 await cue('submit-preview',async()=>{await nav('班级实训');await submit('合成教学流程演示：提交七日需求、10条未执行用例和6份设计文档；正式任务和真实执行证据仍有缺口。');});
 await cue('submit-done',async()=>{await show(frame.locator('table'),900);});

 await begin('04｜教师反馈、退回和任务修订');
 await cue('teacher-review',async()=>{await swap(teacher,true);await latest();});
 const form=frame.locator('form').filter({has:frame.getByRole('heading',{name:'起草教师反馈',exact:true})});
 await cue('feedback',async()=>{
  await fill(l(form,'指出依据、缺口与下一步'),'合成教学流程示例：R02与CASE-04已有禁止自审批要求，请补充明确拒绝提示与库存不变的设计；三日版发布后重新核对边界与需求版本。以上不是借用程序的执行诊断，也不是独立教师评价。');
  await click(b(form,'保存草稿'));await click(b(frame,'我已核对内容，确认发布'));
 });
 await cue('return',async()=>{await fill(l(frame,'本次验收或退回的理由'),'合成流程退回：补充拒绝提示与新版期限边界，保留尚未执行、尚未复核的缺口。');await click(frame.getByLabel('已核对提交版本、实际缺口与证据；验收不会自动将测试改为通过',{exact:true}));await click(b(frame,'退回并要求修改'));await frame.getByText('已退回，学生可修改并重新提交',{exact:true}).waitFor();});
 await cue('revision',async()=>{await nav('教学工作台');await click(b(task(),'编辑或修订任务'));const edit=frame.getByRole('form',{name:'实训任务编辑器'});await l(edit,'任务要求').waitFor();await page.waitForFunction(expected=>document.querySelector('form[aria-label="实训任务编辑器"] textarea')?.value===expected,kit.briefV2);assert.equal(await l(edit,'任务要求').inputValue(),kit.briefV2);await show(l(edit,'变更说明'),1000);});
 await cue('version',async()=>{await click(b(task(),'确认并发布任务'));await frame.getByText('任务版本已由教师确认发布',{exact:true}).waitFor();});

 await begin('05｜学生明确处理需求变化');
 await cue('compare',async()=>{await swap(student);await frame.getByRole('region',{name:'已领取任务变更',exact:true}).waitFor();await click(frame.getByText('比较新版要求与验收依据',{exact:true}));await show(frame.getByText('比较新版要求与验收依据',{exact:true}),800);});
 await cue('adopt',async()=>{await fill(l(frame,'变更处理说明'),'合成流程示例：采纳三日规则；个人需求、边界用例和文档仍需手动核对，不继承旧版验证结论。');await click(frame.getByLabel('已阅读版本差异；个人需求、测试和文档由我手动核对与修订',{exact:true}));await click(b(frame,'采纳任务新版，保留个人项目'));});
 await cue('edit',async()=>{await openProject();await tab('AI 项目导师');await fill(frame.locator('#requirement'),kit.briefV2+'\n\n合成返修设计：3日允许；4日与7日拒绝，不产生有效申请。自审批显示明确拒绝提示，申请状态与库存不变。上述仍为待执行设计，新版测试与正式任务尚待完善。');});
 await cue('confirm',async()=>{await click(frame.getByRole('button',{name:/保存需求草稿/}));await click(frame.getByRole('button',{name:/确认最新版本/}));await frame.getByRole('button',{name:/确认最新版本/}).waitFor({state:'detached'});});

 await begin('06｜缺口、历史依据与返修重交');
 await cue('gap',async()=>{await tab('智能测试');await frame.getByText('此需求版本暂无测试用例，其他版本的结果不会自动继承。',{exact:true}).waitFor();});
 await cue('history',async()=>{const versions=l(frame,'测试来源需求版本');await click(versions);await versions.selectOption(project.requirementId);await show(frame.getByText('完整版本共 10 条 · 第 1 页 · 本页 10 条',{exact:true}),1600);await click(versions);await versions.selectOption('current');});
 await cue('doc-gap',async()=>{await tab('项目文档');await show(frame.locator('.document-source-state'),1600);});
 await cue('resubmit',async()=>{await nav('班级实训');await submit('合成教学流程第二次提交：三日需求与拒绝提示设计已更新，旧七日用例保留历史；当前正式测试、任务和执行证据仍待完善。');});
 await cue('human',async()=>{await show(frame.locator('table'),900);});

 await begin('07｜核对课程原文和知识来源');
 await cue('knowledge',async()=>{
  await nav('知识库');await fill(frame.locator('#knowledge-query'),'借用上限从七日改成三日后，哪些边界测试与需求版本证据需要重新核对？');
  const [response]=await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/knowledge/search')&&r.request().method()==='POST'),click(frame.getByRole('button',{name:/^检索知识/}))]);
  assert.equal(response.status(),200);const found=await response.json();assert.ok(found.hits.length&&found.hits.every(h=>h.scope==='platform_public'));report.retrieval={sources:found.hits.length,publicOnly:true,localEmbedding:true,chatGenerated:false};
  await show(frame.getByRole('heading',{name:'检索来源',exact:true}),900);
 });
 await cue('sources',async()=>{await click(frame.getByRole('button',{name:/展开原始片段/}).first());});

 await begin('08｜智能协作与总结');
 await cue('agent',async()=>{await nav('班级实训');await openProject();await tab('Agent 规划');});
 await cue('limits');
 await cue('closing',async()=>{await nav('班级实训');await show(frame.locator('table'),900);});
 report.plannedSeconds=report.captions.reduce((total,c)=>total+Math.max(c.audioSeconds+.55,c.actionSeconds),0);
 if(!quick)assert.ok(clock()<449,'Real operations exceeded the video budget; keep the recording and revise the plan, never accelerate speech');
 await at(450.6);
 const counts=(await pool.query("SELECT (SELECT count(*)::int FROM teaching_submissions) AS submissions,(SELECT count(*)::int FROM teaching_decisions WHERE decision='accept') AS accepted,(SELECT count(*)::int FROM practice_test_cases WHERE result='not_run') AS not_run,(SELECT count(*)::int FROM ai_call_receipts) AS model_calls")).rows[0];assert.deepEqual(counts,{submissions:2,accepted:0,not_run:10,model_calls:0});assert.deepEqual(report.pageErrors,[]);report.checks=counts;report.overlayChecks=await page.evaluate(()=>({subtitles:document.querySelectorAll('#recording-subtitle').length,pointers:document.querySelectorAll('#recording-pointer').length,extraToolbar:!!document.querySelector('#scope,#chapter,.caption-panel'),trail:!!document.querySelector('#trail'),iframeCount:document.querySelectorAll('iframe').length,originalRoot:!!document.querySelector('#root')}));assert.deepEqual(report.overlayChecks,{subtitles:1,pointers:1,extraToolbar:false,trail:false,iframeCount:0,originalRoot:true});report.status='recorded';await page.screenshot({path:fileURLToPath(new URL('final.png',out))});
 report.elapsedSeconds=clock();const video=page.video();await context.close();context=null;report.rawVideo=video?await video.path():null;
}catch(error){report.status='failed';report.failedStage=stage;report.errorType=error?.constructor?.name;report.safeError=/Timeout|Assertion/.test(error?.name??'')?String(error.message).slice(0,500):'Read REVIEW_PLACEHOLDER_575a8dfc08a84f40bc3b failure frame; no credentials logged';console.log('FAILED '+stage+' '+report.errorType);if(page&&!page.isClosed())await page.screenshot({path:fileURLToPath(new URL('failure.png',out))}).catch(()=>{});process.exitCode=1;}
finally{await context?.close();await browser?.close();await app?.close();await pool?.end();globalThis.fetch=originalFetch;report.finishedAt=new Date().toISOString();await checkpoint();console.log('Recording: '+fileURLToPath(new URL('recording.json',out)));}
