// Local synthetic workflow recording. No production accounts or remote model calls.
import {createRequire} from 'node:module';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile,copyFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {PgProjectStore} from '../apps/api/dist/project-store.js';
import {registerProjectRoutes} from '../apps/api/dist/project-routes.js';
import {registerAgentRoutes} from '../apps/api/dist/agent/routes.js';
import {registerPracticeRoutes} from '../apps/api/dist/practice/routes.js';
import {registerTraceRoutes} from '../apps/api/dist/trace/routes.js';
import {registerDocumentRoutes} from '../apps/api/dist/documents/routes.js';
import {PgDocumentStore} from '../apps/api/dist/documents/store.js';
import {registerGrowthRoutes} from '../apps/api/dist/growth/routes.js';
import {registerKnowledgeRoutes} from '../apps/api/dist/rag/routes.js';
import {loadConfig} from '../apps/api/dist/config.js';
import {loadEmbeddingConfig,saveText,indexDocument} from '../apps/api/dist/rag/service.js';

const root=fileURLToPath(new URL('../',import.meta.url));
const quick=process.argv.includes('--quick');
const ffmpeg=process.argv.find(a=>a.startsWith('--ffmpeg='))?.slice(9);
const narration=path.resolve(root,process.argv.find(a=>a.startsWith('--narration='))?.slice(12)??'.runtime/demo-v3-narration');
const narrationRelative=path.relative(path.join(root,'.runtime'),narration);
assert.ok(narrationRelative&&narrationRelative!=='..'&&!narrationRelative.startsWith('..'+path.sep)&&!path.isAbsolute(narrationRelative),'Narration must be in project .runtime.');
const narrationManifest=JSON.parse((await readFile(path.join(narration,'manifest.json'),'utf8')).replace(/^\uFEFF/,''));
assert.ok(ffmpeg&&path.isAbsolute(ffmpeg),'Supply a trusted local --ffmpeg=absolute-path executable.');
assert.ok(process.argv.slice(2).every(a=>a==='--quick'||a.startsWith('--ffmpeg=')||a.startsWith('--narration=')),'Unknown argument.');
const require=createRequire(new URL('../apps/api/package.json',import.meta.url));
require('dotenv').config(); // Normal app loader; values are never reported.
const settings=loadConfig(),embedding=loadEmbeddingConfig();
const local=value=>['localhost','127.0.0.1','[::1]'].includes(new URL(value).hostname);
assert.ok(settings.DATABASE_URL&&local(settings.DATABASE_URL),'Local database required.');
assert.ok(embedding&&local(embedding.baseUrl),'A local Embedding provider is required; no cloud fallback.');
const nativeFetch=globalThis.fetch;
globalThis.fetch=(url,init)=>{if(!local(typeof url==='string'||url instanceof URL?url:url.url))throw Error('External request blocked in recording.');return nativeFetch(url,init);};
const directory=path.join(root,'.runtime',`demo-draft-${quick?'quick-':''}${randomUUID()}`);
await mkdir(directory,{recursive:true});
// Use a dedicated recording-tool cache, leaving the user's Playwright installation untouched.
const projectRequire=createRequire(new URL('../package.json',import.meta.url));
const pwRequire=createRequire(projectRequire.resolve('playwright/package.json'));
const core=path.dirname(pwRequire.resolve('playwright-core/package.json'));
const descriptor=JSON.parse(await readFile(path.join(core,'browsers.json'),'utf8')).browsers.find(b=>b.name==='ffmpeg');
const cache=path.join(root,'.runtime','demo-tools'),encoderDir=path.join(cache,`ffmpeg-${descriptor.revision}`);
await mkdir(encoderDir,{recursive:true});
await copyFile(ffmpeg,path.join(encoderDir,process.platform==='win32'?'ffmpeg-win64.exe':'ffmpeg-linux'));
process.env.PLAYWRIGHT_BROWSERS_PATH=cache;
const {chromium}=await import('playwright');
const {Pool}=require('pg'),Fastify=require('fastify');
const pool=new Pool({connectionString:settings.DATABASE_URL,connectionTimeoutMillis:3000,statement_timeout:15000});
const store=new PgProjectStore(pool),app=Fastify({logger:false});
const ai={baseUrl:'https://example.invalid',apiKey:'test-only-placeholder',model:'DEMO-FIXTURE-NOT-REAL-AI',timeoutMs:1000};
await registerProjectRoutes(app,store);
await registerTraceRoutes(app,store,pool);
await registerGrowthRoutes(app,store,pool);
await registerKnowledgeRoutes(app,store,pool,embedding,undefined);
await registerAgentRoutes(app,store,pool,ai,embedding,{complete:async(_config,messages)=>{
  const content=messages[1].content,keys=[...new Set(content.match(/REQ-[a-f0-9]{16}/g))];
  const evidence=JSON.parse(content.split('实际检索资料：\n')[1].split('\n上次校验反馈：')[0]);
  return JSON.stringify({tasks:[['审批留痕与归属规则','需求'],['实现申请与库存约束','开发'],['检查越权与回滚分支','审查'],['核对边界与失败证据','测试'],['整理版本化交付说明','交付']].map(([title,stage],i)=>({key:`t${i+1}`,title,stage,description:'合成替身计划：请按当前确认需求实施并保留可核对记录。',deliverable:'说明操作、预期结果与实际结果，按需求逐项人工验收。',dependsOn:i?[`t${i}`]:[],citations:evidence.length?[evidence[0].id]:[],requirementIds:i===0?[keys[0]]:keys}))});
}});
await registerPracticeRoutes(app,store,pool,ai,{embedding,complete:async(_config,messages)=>messages[0].content.includes('代码审查')?'# 合成审查建议（聊天替身）\n\n语法解析没有报错，但这不能证明代码正确。请结合确认需求补充审批留痕、库存并发和失败回滚的验收。\n\n建议尚未验证；本段没有执行代码。提供的资料可在右侧逐条核对。':JSON.stringify({cases:['normal','boundary','exception'].map((category,i)=>({category,title:['审批记录保留与归属','库存为零时拒绝借用','保存失败时回滚申请'][i]+' · 合成用例',preconditions:'合成工程演示，设备借用应用尚未执行',steps:['以申请人身份提交借用，审批后检查留存记录','库存为零时提交申请，核对拒绝状态','模拟保存失败，核对没有半完成审批记录'][i],expected:['审批记录可追溯，其他学生不可见','不能借出，库存不为负数','保留原状态，不生成重复记录'][i],requirementIds:[messages[1].content.match(/REQ-[a-f0-9]{16}/)[0]]}))})});
await registerDocumentRoutes(app,store,new PgDocumentStore(pool),ai,async()=> '# 设备借用实训 · 合成文档替身\n\n## 目的\n练习审批留痕、库存约束与失败回滚。\n\n## 当前状态\n已形成需求、任务和测试建议。应用尚未在本段演示中实施。测试登记为未执行或阻塞，不能写为通过。\n\n## 待补材料\n真实接口、部署信息、实际执行证据与团队信息待补。\n\n## 交付前核对\n逐条检查当前版本、人工审核依据与用例修订。');
app.get('/health',async()=>({status:'ok',service:'gongxu-api'}));
app.get('/ready',async()=>({status:'ready'}));
app.get('/ai/status',async()=>({configured:true,model:ai.model}));
const story=JSON.parse(await readFile(path.join(root,'docs/demo-v3/storyboard.json'),'utf8'));
let sourceCommit=null,sourceModified=null;
try{sourceCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();sourceModified=Boolean(execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim());}catch{/* A source ZIP may not contain Git metadata. */}
const report={scope:story.scope,voice:story.voice,quick,startedAt:new Date().toISOString(),sourceCommit,sourceModified,model:'controlled_fixture_no_remote_calls',narrationDirectory:path.relative(root,narration),scenes:[],pageErrors:0};
let auth={},browser,context,page,stage='setup',videoPath,started;
const call=(method,url,payload)=>app.inject({method,url,headers:auth,...(payload===undefined?{}:{payload})});
const requirement='审批必须保留申请人、审批状态与操作记录。\n学生只能查看自己的借用申请，不得读取其他同学的材料。\n库存不足时必须拒绝借用，库存不得出现负数。\n保存失败必须回滚，不得产生重复审批记录。';
const pause=ms=>delay(quick?100:ms);
function wavSeconds(buffer){let rate,bytes;for(let p=12;p+8<=buffer.length;){const kind=buffer.toString('ascii',p,p+4),length=buffer.readUInt32LE(p+4);if(kind==='fmt ')rate=buffer.readUInt32LE(p+16);if(kind==='data')bytes=length;p+=8+length+(length%2);}assert.ok(rate&&bytes);return bytes/rate;}
async function scene(id,action){
  stage=id;const spec=story.scenes.find(s=>s.id===id),start=performance.now();console.log(`SCENE ${id}`);
  const audio=await readFile(path.join(narration,id+'.wav'));
  const audioSha256=createHash('sha256').update(audio).digest('hex'),narrationSha256=createHash('sha256').update(spec.narration).digest('hex');
  const manifest=narrationManifest.scenes.find(row=>row.id===id);
  assert.equal(manifest?.textSha256,narrationSha256,'Narration must match this scene text. Regenerate into a new directory.');assert.equal(manifest.audioSha256,audioSha256,'Narration audio changed after generation.');
  const audioSeconds=wavSeconds(audio),target=quick?0:Math.max(audioSeconds+2,spec.minimumSeconds);
  await action();
  await page.screenshot({path:path.join(directory,id+'.png')});
  const remaining=target*1000-(performance.now()-start);if(remaining>0)await delay(remaining);
  report.scenes.push({...spec,startSeconds:(start-started)/1000,durationSeconds:(performance.now()-start)/1000,audioSeconds,audioSha256,narrationSha256});
}
try{
  const registration=await call('POST','/auth/register',{name:'工程演示 · 合成账号',email:`demo-${randomUUID()}@example.test`,password:randomBytes(24).toString('base64url')});assert.equal(registration.statusCode,201);
  const account=registration.json();auth={authorization:`Bearer ${account.token}`};
  const projectResponse=await call('POST','/projects',{name:'设备借用实训 · 合成演示',description:'仅演示工程流程，不代表真实学生成果；聊天模型为明确替身。'});assert.equal(projectResponse.statusCode,201);const projectId=projectResponse.json().project.id,base=`/projects/${projectId}`;
  const knowledge=await saveText(pool,account.user.id,'设备借用实训规范 · 原创合成资料','审批留痕规范：借用审批必须保存申请人、审批状态和操作记录。申请记录仅本人和有权限的审批者可见。库存不足必须拒绝借用；保存失败必须回滚，避免产生半完成或重复审批。验收需要按当前需求版本执行并保留说明。');
  assert.equal((await indexDocument(pool,account.user.id,knowledge.id,embedding)).status,'ready');
  const apiAddress=await app.listen({host:'127.0.0.1',port:0});
  browser=await chromium.launch({headless:true,channel:process.platform==='win32'?'msedge':undefined});
  context=await browser.newContext({viewport:{width:1920,height:960},recordVideo:{dir:directory,size:{width:1920,height:1080}},reducedMotion:'reduce'});
  await context.addInitScript(token=>localStorage.setItem('gongxu_token',token),account.token);
  page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',()=>report.pageErrors++);
  const origin='http://127.0.0.1:5173';
  await page.route('**/*',async route=>{const url=new URL(route.request().url());if(url.origin!==origin)return route.abort();if(!url.pathname.startsWith('/api/'))return route.continue();const response=await route.fetch({url:apiAddress+url.pathname.slice(4)+url.search});await route.fulfill({response});});
  const go=async suffix=>{await page.goto(origin+(suffix.startsWith('/')?suffix:base+'/'+suffix));await page.waitForLoadState('domcontentloaded');};
  started=performance.now();
  await scene('intro',async()=>{await go(base);await page.getByRole('heading',{name:'项目实训路径',exact:true}).waitFor();});
  await scene('requirements',async()=>{
    await go('requirements');await page.locator('#requirement').fill(requirement);
    await pause(6000);await page.getByRole('button',{name:/保存需求草稿/}).click();await pause(5000);await page.getByRole('button',{name:/确认最新版本/}).click();
    await page.getByRole('region',{name:'需求到验证证据追踪'}).getByText('原文与版本来源',{exact:true}).waitFor();
  });
  const first=(await call('GET',base)).json().requirements.find(row=>row.status==='confirmed');assert.ok(first);
  await scene('guard',async()=>{
    await page.locator('#requirement').fill(requirement+'\n未保存演示片段：先保留再核对。');
    const leave=page.getByRole('link',{name:'知识库',exact:true}).first();await leave.click();
    const dialog=page.getByRole('dialog',{name:'保留未保存的编辑'});await dialog.waitFor();await pause(16000);await page.keyboard.press('Escape');
    assert.match(await page.locator('#requirement').inputValue(),/未保存演示片段/);await pause(9000);
    await leave.click();await pause(2000);await dialog.getByRole('button',{name:'放弃并继续'}).click();await page.locator('#knowledge-query').waitFor();
  });
  await scene('knowledge',async()=>{
    await page.locator('#knowledge-query').fill('审批时需要保留什么记录，如何避免其他学生越权？');
    await page.getByRole('button',{name:/检索知识/}).click();await page.getByRole('heading',{name:'检索来源',exact:true}).waitFor();
    await page.getByRole('heading',{name:'检索来源',exact:true}).scrollIntoViewIfNeeded();
  });
  await scene('agent',async()=>{
    await go('agent');await page.getByRole('button',{name:/开始规划/}).click();await page.locator('#plan-review-note').waitFor();
    await page.locator('.steps-list details').first().click();await page.locator('.steps-list').scrollIntoViewIfNeeded();await pause(9000);
    await page.getByText(/核对实际检索原文/).click();await page.getByText(/核对实际检索原文/).scrollIntoViewIfNeeded();await pause(9000);
    await page.locator('#plan-review-note').fill('合成演示审核：已核对条目与检索原文；计划尚未实施，后续必须登记实际验证。');
    await pause(5000);await page.getByRole('checkbox').check();await pause(4000);await page.getByRole('button',{name:/确认计划并创建任务/}).click();
    await page.getByText('计划已确认，任务和人工审核记录已保存。',{exact:true}).waitFor();
    await page.locator('.confirmed-task-panel').scrollIntoViewIfNeeded();
  });
  await scene('review',async()=>{
    await go('reviews');await page.locator('#code-input').fill('type BorrowRequest = { ownerId: string; stock: number };\nexport function mayBorrow(request: BorrowRequest, userId: string) {\n  return request.stock > 0 && request.ownerId === userId;\n}');
    await page.getByRole('button',{name:'保存代码草稿',exact:true}).click();await page.getByText(/代码草稿已保存/).waitFor();await pause(5000);
    await page.locator('#review-scope').selectOption('project');await page.getByRole('button',{name:'提交审查',exact:true}).click();await page.getByRole('heading',{name:'合成审查建议（聊天替身）',exact:true}).waitFor();
    const sources=page.getByRole('region',{name:'本次审查依据'});await sources.getByText(/核对提交时的完整需求/).click();await pause(5000);await sources.getByText('设备借用实训规范 · 原创合成资料',{exact:false}).click();await sources.scrollIntoViewIfNeeded();
    const review=(await call('GET',base+'/code-reviews')).json().reviews[0];assert.equal(review.reviewContext.requirement.id,first.id);assert.equal(review.reviewContext.retrieval.status,'retrieved');assert.ok(review.reviewContext.retrieval.sources.length>0);assert.equal(review.syntaxFindings.length,0);
  });
  await scene('tests',async()=>{
    await go('tests');await page.getByRole('button',{name:/生成测试用例/}).click();const card=page.locator('.case-item').filter({hasText:'审批记录保留与归属'});await card.waitFor();
    await card.scrollIntoViewIfNeeded();await pause(11000);
    await card.getByLabel('人工执行结果',{exact:true}).selectOption('blocked');await card.getByLabel('执行说明 / 证据',{exact:true}).fill('合成演示：设备借用应用尚未部署和执行，因此登记阻塞；不代表自动化测试通过。');
    await pause(7000);
    await card.getByRole('button',{name:'保存执行结果',exact:true}).click();await card.getByText(/正常 · 阻塞/).waitFor();await card.scrollIntoViewIfNeeded();
  });
  await scene('trace',async()=>{
    const trace=page.getByRole('region',{name:'需求到验证证据追踪'});await trace.getByText('原文与版本来源',{exact:true}).waitFor();
    const data=(await call('GET',base+'/trace')).json(),task=data.tasks.find(t=>t.title==='审批留痕与归属规则'),test=data.cases.find(c=>c.title.startsWith('审批记录'));
    for(const [kind,id,note] of [['task',task.id,'人工核对：任务实现当前条目的审批留痕与归属规则。'],['case',test.id,'人工核对：用例检查审批记录；当前仍为阻塞，没有成功执行证据。']]){
      await trace.getByLabel('关联类型',{exact:true}).selectOption(kind);await trace.getByLabel('当前版本对象',{exact:true}).selectOption(id);await trace.getByLabel('审核依据',{exact:true}).fill(note);
      await pause(6000);
      const [response]=await Promise.all([page.waitForResponse(r=>r.url().endsWith('/trace/links')&&r.request().method()==='POST'),trace.getByRole('button',{name:'确认关联',exact:true}).click()]);assert.equal(response.status(),200);await trace.getByText('审核已保存。关联确认不等于需求已验证。',{exact:true}).waitFor();
    }
    const chain=trace.getByRole('region',{name:'任务与测试验证链'});await chain.getByLabel('验证链开发任务').selectOption(task.id);await chain.getByLabel('验证链测试用例').selectOption(test.id);await chain.getByLabel('任务验证依据').fill('此用例用于检查该任务的审批留痕产物，仍需实施后实际执行。');
    await pause(6000);const [response]=await Promise.all([page.waitForResponse(r=>r.url().endsWith('/trace/task-tests')&&r.request().method()==='POST'),chain.getByRole('button',{name:'确认任务与用例配对'}).click()]);assert.equal(response.status(),200);await chain.getByText(/人工登记阻塞/).waitFor();await chain.getByText('核对人工审核与执行说明',{exact:true}).click();await chain.scrollIntoViewIfNeeded();
  });
  await scene('documents',async()=>{
    await go('documents');await page.getByRole('button',{name:/生成草稿/}).click();await page.locator('#doc-content').waitFor();await page.getByText('已生成草稿，请核实并编辑。',{exact:true}).waitFor();
    await pause(9000);const content=await page.locator('#doc-content').inputValue();await page.locator('#doc-content').fill(content+'\n\n人工补充：当前只有合成实训流程与阻塞说明，尚不能验收借用应用。');await pause(5000);await page.getByRole('button',{name:/保存文档/}).click();await page.getByText('已保存修订 2。',{exact:true}).waitFor();
    await pause(5000);await page.getByRole('button',{name:/修订记录 展开/}).click();await page.locator('.document-history summary').first().click();await page.locator('.document-history').scrollIntoViewIfNeeded();
  });
  await scene('change',async()=>{
    await go('requirements');await page.locator('#requirement').fill(requirement.replace('审批必须保留','双人审批必须共同确认，并保留'));await page.getByRole('button',{name:/保存需求草稿/}).click();await page.getByRole('button',{name:/确认最新版本/}).click();
    await page.getByRole('region',{name:'需求到验证证据追踪'}).getByText('原文与版本来源',{exact:true}).waitFor();await pause(5000);await go('tests');await page.getByText('此需求版本暂无测试用例，其他版本的结果不会自动继承。',{exact:true}).waitFor();await pause(16000);
    await page.getByLabel('测试来源需求版本').selectOption(first.id);await page.locator('.case-item').first().waitFor();assert.match(await page.getByLabel('测试来源需求版本').locator('option:checked').innerText(),/历史/);
  });
  await scene('growth',async()=>{
    await go('/growth');await page.getByRole('heading',{name:'当前版本任务进度',exact:true}).waitFor();assert.ok((await page.getByRole('region',{name:'任务进度',exact:true}).innerText()).includes('共 0 项'));await pause(9000);
    await page.getByLabel('任务与测试统计范围').selectOption('history');await page.getByRole('heading',{name:'历史任务状态',exact:true}).waitFor();assert.ok((await page.getByRole('region',{name:'任务进度',exact:true}).innerText()).includes('共 5 项'));await pause(10000);
    await page.getByLabel('任务与测试统计范围').selectOption('current');await page.getByRole('heading',{name:'当前版本任务进度',exact:true}).waitFor();
  });
  assert.equal(report.pageErrors,0);report.status='recorded';
}catch(error){report.status='failed';report.failedStage=stage;report.errorType=error.constructor.name;console.log(`FAILED ${stage} ${error.constructor.name}`);if(page)await page.screenshot({path:path.join(directory,'failure.png')}).catch(()=>{});process.exitCode=1;}
finally{
  if(page){const video=page.video();await context.close();videoPath=await video.path();report.video=path.basename(videoPath);}
  await browser?.close();if(auth.authorization)await call('POST','/auth/logout').catch(()=>{});await app.close();await pool.end();
  report.finishedAt=new Date().toISOString();await writeFile(path.join(directory,'recording.json'),JSON.stringify(report,null,2));console.log(`Recording report: ${directory}`);
}
