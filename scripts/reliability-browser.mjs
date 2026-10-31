import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

// Controlled UI regression only: all API traffic is intercepted; no model or DB calls.
const origin = new URL(process.env.SMOKE_WEB_URL || 'http://127.0.0.1:5173');
if (!['127.0.0.1','localhost','[::1]'].includes(origin.hostname) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw Error('Loopback origin required');
const directory = new URL(`../.runtime/reliability-ui-${randomUUID()}/`,import.meta.url);
await mkdir(directory,{recursive:true});
const report={scope:'controlled_browser_responses',realDatabase:false,realModel:false,checks:[],startedAt:new Date().toISOString()};
const browser=await chromium.launch({headless:true,channel:process.env.SMOKE_BROWSER_CHANNEL || (process.platform==='win32'?'msedge':undefined)});
const A='11111111-1111-4111-8111-111111111111', B='22222222-2222-4222-8222-222222222222';
const RA='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', RB='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const now='2026-10-31T12:00:00Z';
const project=id=>({id,name:id===A?'受控项目 A':'受控项目 B',description:'合成测试，不是真实业务数据',status:'active',createdAt:now,updatedAt:now});
const detail=(id,content)=>({project:project(id),requirements:[{id:id===A?RA:RB,projectId:id,version:1,status:'draft',content:content||`项目 ${id===A?'A':'B'} 的需求正文`,createdAt:now}]});
async function scenario(name,work){
 const context=await browser.newContext({viewport:{width:1440,height:950},reducedMotion:'reduce'});
 await context.addInitScript(()=>localStorage.setItem('gongxu_token','controlled-browser-fixture'));
 const page=await context.newPage();page.setDefaultTimeout(6000);
 const state={detailCounts:{},delay:()=>0,makeDetail:id=>detail(id),saveDelay:0,writes:[],failSave:false,errors:[],cases:[],documents:[],detailOverride:null};
 page.on('pageerror',()=>state.errors.push('page_error'));
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.origin!==origin.origin) return route.abort();
  if(!url.pathname.startsWith('/api/')) return route.continue();
  const path=url.pathname.slice(4),method=route.request().method();
  let status=200,body={};
  if(path==='/health')body={status:'ok',service:'gongxu-api'};
  else if(path==='/ready')body={status:'ready'};
  else if(path==='/ai/status')body={configured:false};
  else if(path==='/projects')body={projects:[project(A),project(B)]};
  else if(/^\/projects\/[^/]+$/.test(path)){
   const id=path.split('/')[2];state.detailCounts[id]=(state.detailCounts[id]||0)+1;
   const count=state.detailCounts[id];body=state.detailOverride||state.makeDetail(id,count);await new Promise(resolve=>setTimeout(resolve,state.delay(id,count)));
  } else if(path.endsWith('/requirements')&&method==='POST'){
   state.writes.push({path,body:route.request().postDataJSON()});
   await new Promise(resolve=>setTimeout(resolve,state.saveDelay));
   if(state.failSave){status=503;body={error:'database_unavailable'};} else body={requirement:{...detail(path.split('/')[2]).requirements[0],id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',version:2,content:route.request().postDataJSON().content}};
  } else if(path.endsWith('/documents')) body={documents:state.documents};
  else if(/\/documents\/[^/]+$/.test(path)&&method==='PATCH'){
   state.writes.push({path,body:route.request().postDataJSON()});
   if(state.failSave){status=503;body={error:'database_unavailable'};}else{const doc=state.documents.find(row=>path.endsWith('/'+row.id));body={document:{...doc,content:route.request().postDataJSON().content}};}
  } else if(path.endsWith('/test-cases'))body={cases:state.cases};
  else if(path.endsWith('/agent/runs'))body={runs:[]};
  else if(path.endsWith('/tasks'))body={tasks:[]};
  else if(path.endsWith('/code-reviews'))body={reviews:[]};
  else {status=404;body={error:'not_found'};}
  await route.fulfill({status,json:body}).catch(()=>{});
 });
 try{await work(page,state);assert.equal(state.errors.length,0);report.checks.push({name,status:'passed'});console.log(`PASS ${name}`);}
 catch(error){report.checks.push({name,status:'failed',errorType:error.constructor.name});console.log(`FAIL ${name}`);process.exitCode=1;}
 finally{await context.close();}
}
async function routeTo(page,id){await page.evaluate(path=>{history.pushState({},'',path);dispatchEvent(new PopStateEvent('popstate'));},`/projects/${id}/requirements`);}
async function waitFor(check){for(let i=0;i<100;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,20));}throw Error('Fixture request not observed');}
try{
 await scenario('late_A_response_cannot_replace_B_or_change_save_target',async(page,state)=>{
  state.delay=id=>id===A?450:0;
  await page.goto(`${origin.origin}/projects/${A}/requirements`,{waitUntil:'domcontentloaded'});
  await waitFor(()=>state.detailCounts[A]);await routeTo(page,B);
  await page.locator('#requirement').waitFor();await page.waitForTimeout(600);
  assert.equal(await page.locator('#requirement').inputValue(),'项目 B 的需求正文');
  await page.locator('#requirement').fill('只属于 B 的编辑');await page.getByRole('button',{name:/保存需求草稿/}).click();
  await waitFor(()=>state.writes.length);assert.equal(state.writes[0].path,`/projects/${B}/requirements`);assert.equal(state.writes[0].body.content,'只属于 B 的编辑');
 });
 await scenario('requirement_cancel_and_save_failure_preserve_content_and_route',async(page,state)=>{
  await page.goto(`${origin.origin}/projects/${A}/requirements`);await page.locator('#requirement').fill('不能丢失的未保存需求');
  await page.getByRole('link',{name:'我的项目',exact:true}).first().click();
  const dialog=page.getByRole('dialog',{name:'保留未保存的编辑'});await dialog.waitFor();
  await dialog.getByRole('button',{name:'留在此页'}).click();assert.ok(page.url().endsWith('/requirements'));assert.equal(await page.locator('#requirement').inputValue(),'不能丢失的未保存需求');
  state.failSave=true;await page.getByRole('link',{name:'我的项目',exact:true}).first().click();await dialog.getByRole('button',{name:'保存并继续'}).click();
  await dialog.getByRole('alert').waitFor();assert.ok(page.url().endsWith('/requirements'));assert.equal(await page.locator('#requirement').inputValue(),'不能丢失的未保存需求');
  await dialog.getByRole('button',{name:'留在此页'}).click();
 });
 await scenario('document_switch_does_not_discard_edit_and_failed_save_does_not_navigate',async(page,state)=>{
  state.documents=[{id:RA,type:'readme',content:'README 合成正文',modelName:'fixture',createdAt:now,requirementVersionId:RA},{id:RB,type:'design',content:'设计合成正文',modelName:'fixture',createdAt:now,requirementVersionId:RA}];
  await page.goto(`${origin.origin}/projects/${A}/documents`);await page.locator('#doc-content').fill('文档尚未保存的编辑');
  await page.getByRole('button',{name:/软件设计文档/}).click();
  const dialog=page.getByRole('dialog',{name:'保留未保存的编辑'});await dialog.waitFor();
  await dialog.getByRole('button',{name:'留在此页'}).click();assert.equal(await page.locator('#doc-content').inputValue(),'文档尚未保存的编辑');
  state.failSave=true;await page.getByRole('button',{name:/软件设计文档/}).click();await dialog.getByRole('button',{name:'保存并继续'}).click();
  await dialog.getByRole('alert').waitFor();assert.equal(await page.locator('#doc-content').inputValue(),'文档尚未保存的编辑');
  await dialog.getByRole('button',{name:'放弃并继续'}).click();assert.equal(await page.locator('#doc-content').inputValue(),'设计合成正文');
 });
 await scenario('test_center_defaults_to_latest_confirmed_version_not_old_passes',async(page,state)=>{
  state.detailOverride={project:project(A),requirements:[{id:RA,version:2,status:'confirmed',content:'新版本',createdAt:now},{id:RB,version:1,status:'confirmed',content:'旧版本',createdAt:now}]};
  const common={category:'normal',preconditions:'合成前提',steps:'人工步骤',expected:'预期',executionNote:'人工合成记录',executedAt:now};
  state.cases=[{...common,id:'new-case',title:'当前版本未执行',result:'not_run',requirementVersionId:RA},{...common,id:'old-case',title:'旧版本通过不得计入',result:'passed',requirementVersionId:RB}];
  await page.goto(`${origin.origin}/projects/${A}/tests`);await page.getByText('当前版本未执行',{exact:true}).waitFor();
  assert.equal(await page.getByText('旧版本通过不得计入',{exact:true}).count(),0);
  await page.getByLabel('测试来源需求版本').selectOption(RB);await page.getByText('旧版本通过不得计入',{exact:true}).waitFor();assert.equal(await page.getByText('当前版本未执行',{exact:true}).count(),0);
 });
 await scenario('A_B_A_uses_request_generation_not_only_matching_project_id',async(page,state)=>{
  state.delay=(id,count)=>id===A&&count===1?500:0;
  state.makeDetail=(id,count)=>detail(id,`${id===A?'A':'B'} 第 ${count} 次新鲜响应`);
  await page.goto(`${origin.origin}/projects/${A}/requirements`,{waitUntil:'domcontentloaded'});await waitFor(()=>state.detailCounts[A]);
  await routeTo(page,B);await page.locator('#requirement').waitFor();await routeTo(page,A);await waitFor(()=>state.detailCounts[A]===2);await page.waitForTimeout(650);
  assert.equal(await page.locator('#requirement').inputValue(),'A 第 2 次新鲜响应');
 });
 await scenario('back_cancel_and_forward_preserve_history_cursor_and_unsaved_content',async(page)=>{
  await page.goto(`${origin.origin}/projects/${A}/requirements`);await page.locator('#requirement').waitFor();await routeTo(page,B);await page.locator('#requirement').fill('返回操作也必须保护这段文字');
  const length=await page.evaluate(()=>history.length);await page.evaluate(()=>history.back());
  const dialog=page.getByRole('dialog',{name:'保留未保存的编辑'});await dialog.waitFor();await dialog.getByRole('button',{name:'留在此页'}).click();
  assert.ok(page.url().includes(B));assert.equal(await page.locator('#requirement').inputValue(),'返回操作也必须保护这段文字');assert.equal(await page.evaluate(()=>history.length),length);
  await page.evaluate(()=>history.back());await dialog.waitFor();await dialog.getByRole('button',{name:'放弃并继续'}).click();await page.waitForURL(`**/${A}/requirements`);await page.locator('#requirement').waitFor();
  await page.evaluate(()=>history.forward());await page.waitForURL(`**/${B}/requirements`);await page.locator('#requirement').waitFor();assert.equal(await page.locator('#requirement').inputValue(),'项目 B 的需求正文');
 });
 await scenario('switching_during_save_cannot_restore_the_old_editor',async(page,state)=>{
  state.saveDelay=500;await page.goto(`${origin.origin}/projects/${A}/requirements`);await page.locator('#requirement').fill('保存给 A 的合成内容');
  await page.getByRole('button',{name:/保存需求草稿/}).click();await waitFor(()=>state.writes.length===1);await routeTo(page,B);
  await page.getByRole('dialog',{name:'保留未保存的编辑'}).getByRole('button',{name:'放弃并继续'}).click();await page.locator('#requirement').waitFor();await page.waitForTimeout(600);
  assert.ok(page.url().includes(B));assert.equal(await page.locator('#requirement').inputValue(),'项目 B 的需求正文');assert.equal(state.writes.length,1);assert.ok(state.writes[0].path.includes(A));
 });
}finally{await browser.close();report.finishedAt=new Date().toISOString();await writeFile(new URL('report.json',directory),JSON.stringify(report,null,2));}
