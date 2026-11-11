// Continuous real UI recording, visible pointer movement, live subtitles, no audio/cloud calls.
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
const require=createRequire(new URL('../apps/api/package.json',import.meta.url)),{Pool}=require('pg');
process.env.PLAYWRIGHT_BROWSERS_PATH=fileURLToPath(new URL('../.runtime/browsers/',import.meta.url));
const {chromium}=await import('playwright');
const out=new URL('../.runtime/silent-video-20261107-'+(quick?'rehearsal-':'')+randomUUID()+'/',import.meta.url);await mkdir(out,{recursive:true});
const front='http://127.0.0.1:5173',local=s=>['127.0.0.1','localhost','[::1]'].includes(new URL(s).hostname);
const originalFetch=globalThis.fetch;globalThis.fetch=(url,init)=>{if(!local(url instanceof Request?url.url:String(url)))throw Error('Non-local request blocked');return originalFetch(url,init);};
const report={status:'preparing',quick,requestedSeconds:480,scope:'continuous_isolated_REVIEW_PLACEHOLDER_575a8dfc08a84f40bc3b_real_ui',audio:false,paidModelCalls:0,primaryDatabaseModified:false,events:[],captions:[],chapters:[],pageErrors:[],knowledge:[],programmaticPageLoads:0,pointerMoves:0,clicks:0,scrolls:0};
let pool,app,browser,context,page,frame,origin,start=0,chapter='',history=false,project,teacher,student,stage='prepare',cursor={x:60,y:60};
const clock=()=>start?(performance.now()-start)/1000:0;
const pause=ms=>delay(quick?15:ms);
const b=(root,name)=>root.getByRole('button',{name,exact:true});
const l=(root,name)=>root.getByLabel(name,{exact:true});
async function checkpoint(){await writeFile(new URL('recording.json',out),JSON.stringify(report,null,2)+'\n');}
async function caption(text,hold=4200){report.captions.push({seconds:clock(),chapter,text,history});await page.evaluate(v=>window.videoText(v.chapter,v.text,v.history),{chapter,text,history});await pause(hold);}
async function at(seconds){if(!quick)await delay(Math.max(0,seconds*1000-(performance.now()-start)));}
async function begin(name){chapter=name;stage=name;report.chapters.push({title:name,startSeconds:clock()});console.log('CHAPTER '+name);await checkpoint();}
async function move(x,y){const from={...cursor},steps=quick?2:30;for(let i=1;i<=steps;i++){const p=i/steps,e=p*p*(3-2*p),bend=Math.sin(Math.PI*p)*14;await page.mouse.move(from.x+(x-from.x)*e,from.y+(y-from.y)*e+bend);if(!quick)await delay(20);}cursor={x,y};report.pointerMoves++;}
async function reveal(locator){await locator.waitFor({state:'attached'});const outer=await locator.evaluate(el=>el.ownerDocument.defaultView.parent===el.ownerDocument.defaultView),top=outer?0:100,bottom=outer?1070:900;for(let i=0;i<35;i++){const box=await locator.boundingBox();if(box&&box.y>=top&&box.y<bottom-40&&box.y+Math.min(box.height,160)<=bottom)return box;await move(1740,460);const amount=box&&box.y<top?-450:450;await page.mouse.wheel(0,amount);report.scrolls++;await pause(260);}throw Error('Control cannot be reached by visible scrolling');}
async function click(locator){const box=await reveal(locator);await move(Math.min(1870,box.x+Math.min(box.width/2,240)),Math.min(1060,box.y+Math.min(box.height/2,35)));await pause(200);const before=frame?await frame.evaluate(()=>location.pathname).catch(()=>''):'';await page.mouse.down();await pause(70);await page.mouse.up();report.clicks++;await pause(550);const after=frame?await frame.evaluate(()=>location.pathname).catch(()=>''):'';report.events.push({seconds:clock(),type:'visible_pointer_click',from:before,to:after});}
async function fill(locator,value){await click(locator);await locator.fill(value);await pause(400);}
async function show(locator,hold=3200){await reveal(locator);await pause(hold);}
async function nav(name){await click(frame.getByRole('navigation',{name:'主导航'}).getByRole('link',{name,exact:true}));await frame.locator('.connection-dot.online').waitFor();await pause(500);}
async function tab(name){await click(frame.getByRole('navigation',{name:'项目内导航'}).getByRole('button',{name,exact:true}));await pause(500);}
async function login(user){await frame.locator('#email').waitFor();await fill(frame.locator('#email'),user.email);await fill(frame.locator('#password'),user.password);await click(b(frame,/登录工作空间/));await frame.locator('#workspace-role').waitFor();await pause(450);}
async function teacherHome(){const select=frame.locator('#workspace-role');await click(select);await select.press('End');await select.press('Enter');await frame.getByRole('heading',{name:'教师工作台',exact:true}).waitFor();await pause(550);}
async function swap(user,isTeacher=false){await caption(isTeacher?'退出学生账号，登录独立教师账号，查看已经提交的固定快照。':'退出教师账号，登录独立学生账号，继续自己的私有项目。',1600);await click(frame.getByRole('button',{name:/^退出登录/}));await login(user);if(isTeacher)await teacherHome();else await nav('班级实训');}
async function openProject(){await click(b(frame,'打开项目与追踪'));await frame.getByRole('navigation',{name:'项目内导航'}).getByRole('button',{name:'AI 项目导师',exact:true}).waitFor();}
async function submit(note){await click(b(frame,'核对成果并提交'));await fill(l(frame,'提交说明'),note);await caption('提交前展示共享内容和实际缺口。勾选确认后，教师才能读取本次固定快照。',2800);await click(frame.getByLabel('我已核对快照和缺口，同意提交给本班教师',{exact:true}));await click(b(frame,'确认共享并提交'));await frame.getByText('固定快照已提交，教师可查看本次内容',{exact:true}).waitFor();}
async function latest(){const row=frame.locator('tbody tr').filter({hasText:kit.assignmentTitle}).filter({hasText:'最新'});await click(b(row,'查看快照与反馈'));await frame.getByRole('heading',{name:'起草教师反馈',exact:true}).waitFor();}
try{
 const isolated=await isolatedVerificationDatabase();report.isolation=isolated.evidence;
 const embedding=loadEmbeddingConfig();assert.ok(embedding&&local(embedding.baseUrl));pool=new Pool({connectionString:isolated.env.DATABASE_URL,connectionTimeoutMillis:4000,statement_timeout:15000});
 app=await createApp({pool,database:{query:s=>pool.query(s),end:async()=>{}},projectStore:new PgProjectStore(pool),corsOrigin:front,embeddingConfig:embedding});origin=await app.listen({host:'127.0.0.1',port:0});
 const users=[];for(const [name,email] of [['演示教师（合成账号）','teacher-video@example.test'],['演示学生（合成账号）','student-video@example.test']]){const password=randomBytes(18).toString('base64url');const r=await app.inject({method:'POST',url:'/auth/register',payload:{name,email,password}});assert.equal(r.statusCode,201);users.push({...r.json(),name,email,password});}[teacher,student]=users;
 await pool.query("INSERT INTO teaching_roles(user_id,role) VALUES($1,'teacher')",[teacher.user.id]);project=await importRecordingMaterials(pool,{teacherEmail:teacher.email,studentEmail:student.email,kit,apply:true});
 for(const lesson of curriculum){const saved=await savePublicLesson(pool,lesson),indexed=await indexDocument(pool,null,saved.id,embedding);report.knowledge.push({id:lesson.lessonId,status:indexed?.status,chunks:indexed?.chunks});}assert.ok(report.knowledge.length===51&&report.knowledge.every(x=>x.status==='ready'));
 browser=await chromium.launch({headless:true,channel:'msedge'});context=await browser.newContext({viewport:{width:1920,height:1080},reducedMotion:'reduce',...(quick?{}:{recordVideo:{dir:fileURLToPath(out),size:{width:1920,height:1080}}})});
 await context.addInitScript(()=>{if(window.parent===window)return;const send=e=>parent.postMessage({kind:'video-pointer',x:e.clientX,y:e.clientY,down:e.type==='pointerdown'},location.origin);addEventListener('pointermove',send);addEventListener('pointerdown',send);});
 page=await context.newPage();page.setDefaultTimeout(20000);page.on('pageerror',()=>report.pageErrors.push(stage));
 await page.route('**/*',async r=>{const u=new URL(r.request().url());if(!local(u.href))return r.abort();if(u.pathname==='/silent-recording-stage')return r.fulfill({status:200,contentType:'text/html;charset=utf-8',body:await readFile(new URL('../demo/silent-video-stage.html',import.meta.url))});if(u.pathname==='/recording-history')return r.fulfill({status:200,contentType:'text/html;charset=utf-8',body:await readFile(new URL('../output/ai-review-v10-444998a5-da9b-4796-9825-d2df17741b6e/read-responses.html',import.meta.url))});if(u.pathname.startsWith('/api/'))return r.fulfill({response:await r.fetch({url:origin+u.pathname.slice(4)+u.search})});return r.continue();});
 // The only programmatic page load is this initial recording canvas; all subsequent routes use visible controls.
 await page.goto(front+'/silent-recording-stage');report.programmaticPageLoads++;frame=page.frame({name:'workspace'});assert.ok(frame);await frame.locator('#email').waitFor();start=performance.now();report.status='recording';
 await begin('01｜痛点与教学任务');
 await caption('工序智伴：让需求变化后，任务、测试和交付证据继续对得上。',4500);
 await caption('下面使用隔离环境中的合成师生账号，连续操作真实网站；本片无配音。',2500);
 await login(teacher);await teacherHome();
 await caption('教师工作台只读取授权班级和已提交成果。这里准备了校园物品借用课题。',2200);
 const task=()=>frame.locator('.teaching-task').filter({hasText:kit.assignmentTitle});await click(task().locator('summary',{hasText:'任务要求与验收依据'}));
 await caption('首版要求：借用一至七天、禁止自审批、库存变更可追踪、归还记录保留。',2800);await show(task().locator('.teaching-pre').first(),1800);
 await at(42);
 await begin('02｜需求、测试设计与项目文档');await swap(student);await openProject();await tab('AI 项目导师');
 await caption('学生领取后拥有自己的私有项目。首先阅读原需求，再明确确认当前版本。',2100);await show(frame.locator('#requirement'),1800);await click(frame.getByRole('button',{name:/确认最新版本/}));await frame.getByRole('button',{name:/确认最新版本/}).waitFor({state:'detached'});
 await tab('智能测试');await frame.getByText('完整版本共 10 条 · 第 1 页 · 本页 10 条',{exact:true}).waitFor();await caption('十条用例是导入的教学设计，全部未执行；生成或保存设计不等于程序运行通过。',3000);
 await show(frame.locator('.case-item').filter({hasText:'七日上界与八日拒绝'}),2000);await caption('原规则的边界设计：七日应允许、八日应拒绝。预期结果与真实执行结果分开保存。',3300);
 await tab('项目文档');await click(frame.getByRole('button',{name:/软件设计文档/}));await show(frame.locator('#doc-content'),1800);await caption('六份文档标注了导入来源。设计里的候选任务需要审核，尚未成为正式 Agent 计划。',3000);
 await click(frame.locator('#doc-content'));await frame.locator('#doc-content').press('Control+Home');await page.mouse.wheel(0,200);report.scrolls++;await pause(700);
 await at(128);
 await begin('03｜核对快照并提交');await nav('班级实训');await caption('学生主动提交之后，教师才可查看该次固定快照，后续草稿不会悄悄改写旧提交。',2600);
 await submit('合成教学流程演示：提交七日需求、10条未执行用例和6份设计文档；正式任务和真实执行证据仍有缺口。');await caption('第一次提交已保存。缺口保持可见，不为演示把未执行结果改成通过。',2700);await at(170);
 await begin('04｜教师反馈、退回与任务改版');await swap(teacher,true);await latest();
 await caption('教师查看提交时的版本和证据。这里发布的是合成案例的流程示例，不是独立教师质量评审。',2800);
 const form=frame.locator('form').filter({has:frame.getByRole('heading',{name:'起草教师反馈',exact:true})});
 await fill(l(form,'指出依据、缺口与下一步'),'合成教学流程示例：R02与CASE-04已有禁止自审批要求，请补充明确拒绝提示与库存不变的设计；三日版发布后重新核对边界与需求版本。以上不是借用程序的执行诊断，也不是独立教师评价。');
 await caption('反馈应说明依据、缺口和下一步。已有的自审批条款不能被误说成缺失。',2400);await click(b(form,'保存草稿'));await click(b(frame,'我已核对内容，确认发布'));
 await fill(l(frame,'本次验收或退回的理由'),'合成流程退回：补充拒绝提示与新版期限边界，保留尚未执行、尚未复核的缺口。');await click(frame.getByLabel('已核对提交版本、实际缺口与证据；验收不会自动将测试改为通过',{exact:true}));await click(b(frame,'退回并要求修改'));await frame.getByText('已退回，学生可修改并重新提交',{exact:true}).waitFor();
 await caption('反馈发布并退回后，学生可以修改再提交；第一次快照与反馈继续保留。',2500);
 await nav('教学工作台');await click(b(task(),'编辑或修订任务'));const edit=frame.getByRole('form',{name:'实训任务编辑器'});await l(edit,'任务要求').waitFor();await show(l(edit,'变更说明'),1600);
 await caption('将借用上限从七日改为三日。修订草稿已经准备，发布前核对变更说明与适用范围。',3000);assert.equal(await l(edit,'任务要求').inputValue(),kit.briefV2);await click(b(task(),'确认并发布任务'));await frame.getByText('任务版本已由教师确认发布',{exact:true}).waitFor();await at(265);
 await begin('05｜学生明确处理变更');await swap(student);await frame.getByRole('region',{name:'已领取任务变更',exact:true}).waitFor();await click(frame.getByText('比较新版要求与验收依据',{exact:true}));
 await caption('已领取学生可以比较新旧要求。采纳任务新版不会自动覆盖自己的个人需求和证据。',3100);await show(frame.getByText('比较新版要求与验收依据',{exact:true}),1500);
 await fill(l(frame,'变更处理说明'),'合成流程示例：采纳三日规则；个人需求、边界用例和文档仍需手动核对，不继承旧版验证结论。');await click(frame.getByLabel('已阅读版本差异；个人需求、测试和文档由我手动核对与修订',{exact:true}));await click(b(frame,'采纳任务新版，保留个人项目'));
 await openProject();await tab('AI 项目导师');await fill(frame.locator('#requirement'),kit.briefV2+'\n\n合成返修设计：3日允许；4日与7日拒绝，不产生有效申请。自审批显示明确拒绝提示，申请状态与库存不变。上述仍为待执行设计，新版测试与正式任务尚待完善。');
 await caption('现在手动保存三日版需求，并补充三日、四日、七日和自审批拒绝的验收设计。',2000);await click(frame.getByRole('button',{name:/保存需求草稿/}));await click(frame.getByRole('button',{name:/确认最新版本/}));await frame.getByRole('button',{name:/确认最新版本/}).waitFor({state:'detached'});await caption('教师任务版本与学生需求版本各自可追溯。明确保存和确认后，新需求才成为当前依据。',2300);await at(345);
 await begin('06｜变化后的缺口与再次提交');await tab('智能测试');await frame.getByText('此需求版本暂无测试用例，其他版本的结果不会自动继承。',{exact:true}).waitFor();await caption('当前三日版暂无正式用例。旧版十条可以查历史，但不会自动变成新版的验证依据。',3200);
 const versions=l(frame,'测试来源需求版本');await click(versions);await versions.selectOption(project.requirementId);await pause(800);await show(frame.getByText('完整版本共 10 条 · 第 1 页 · 本页 10 条',{exact:true}),1800);await caption('保留旧记录，才能核对变化。存在关联、设计完成和执行通过是不同状态。',2300);await click(versions);await versions.selectOption('current');
 await tab('项目文档');await show(frame.locator('.document-source-state'),1800);await caption('文档也提示历史需求须复核。原来就缺少的生成依据快照不会被包装成已验证来源。',2400);
 await nav('班级实训');await submit('合成教学流程第二次提交：三日需求与拒绝提示设计已更新，旧七日用例保留历史；当前正式测试、任务和执行证据仍待完善。');await caption('再次提交产生第二个固定快照。演示保留待教师复核，不自动验收或登记测试通过。',2400);await at(414);
 await begin('07｜检索课程原文与来源');await nav('知识库');await caption('知识检索连接教学资料和项目问题。这里调用本地向量服务，不发送新的收费聊天请求。',2400);
 await fill(frame.locator('#knowledge-query'),'借用上限从七日改成三日后，哪些边界测试与需求版本证据需要重新核对？');
 const [response]=await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/knowledge/search')&&r.request().method()==='POST'),click(frame.getByRole('button',{name:/^检索知识/}))]);assert.equal(response.status(),200);const found=await response.json();assert.ok(found.hits.length&&found.hits.every(h=>h.scope==='platform_public'));report.retrieval={sources:found.hits.length,publicOnly:true,localEmbedding:true,chatGenerated:false};
 await show(frame.getByRole('heading',{name:'检索来源',exact:true}),1800);await click(frame.getByRole('button',{name:/展开原始片段/}).first());await caption('展开实际检索片段，核对原文与来源。原创教学示例不是学校制度，引用存在也不等于支持所有结论。',3500);await at(455);
 await begin('08｜真实 AI 记录与总结');history=true;await caption('下面打开另一组合成案例的已保存真实响应；属于历史回放，不是当前课题的现场生成。',1800);await click(page.getByRole('link',{name:'历史AI材料（只读）',exact:true}));await frame.locator('h1').waitFor();await caption('十三段曾返回回答并通过双向结构检查；合并的86项超过80项上限，因此仍被阻止采纳。',2500);
 await click(page.getByRole('link',{name:'返回网站',exact:true}));await frame.locator('#workspace-role').waitFor();history=false;await nav('班级实训');await show(frame.locator('table'),1400);await caption('AI 提供建议，平台保留版本与过程，重要判断仍需人完成。让依据、变化和证据都说得清楚。',2000);await caption('工序智伴｜感谢观看。真实人工质量审核与尚未执行的测试，继续保留待完成状态。',1200);await at(480);
 const counts=(await pool.query("SELECT (SELECT count(*)::int FROM teaching_submissions) AS submissions,(SELECT count(*)::int FROM teaching_decisions WHERE decision='accept') AS accepted,(SELECT count(*)::int FROM practice_test_cases WHERE result='not_run') AS not_run,(SELECT count(*)::int FROM ai_call_receipts) AS model_calls")).rows[0];assert.deepEqual(counts,{submissions:2,accepted:0,not_run:10,model_calls:0});assert.deepEqual(report.pageErrors,[]);report.checks=counts;report.elapsedSeconds=clock();report.status='recorded';await page.screenshot({path:fileURLToPath(new URL('final.png',out))});
 const video=page.video();await context.close();context=null;report.rawVideo=video?await video.path():null;
}catch(error){report.status='failed';report.failedStage=stage;report.errorType=error?.constructor?.name;report.safeError=/Timeout|Assertion/.test(error?.name??'')?String(error.message).slice(0,500):'Read REVIEW_PLACEHOLDER_575a8dfc08a84f40bc3b failure frame; no credentials logged';console.log('FAILED '+stage+' '+report.errorType);if(page&&!page.isClosed())await page.screenshot({path:fileURLToPath(new URL('failure.png',out))}).catch(()=>{});process.exitCode=1;}
finally{await context?.close();await browser?.close();await app?.close();await pool?.end();globalThis.fetch=originalFetch;report.finishedAt=new Date().toISOString();await checkpoint();console.log('Recording: '+fileURLToPath(new URL('recording.json',out)));}
