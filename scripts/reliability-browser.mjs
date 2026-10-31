import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';

// Optional read-only reproduction of a known local historical Knowledge module.
// Only this browser sees it; no checkout, source overwrite, DB or external calls.
const knowledgeBaseline=process.argv.find(arg=>arg.startsWith('--knowledge-baseline='))?.split('=')[1];
let baselineModule;
if(knowledgeBaseline){
 if(!/^[a-f0-9]{7,40}$/.test(knowledgeBaseline)||!process.argv.some(arg=>arg.startsWith('--case=knowledge_')))throw Error('Historical reproduction requires a commit hash and Knowledge-only case filter');
 const ts=createRequire(new URL('../apps/web/package.json',import.meta.url))('typescript');
 const source=execFileSync('git',['show',`${knowledgeBaseline}:apps/web/src/Modules.tsx`],{cwd:new URL('../',import.meta.url),encoding:'utf8'});
 baselineModule=ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace(/import \{([^}]+)\} from ["'](react(?:\/jsx-runtime)?)["'];/g,(_match,bindings,module)=>{
  const key=module==='react'?'baselineReact':'baselineJsx',file=module==='react'?'react':'react_jsx-runtime';
  return `import ${key} from "/node_modules/.vite/deps/${file}.js";const {${bindings.replace(/\bas\b/g,':')}}=${key};`;
 });
}

// Controlled UI regression only: all API traffic is intercepted; no model or DB calls.
const origin = new URL(process.env.SMOKE_WEB_URL || 'http://127.0.0.1:5173');
if (!['127.0.0.1','localhost','[::1]'].includes(origin.hostname) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw Error('Loopback origin required');
const directory = new URL(`../.runtime/reliability-ui-${randomUUID()}/`,import.meta.url);
await mkdir(directory,{recursive:true});
const report={scope:'controlled_browser_responses',historicalKnowledgeModule:knowledgeBaseline??null,realDatabase:false,realModel:false,checks:[],startedAt:new Date().toISOString()};
const browser=await chromium.launch({headless:true,channel:process.env.SMOKE_BROWSER_CHANNEL || (process.platform==='win32'?'msedge':undefined)});
const A='11111111-1111-4111-8111-111111111111', B='22222222-2222-4222-8222-222222222222';
const RA='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', RB='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const now='2026-10-31T12:00:00Z';
const project=id=>({id,name:id===A?'受控项目 A':'受控项目 B',description:'合成测试，不是真实业务数据',status:'active',createdAt:now,updatedAt:now});
const detail=(id,content)=>({project:project(id),requirements:[{id:id===A?RA:RB,projectId:id,version:1,status:'draft',content:content||`项目 ${id===A?'A':'B'} 的需求正文`,createdAt:now}]});
async function scenario(name,work){
 const filter=process.argv.find(arg=>arg.startsWith('--case='))?.slice(7);if(filter&&!name.includes(filter))return;
 const context=await browser.newContext({viewport:{width:1440,height:950},reducedMotion:'reduce'});
 await context.addInitScript(()=>localStorage.setItem('gongxu_token','controlled-browser-fixture'));
 const page=await context.newPage();page.setDefaultTimeout(6000);
 const state={detailCounts:{},delay:()=>0,makeDetail:id=>detail(id),saveDelay:0,docSaveDelay:0,docReadDelay:()=>0,docReads:0,docResponse:null,docConflict:false,docHistory:[],evidence:null,writes:[],failSave:false,errors:[],tasks:[],cases:[],documents:[],detailOverride:null,detailStatus:200,runs:[],runCounts:{},runDelay:()=>0,searchDelay:0,searches:0};
 page.on('pageerror',()=>state.errors.push('page_error'));
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.origin!==origin.origin) return route.abort();
  if(baselineModule&&url.pathname==='/src/Modules.tsx')return route.fulfill({contentType:'application/javascript',body:baselineModule});
  if(!url.pathname.startsWith('/api/')) return route.continue();
  const path=url.pathname.slice(4),method=route.request().method();
  let status=200,body={};
  if(path==='/health')body={status:'ok',service:'gongxu-api'};
  else if(path==='/ready')body={status:'ready'};
  else if(path==='/ai/status')body={configured:false};
  else if(path==='/projects')body={projects:[project(A),project(B)]};
  else if(/^\/projects\/[^/]+$/.test(path)){
   const id=path.split('/')[2];state.detailCounts[id]=(state.detailCounts[id]||0)+1;
   const count=state.detailCounts[id];body=state.detailOverride||state.makeDetail(id,count);await new Promise(resolve=>setTimeout(resolve,state.delay(id,count)));if(state.detailStatus!==200){status=state.detailStatus;body={error:state.detailStatus===401?'unauthorized':'database_unavailable'};}
  } else if(path.endsWith('/requirements')&&method==='POST'){
   state.writes.push({path,body:route.request().postDataJSON()});
   await new Promise(resolve=>setTimeout(resolve,state.saveDelay));
   if(state.failSave){status=503;body={error:'database_unavailable'};} else body={requirement:{...detail(path.split('/')[2]).requirements[0],id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',version:2,content:route.request().postDataJSON().content}};
  } else if(path.endsWith('/documents')) {state.docReads++;body={documents:(state.docResponse?state.docResponse(state.docReads):state.documents).map(row=>({revision:1,...row})),evidence:state.evidence};await new Promise(resolve=>setTimeout(resolve,state.docReadDelay(state.docReads)));}
  else if(/\/documents\/[^/]+$/.test(path)&&method==='PATCH'){
   state.writes.push({path,body:route.request().postDataJSON()});
   await new Promise(resolve=>setTimeout(resolve,state.docSaveDelay));
   if(state.failSave){status=503;body={error:'database_unavailable'};}else if(state.docConflict){status=409;body={error:'document_conflict',currentRevision:2};}else{const doc=state.documents.find(row=>path.endsWith('/'+row.id));body={document:{...doc,revision:(doc.revision||1)+1,content:route.request().postDataJSON().content}};state.documents=state.documents.map(row=>row.id===doc.id?body.document:row);}
  } else if(/\/documents\/[^/]+\/history$/.test(path))body={history:state.docHistory,nextCursor:null};
  else if(/\/documents\/[^/]+$/.test(path)&&method==='GET')body={document:state.documents.find(row=>path.endsWith('/'+row.id))};
  else if(path.endsWith('/test-cases'))body={cases:state.cases};
  else if(/\/test-cases\/[^/]+\/execution$/.test(path)&&method==='PATCH'){
   const input=route.request().postDataJSON(),id=path.split('/').at(-2);state.writes.push({path,body:input});state.cases=state.cases.map(row=>row.id===id?{...row,result:input.result,executionNote:input.note,executedAt:now}:row);body={case:state.cases.find(row=>row.id===id)};
  }
  else if(/\/test-cases\/[^/]+$/.test(path)&&method==='PATCH'){
   const input=route.request().postDataJSON(),id=path.split('/').at(-1);state.writes.push({path,body:input});await new Promise(resolve=>setTimeout(resolve,state.caseSaveDelay??0));state.cases=state.cases.map(row=>row.id===id?{...row,...input,revision:(row.revision??1)+1,result:'not_run',executionNote:''}:row);body={case:state.cases.find(row=>row.id===id)};
  }
  else if(/\/agent\/runs\/[^/]+\/cancel$/.test(path)&&method==='POST'){
   state.writes.push({path});state.runs=state.runs.map(run=>path.endsWith('/'+run.id+'/cancel')?{...run,status:'failed',errorCode:'agent_cancelled'}:run);body={status:'cancelled'};
  }
  else if(path.endsWith('/agent/runs'))body={runs:state.runs};
  else if(/\/agent\/runs\/[^/]+$/.test(path)){const id=path.split('/').at(-1);state.runCounts[id]=(state.runCounts[id]||0)+1;await new Promise(r=>setTimeout(r,state.runDelay(id)));body={run:state.runs.find(r=>r.id===id),steps:[{id:'s',stage:'plan_1',status:'succeeded',outputSummary:id===RA?'运行A输出':'运行B输出',tools:[]}]};}
  else if(path.endsWith('/trace')){state.traceReads=(state.traceReads??0)+1;status=state.traceStatus??200;body=structuredClone(status===200?(state.traceData??{version:null,items:[],links:[],tasks:[],cases:[],previousItems:[],impact:null}):{error:'trace_refresh_required'});await new Promise(r=>setTimeout(r,state.traceDelay??0));}
  else if(/\/trace\/(links|task-tests)$/.test(path)&&method==='POST'){const input=route.request().postDataJSON();state.writes.push({path,body:input});if(path.endsWith('/links')&&state.traceData){state.traceData.links=state.traceData.links.map(link=>(input.targetKind==='case'?link.caseId:link.taskId)===input.targetId?{...link,status:input.decision,reviewNote:input.note}:link);}body={status:'confirmed'};}
  else if(path==='/knowledge'){state.knowledgeReads=(state.knowledgeReads??0)+1;status=state.knowledgeStatus??200;body=status===200?{documents:state.knowledgeDocuments??[],embeddingConfigured:true,pdfAvailable:true}:{error:'database_unavailable'};}
  else if(path==='/knowledge/text'||path==='/knowledge/pdf'){state.writes.push({path,body:route.request().postDataJSON()});await new Promise(r=>setTimeout(r,state.uploadDelay??0));status=state.failUpload?503:201;body=state.failUpload?{error:'database_unavailable'}:{id:RA,status:'awaiting_embedding',chunks:1};if(state.failKnowledgeAfterUpload)state.knowledgeStatus=503;}
  else if(path==='/knowledge/activity')body={activities:[]};
  else if(path==='/knowledge/search'){state.searches++;await new Promise(r=>setTimeout(r,state.searchDelay));body={hits:[{id:RA,document_name:'取消后重试资料',content:'成功检索的合成片段',page:1,distance:0.1}]};}
  else if(path.endsWith('/tasks'))body={tasks:state.tasks};
  else if(path.endsWith('/code-reviews'))body={reviews:[]};
  else {status=404;body={error:'not_found'};}
  await route.fulfill({status,json:body}).catch(()=>{});
 });
 try{await work(page,state);assert.equal(state.errors.length,0);report.checks.push({name,status:'passed'});console.log(`PASS ${name}`);}
 catch(error){report.checks.push({name,status:'failed',errorType:error.constructor.name});console.log(`FAIL ${name}`);if(name.startsWith('workspace_motion'))console.log(await page.evaluate(()=>({hidden:document.hidden,reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,label:document.querySelector('.workspace-motion-toggle')?.textContent,motion:document.querySelector('.workspace-visual')?.getAttribute('data-motion')})));console.log((error.stack??'').split('\n').filter(line=>line.includes('reliability-browser.mjs')).slice(0,2).join('\n'));await page.screenshot({path:new URL(`${name}.png`,directory).pathname.replace(/^\/([A-Za-z]:)/,'$1')}).catch(()=>{});process.exitCode=1;}
 finally{await context.close();}
}
async function routeTo(page,id){await page.evaluate(path=>{history.pushState({},'',path);dispatchEvent(new PopStateEvent('popstate'));},`/projects/${id}/requirements`);}
async function waitFor(check){for(let i=0;i<100;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,20));}throw Error('Fixture request not observed');}
function traceFixture(state){
 const test={id:RB,title:'合成配对用例',requirementVersionId:RA,category:'normal',revision:1,preconditions:'',steps:'核对登记',expected:'审批留存',result:'not_run',executionNote:'',executedAt:null};
 state.detailOverride={project:project(A),requirements:[{id:RA,version:1,status:'confirmed',content:'审批留档',createdAt:now}]};state.cases=[test];
 state.traceData={version:{id:RA,number:1,current:true},items:[{id:RA,key:'REQ-fixture',position:1,start:0,end:4,text:'审批留档',change:'initial',coverage:{suggested:0,confirmedTasks:1,confirmedCases:1,stale:0,manualEvidence:0}}],links:[{id:'task-link',itemId:RA,taskId:RA,caseId:null,status:'confirmed',origin:'human'},{id:'case-link',itemId:RA,taskId:null,caseId:RB,caseRevision:1,status:'confirmed',origin:'human'}],tasks:[{id:RA,title:'合成审批任务'}],cases:[test],previousItems:[],impact:null,taskTests:[],taskTestHistory:[],scope:'受控浏览器替身，不是业务数据'};
}
try{
 await scenario('knowledge_upload_leave_guard_save_failure_and_success',async(page,state)=>{
  await page.goto(`${origin.origin}/knowledge`);await page.locator('#knowledge-name').fill('待保存合成资料');await page.locator('#knowledge-content').fill('尚未上传的知识正文');
  await page.getByRole('link',{name:'我的项目',exact:true}).first().click();const guard=page.getByRole('dialog',{name:'保留未保存的编辑'});await guard.waitFor();await page.keyboard.press('Escape');assert.equal(await page.locator('#knowledge-content').inputValue(),'尚未上传的知识正文');
  state.failUpload=true;await page.getByRole('link',{name:'我的项目',exact:true}).first().click();await guard.getByRole('button',{name:'保存并继续'}).click();await guard.getByText(/保存未成功/).waitFor();assert.ok(page.url().endsWith('/knowledge'));assert.equal(await page.locator('#knowledge-name').inputValue(),'待保存合成资料');assert.equal(state.writes.length,1);
  state.failUpload=false;await guard.getByRole('button',{name:'保存并继续'}).click();await page.waitForURL('**/projects');assert.equal(state.writes.length,2);assert.ok(state.writes.every(row=>row.path==='/knowledge/text'));
 });
 await scenario('knowledge_upload_single_flight_preserves_new_typing',async(page,state)=>{
  state.uploadDelay=650;await page.goto(`${origin.origin}/knowledge`);await page.locator('#knowledge-name').fill('本次提交');await page.locator('#knowledge-content').fill('先前提交正文');
  await page.locator('#knowledge-name').evaluate(input=>{const form=input.form;form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});await waitFor(()=>state.writes.length>0);
  await page.locator('#knowledge-name').fill('下一份尚未保存');await page.locator('#knowledge-content').fill('保存期间仍在编辑的新正文');await page.waitForTimeout(900);
  assert.equal(state.writes.length,1);assert.equal(state.writes[0].body.text,'先前提交正文');assert.equal(await page.locator('#knowledge-name').inputValue(),'下一份尚未保存');assert.equal(await page.locator('#knowledge-content').inputValue(),'保存期间仍在编辑的新正文');
  await page.getByRole('link',{name:'我的项目',exact:true}).first().click();await page.getByRole('dialog',{name:'保留未保存的编辑'}).getByRole('button',{name:'留在此页'}).click();assert.equal(await page.locator('#knowledge-content').inputValue(),'保存期间仍在编辑的新正文');
 });
 await scenario('knowledge_invalid_file_keeps_draft_and_replacement_is_guarded',async(page,state)=>{
  await page.goto(`${origin.origin}/knowledge`);await page.locator('#knowledge-name').fill('保留原名');await page.locator('#knowledge-content').fill('保留原稿');
  await page.locator('#knowledge-file').setInputFiles({name:'invalid.exe',mimeType:'application/octet-stream',buffer:Buffer.from('synthetic')});await page.getByRole('alert').filter({hasText:'请选择 PDF、TXT 或 Markdown 文件。'}).waitFor();assert.equal(await page.locator('#knowledge-content').inputValue(),'保留原稿');
  await page.locator('#knowledge-file').setInputFiles({name:'oversized.pdf',mimeType:'application/pdf',buffer:Buffer.alloc(3_000_001)});await page.getByText(/PDF 文件不能超过 3 MB/).waitFor();assert.equal(await page.locator('#knowledge-name').inputValue(),'保留原名');
  const replacement={name:'replacement.txt',mimeType:'text/plain',buffer:Buffer.from('显式选择替换后的合成正文')};await page.locator('#knowledge-file').setInputFiles(replacement);const guard=page.getByRole('dialog',{name:'保留未保存的编辑'});await guard.waitFor();await page.keyboard.press('Escape');assert.equal(await page.locator('#knowledge-content').inputValue(),'保留原稿');
  await page.locator('#knowledge-file').setInputFiles(replacement);await guard.getByRole('button',{name:'放弃并继续'}).click();await page.waitForFunction(()=>document.querySelector('#knowledge-content')?.value==='显式选择替换后的合成正文');assert.equal(await page.locator('#knowledge-name').inputValue(),'replacement.txt');assert.equal(state.writes.length,0);
 });
 await scenario('knowledge_file_read_order_and_new_typing_are_protected',async(page,state)=>{
  await page.addInitScript(()=>{const original=File.prototype.text;File.prototype.text=async function(){await new Promise(r=>setTimeout(r,this.name.startsWith('slow')?650:40));return original.call(this);};});
  await page.goto(`${origin.origin}/knowledge`);await page.locator('#knowledge-file').setInputFiles({name:'slow-a.txt',mimeType:'text/plain',buffer:Buffer.from('迟到的A')});await page.locator('#knowledge-file').setInputFiles({name:'fast-b.txt',mimeType:'text/plain',buffer:Buffer.from('应保留的B')});await page.waitForTimeout(850);assert.equal(await page.locator('#knowledge-content').inputValue(),'应保留的B');assert.equal(await page.locator('#knowledge-name').inputValue(),'fast-b.txt');
  await page.locator('#knowledge-file').setInputFiles({name:'slow-c.txt',mimeType:'text/plain',buffer:Buffer.from('读取中的C')});await page.locator('#knowledge-content').fill('文件读取期间的新编辑');const guard=page.getByRole('dialog',{name:'保留未保存的编辑'});await guard.waitFor();await guard.getByRole('button',{name:'留在此页'}).click();assert.equal(await page.locator('#knowledge-content').inputValue(),'文件读取期间的新编辑');assert.equal(state.writes.length,0);
 });
 await scenario('knowledge_saved_document_is_not_resubmitted_when_list_refresh_fails',async(page,state)=>{
  state.failKnowledgeAfterUpload=true;await page.goto(`${origin.origin}/knowledge`);await page.locator('#knowledge-name').fill('已持久化的资料');await page.locator('#knowledge-content').fill('列表刷新失败不等于提交失败');await page.getByRole('button',{name:/保存并分块/}).click();await page.getByText(/数据服务暂不可用/).waitFor();assert.equal(state.writes.length,1);assert.equal(await page.locator('#knowledge-content').inputValue(),'');assert.ok((await page.locator('.alert.success').innerText()).includes('文档已保存'));
  state.knowledgeStatus=200;await page.getByRole('button',{name:'重新检查',exact:true}).click();await page.waitForTimeout(120);assert.equal(state.writes.length,1);assert.equal(await page.getByRole('button',{name:/保存并分块/}).isDisabled(),true);
 });
 await scenario('trace_confirming_source_preserves_pair_draft_and_unlocks_pairing',async(page,state)=>{
  traceFixture(state);state.traceData.links[1].status='suggested';await page.goto(`${origin.origin}/projects/${A}/tests`);
  const trace=page.getByRole('region',{name:'需求到验证证据追踪'});
  await trace.getByLabel('验证链开发任务').selectOption(RA);await trace.getByLabel('验证链测试用例').selectOption(RB);await trace.getByLabel('任务验证依据').fill('先写配对依据，审核来源后继续');
  assert.equal(await trace.getByRole('button',{name:'确认任务与用例配对'}).isDisabled(),true);
  await trace.getByLabel('关联类型',{exact:true}).selectOption('case');await trace.getByLabel('当前版本对象',{exact:true}).selectOption(RB);await trace.getByLabel('审核依据',{exact:true}).fill('人工核对用例检查审批记录');
  const before=state.traceReads;await trace.getByRole('button',{name:'确认关联',exact:true}).click();await waitFor(()=>state.writes.length===1);await waitFor(()=>state.traceReads>before);
  await page.waitForTimeout(120);assert.equal(await trace.getByLabel('任务验证依据').inputValue(),'先写配对依据，审核来源后继续');
  assert.equal(await trace.getByLabel('验证链开发任务').inputValue(),RA);assert.equal(await trace.getByLabel('验证链测试用例').inputValue(),RB);
  await trace.getByRole('button',{name:'确认任务与用例配对'}).click();await waitFor(()=>state.writes.length===2);assert.ok(state.writes[1].path.endsWith('/task-tests'));
 });
 await scenario('trace_slow_source_refresh_keeps_new_input_and_version_change_blocks_writes',async(page,state)=>{
  traceFixture(state);await page.goto(`${origin.origin}/projects/${A}/tests`);const trace=page.getByRole('region',{name:'需求到验证证据追踪'});
  await trace.getByLabel('当前版本对象',{exact:true}).selectOption(RA);await trace.getByLabel('审核依据',{exact:true}).fill('上方关联准备保存');
  const before=state.traceReads;state.traceDelay=650;await trace.getByRole('button',{name:'确认关联',exact:true}).click();await waitFor(()=>state.traceReads>before);
  await trace.getByLabel('任务验证依据').fill('刷新未返回时新增的配对审核');await page.waitForTimeout(800);assert.equal(await trace.getByLabel('任务验证依据').inputValue(),'刷新未返回时新增的配对审核');
  await trace.getByLabel('当前版本对象',{exact:true}).selectOption(RA);await trace.getByLabel('审核依据',{exact:true}).fill('需求即将切换，不能误用旧审核');
  state.traceData.version={id:RB,number:2,current:true};await trace.getByRole('button',{name:'确认关联',exact:true}).click();await page.waitForTimeout(900);
  assert.equal(await trace.getByLabel('任务验证依据').inputValue(),'刷新未返回时新增的配对审核');assert.equal(await trace.getByRole('button',{name:'确认关联',exact:true}).isDisabled(),true);assert.ok((await trace.innerText()).includes('需求版本已变化'));
  await trace.getByRole('button',{name:'刷新追踪'}).click();const guard=page.getByRole('dialog',{name:'保留未保存的编辑'});await guard.getByRole('button',{name:'留在此页'}).click();assert.equal(await trace.getByLabel('任务验证依据').inputValue(),'刷新未返回时新增的配对审核');
  await trace.getByRole('button',{name:'刷新追踪'}).click();await guard.getByRole('button',{name:'放弃并继续'}).click();await trace.getByLabel('审核依据',{exact:true}).waitFor();assert.equal(await trace.getByLabel('任务验证依据').inputValue(),'');assert.equal(await trace.getByLabel('审核依据',{exact:true}).inputValue(),'');assert.ok((await trace.innerText()).includes('需求 v2'));
 });
 await scenario('trace_parallel_review_drafts_survive_either_form_save',async(page,state)=>{
  traceFixture(state);await page.goto(`${origin.origin}/projects/${A}/tests`);
  const trace=page.getByRole('region',{name:'需求到验证证据追踪'});
  await trace.getByLabel('当前版本对象',{exact:true}).selectOption(RA);await trace.getByLabel('审核依据',{exact:true}).fill('上方关联审核准备保存');
  await trace.getByLabel('验证链开发任务').selectOption(RA);await trace.getByLabel('验证链测试用例').selectOption(RB);await trace.getByLabel('任务验证依据').fill('下方配对审核不能随上方刷新丢失');
  await trace.getByRole('button',{name:'确认关联',exact:true}).click();await waitFor(()=>state.writes.length===1);await page.waitForTimeout(200);
  assert.equal(await trace.getByLabel('任务验证依据').inputValue(),'下方配对审核不能随上方刷新丢失');
  await trace.getByLabel('审核依据',{exact:true}).fill('这次上方审核草稿不得被配对保存卸载');
  await trace.getByRole('button',{name:'确认任务与用例配对',exact:true}).click();await waitFor(()=>state.writes.length===2);await page.waitForTimeout(200);
  assert.equal(await trace.getByLabel('审核依据',{exact:true}).inputValue(),'这次上方审核草稿不得被配对保存卸载');assert.ok((await trace.innerText()).includes('来源记录已更新'));
 });
 await scenario('trace_read_failure_marks_old_snapshot_readonly_until_recovery',async(page,state)=>{
  traceFixture(state);await page.goto(`${origin.origin}/projects/${A}/tests`);const trace=page.getByRole('region',{name:'需求到验证证据追踪'});await trace.getByLabel('审核依据',{exact:true}).waitFor();
  state.traceStatus=409;await trace.getByRole('button',{name:'刷新追踪'}).click();await trace.getByText(/读取期间需求版本发生变化/).waitFor();
  assert.equal(await trace.getByRole('button',{name:'确认关联',exact:true}).isDisabled(),true);assert.equal(await trace.getByLabel('验证链开发任务').isDisabled(),true);assert.ok((await trace.innerText()).includes('上次读取快照'));
  state.traceStatus=200;await trace.getByRole('button',{name:'刷新追踪'}).click();await trace.getByLabel('审核依据',{exact:true}).waitFor();await page.waitForTimeout(80);
  assert.equal(await trace.getByRole('button',{name:'确认关联',exact:true}).isEnabled(),true);assert.equal(await trace.getByLabel('验证链开发任务').isEnabled(),true);
 });
 await scenario('test_definition_save_locks_inputs_until_response_and_retains_saved_text',async(page,state)=>{
  state.caseSaveDelay=650;state.detailOverride={project:project(A),requirements:[{id:RA,version:1,status:'confirmed',content:'合成需求',createdAt:now}]};state.cases=[{id:RB,title:'合成用例',requirementVersionId:RA,category:'normal',revision:1,preconditions:'',steps:'检查',expected:'保留',result:'not_run',executionNote:'',executedAt:null}];
  await page.goto(`${origin.origin}/projects/${A}/tests`);await page.getByRole('button',{name:'编辑用例 →',exact:true}).click();await page.locator(`#${RB}-title`).fill('保存中的定义');await page.getByRole('button',{name:'保存用例',exact:true}).click();await waitFor(()=>state.writes.length===1);
  assert.equal(await page.locator(`#${RB}-title`).isDisabled(),true);assert.equal(await page.locator('.case-item').getByRole('button',{name:'取消',exact:true}).isDisabled(),true);
  await page.getByText('保存中的定义',{exact:true}).waitFor();assert.equal(state.writes.length,1);assert.equal(state.writes[0].body.expectedRevision,1);
 });
 await scenario('saving_test_result_preserves_unfinished_task_test_review',async(page,state)=>{
  const test={id:RB,title:'合成配对用例',requirementVersionId:RA,category:'normal',revision:1,preconditions:'',steps:'核对登记',expected:'审批留存',result:'not_run',executionNote:'',executedAt:null};
  state.detailOverride={project:project(A),requirements:[{id:RA,version:1,status:'confirmed',content:'审批留档',createdAt:now}]};state.cases=[test];
  state.traceData={version:{id:RA,number:1,current:true},items:[{id:RA,key:'REQ-fixture',position:1,start:0,end:4,text:'审批留档',change:'initial',coverage:{suggested:0,confirmedTasks:1,confirmedCases:1,stale:0,manualEvidence:0}}],links:[{id:'task-link',itemId:RA,taskId:RA,caseId:null,status:'confirmed',origin:'human'},{id:'case-link',itemId:RA,taskId:null,caseId:RB,caseRevision:1,status:'confirmed',origin:'human'}],tasks:[{id:RA,title:'合成审批任务'}],cases:[test],previousItems:[],impact:null,taskTests:[],taskTestHistory:[],scope:'受控浏览器替身，不是业务数据'};
  await page.goto(`${origin.origin}/projects/${A}/tests`);await page.getByLabel('验证链开发任务').selectOption(RA);await page.getByLabel('验证链测试用例').selectOption(RB);await page.getByLabel('任务验证依据').fill('未完成的配对审核不得丢失');
  await page.locator(`#${RB}-result`).selectOption('blocked');await page.locator(`#${RB}-note`).fill('合成登记：测试环境未就绪');await page.getByRole('button',{name:'保存执行结果',exact:true}).click();await waitFor(()=>state.writes.length===1);await page.waitForTimeout(250);
  assert.equal(await page.getByLabel('任务验证依据').inputValue(),'未完成的配对审核不得丢失');assert.ok((await page.getByRole('region',{name:'需求到验证证据追踪'}).innerText()).includes('来源记录已更新'));
 });
 await scenario('agent_selection_hides_previous_actions_while_new_run_loads',async(page,state)=>{
  state.runs=[{id:RA,requirementVersionId:RA,status:'awaiting_review',createdAt:now,plan:{tasks:[]},errorCode:null},{id:RB,requirementVersionId:RA,status:'confirmed',createdAt:now,plan:{tasks:[]},errorCode:null}];
  await page.goto(`${origin.origin}/projects/${A}/agent`);await page.getByText('运行A输出',{exact:true}).waitFor();
  state.runDelay=id=>id===RB?700:0;await page.locator('.run-link').nth(1).click();await waitFor(()=>state.runCounts[RB]);
  assert.equal(await page.getByText('运行A输出',{exact:true}).count(),0,'Old actions must be removed immediately when a different run is selected');
  assert.equal(await page.getByRole('button',{name:/确认计划并创建任务/}).count(),0);
  await page.getByText('运行B输出',{exact:true}).waitFor();await page.getByRole('button',{name:'刷新运行记录',exact:true}).click();
  await page.waitForTimeout(850);assert.equal(await page.getByText('运行B输出',{exact:true}).count(),1);assert.equal(await page.getByText('运行A输出',{exact:true}).count(),0);
 });
 await scenario('agent_review_note_cannot_be_discarded_or_implicitly_approved_by_navigation',async(page,state)=>{
  state.runs=[{id:RA,requirementVersionId:RA,status:'awaiting_review',createdAt:now,plan:{tasks:[]},errorCode:null},{id:RB,requirementVersionId:RA,status:'confirmed',createdAt:now,plan:{tasks:[]},errorCode:null}];
  await page.goto(`${origin.origin}/projects/${A}/agent`);await page.locator('#plan-review-note').fill('待核对的验收条件');
  await page.locator('.run-link').nth(1).click();const dialog=page.getByRole('dialog',{name:'保留未保存的编辑'});await dialog.waitFor();
  await dialog.getByRole('button',{name:'留在此页'}).click();assert.equal(await page.locator('#plan-review-note').inputValue(),'待核对的验收条件');
  await page.getByRole('link',{name:'我的项目',exact:true}).first().click();await dialog.getByRole('button',{name:'保存并继续'}).click();
  await dialog.getByText(/保存未成功/).waitFor();assert.ok(page.url().endsWith('/agent'));assert.equal(state.writes.length,0);
  await dialog.getByRole('button',{name:'留在此页'}).click();await page.locator('.run-link').nth(1).click();await dialog.getByRole('button',{name:'放弃并继续'}).click();await page.getByText('运行B输出',{exact:true}).waitFor();
 });
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
 await scenario('document_late_save_cannot_reselect_previous_document',async(page,state)=>{
  state.docSaveDelay=1000;
  state.documents=[{id:RA,type:'readme',content:'文档 A 正文',modelName:'fixture',createdAt:now,requirementVersionId:RA},{id:RB,type:'design',content:'文档 B 正文',modelName:'fixture',createdAt:now,requirementVersionId:RA}];
  await page.goto(`${origin.origin}/projects/${A}/documents`);await page.locator('#doc-content').fill('只保存给文档 A');
  await page.getByRole('button',{name:/保存文档/}).click();await waitFor(()=>state.writes.length===1);
  await page.getByRole('button',{name:/软件设计文档/}).click();await page.getByRole('dialog').getByRole('button',{name:'放弃并继续'}).click();
  await page.waitForTimeout(1100);
  assert.equal(await page.getByRole('button',{name:/软件设计文档/}).getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('#doc-content').inputValue(),'文档 B 正文');
  await page.locator('#doc-content').fill('只保存给文档 B');await page.getByRole('button',{name:/保存文档/}).click();await waitFor(()=>state.writes.length===2);
  assert.ok(state.writes[1].path.endsWith('/'+RB));assert.equal(state.writes[1].body.expectedRevision,1);
 });
 await scenario('document_new_typing_during_save_blocks_save_and_leave',async(page,state)=>{
  state.docSaveDelay=1000;state.documents=[{id:RA,type:'readme',content:'文档原文',modelName:'fixture',createdAt:now,requirementVersionId:RA}];
  await page.goto(`${origin.origin}/projects/${A}/documents`);await page.locator('#doc-content').fill('正在保存的旧输入');
  await page.getByRole('button',{name:/保存文档/}).click();await waitFor(()=>state.writes.length===1);await page.locator('#doc-content').fill('保存期间新增的输入必须留下');
  await page.getByRole('link',{name:'我的项目',exact:true}).first().click();const dialog=page.getByRole('dialog',{name:'保留未保存的编辑'});
  await dialog.getByRole('button',{name:'保存并继续'}).click();await page.waitForTimeout(1100);
  assert.ok(page.url().endsWith('/documents'));assert.equal(await page.locator('#doc-content').inputValue(),'保存期间新增的输入必须留下');
  assert.equal(await dialog.isVisible(),true);assert.equal(state.writes.length,1);
 });
 await scenario('document_refresh_is_ordered_and_loading_prevents_editing',async(page,state)=>{
  state.documents=[{id:RA,type:'readme',content:'初始文档',modelName:'fixture',createdAt:now,requirementVersionId:RA}];
  await page.goto(`${origin.origin}/projects/${A}/documents`);await page.locator('#doc-content').waitFor();
  const initialReads=state.docReads; // StrictMode may send an aborted mount read first.
  state.docResponse=count=>state.documents.map(doc=>({...doc,content:count===initialReads+1?'过期读取':'最新读取'}));
  state.docReadDelay=count=>count===initialReads+1?650:150;
  await page.getByRole('button',{name:'刷新文档',exact:true}).click();await waitFor(()=>state.docReads===initialReads+1);assert.equal(await page.locator('#doc-content').isDisabled(),true);
  await page.getByRole('button',{name:'刷新文档',exact:true}).click();await waitFor(()=>state.docReads===initialReads+2);await page.waitForTimeout(750);
  assert.equal(await page.locator('#doc-content').inputValue(),'最新读取');assert.equal(await page.locator('#doc-content').isDisabled(),false);
 });
 await scenario('document_conflict_preserves_draft_and_explicit_merge_uses_latest_revision',async(page,state)=>{
  state.documents=[{id:RA,type:'readme',content:'初始文档',revision:1,modelName:'fixture',createdAt:now,requirementVersionId:RA}];
  await page.goto(`${origin.origin}/projects/${A}/documents`);await page.locator('#doc-content').fill('本地必须保留的修改');
  state.docConflict=true;state.documents[0]={...state.documents[0],revision:2,content:'另一个标签的修改'};
  await page.getByRole('button',{name:/保存文档/}).click();await page.getByRole('group',{name:'文档保存冲突'}).waitFor();
  assert.equal(await page.locator('#doc-content').inputValue(),'本地必须保留的修改');await page.getByRole('button',{name:'查看服务器版本'}).click();
  await page.getByRole('region',{name:'服务器修订 2'}).waitFor();await page.getByRole('button',{name:'保留我的内容继续合并'}).click();
  assert.equal(await page.locator('#doc-content').inputValue(),'本地必须保留的修改');state.docConflict=false;
  await page.locator('#doc-content').fill('人工合并两处修改后的内容');await page.getByRole('button',{name:/保存文档/}).click();await waitFor(()=>state.writes.length===2);
  assert.equal(state.writes[1].body.expectedRevision,2);await page.getByText('已保存修订 3。',{exact:true}).waitFor();
 });
 await scenario('document_history_restore_is_guarded_and_successful_save_allows_navigation',async(page,state)=>{
  state.documents=[{id:RA,type:'readme',content:'当前正文',revision:2,modelName:'fixture',createdAt:now,requirementVersionId:RA}];state.docHistory=[{revision:1,content:'历史正文',savedAt:now,recordedAt:now}];
  await page.goto(`${origin.origin}/projects/${A}/documents`);await page.locator('#doc-content').fill('尚未保存的修改');
  await page.getByRole('button',{name:/修订记录 展开/}).click();await page.locator('.document-history summary').click();await page.getByRole('button',{name:'使用修订 1 编辑'}).click();
  await page.getByRole('dialog').getByRole('button',{name:'留在此页'}).click();assert.equal(await page.locator('#doc-content').inputValue(),'尚未保存的修改');
  await page.getByRole('button',{name:'使用修订 1 编辑'}).click();await page.getByRole('dialog').getByRole('button',{name:'放弃并继续'}).click();assert.equal(await page.locator('#doc-content').inputValue(),'历史正文');
  await page.getByRole('link',{name:'我的项目',exact:true}).first().click();await page.getByRole('dialog').getByRole('button',{name:'保存并继续'}).click();await page.waitForURL('**/projects');
  assert.equal(state.writes.length,1);assert.equal(state.writes[0].body.content,'历史正文');assert.equal(state.writes[0].body.expectedRevision,2);
 });
 await scenario('agent_cancel_keeps_stopped_record_and_never_automatically_restarts',async(page,state)=>{
  state.detailOverride={project:project(A),requirements:[{id:RA,version:1,status:'confirmed',content:'合成需求',createdAt:now}]};
  state.runs=[{id:RA,requirementVersionId:RA,status:'running',createdAt:now,heartbeatAt:now,plan:null,errorCode:null}];
  await page.goto(`${origin.origin}/projects/${A}/agent`);await page.getByRole('button',{name:'取消本次运行',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:/开始规划/}).isDisabled(),true);
  await page.getByRole('button',{name:'取消本次运行',exact:true}).click();await page.getByRole('button',{name:/重新规划当前需求/}).waitFor();
  assert.equal(await page.getByRole('button',{name:/重新规划当前需求/}).isEnabled(),true);assert.ok((await page.locator('.agent-recovery-note').innerText()).includes('由用户取消'));
  assert.equal(state.writes.length,1);assert.equal(state.writes[0].path,`/projects/${A}/agent/runs/${RA}/cancel`);assert.equal(state.runs[0].status,'failed');
 });
 await scenario('agent_task_board_defaults_to_current_version_and_history_is_read_only',async(page,state)=>{
  state.detailOverride={project:project(A),requirements:[{id:RA,version:2,status:'confirmed',content:'当前需求',createdAt:now},{id:RB,version:1,status:'confirmed',content:'历史需求',createdAt:now}]};
  const common={stage:'开发',description:'合成任务说明',deliverable:'合成交付物',dependsOn:[]};
  state.tasks=[{...common,id:'old-task',title:'历史已完成任务',status:'done',requirementVersionId:RB},{...common,id:'current-task',title:'当前待开始任务',status:'todo',requirementVersionId:RA}];
  await page.goto(`${origin.origin}/projects/${A}/agent`);await page.getByText('当前待开始任务',{exact:true}).waitFor();assert.equal(await page.getByText('历史已完成任务',{exact:true}).count(),0);
  assert.equal(await page.getByLabel('当前待开始任务状态').isEnabled(),true);
  await page.getByLabel('任务来源需求版本').selectOption(RB);await page.getByText('历史已完成任务',{exact:true}).waitFor();assert.equal(await page.getByLabel('历史已完成任务状态').isDisabled(),true);assert.equal(await page.getByText('当前待开始任务',{exact:true}).count(),0);
 });
 await scenario('delivery_rechecks_changed_evidence_without_discarding_manual_notes',async(page,state)=>{
  state.detailOverride={project:project(A),requirements:[{id:RA,version:1,status:'confirmed',content:'合成需求',createdAt:now}]};
  state.evidence={requirementVersionId:RA,requirementVersion:1,taskRevision:0,caseRevision:1,traceRevision:0,documentRevision:0,capturedAt:now};
  await page.goto(`${origin.origin}/delivery`);await page.locator('#delivery-tests-status').waitFor();await waitFor(()=>state.docReads>0);
  await page.locator('#delivery-tests-note').fill('此前人工核对的备注必须保留');await page.locator('#delivery-tests-status').selectOption('checked');
  assert.equal(await page.locator('.delivery-count strong').innerText(),'1');
  state.evidence={...state.evidence,caseRevision:2};await page.getByRole('button',{name:'刷新成果记录'}).click();
  await page.getByRole('button',{name:'已核对当前资料',exact:true}).waitFor();assert.equal(await page.locator('.delivery-count strong').innerText(),'0');
  assert.equal(await page.locator('#delivery-tests-note').inputValue(),'此前人工核对的备注必须保留');assert.equal(await page.locator('#delivery-tests-status').inputValue(),'checked');
  await page.getByRole('button',{name:'已核对当前资料',exact:true}).click();assert.equal(await page.locator('.delivery-count strong').innerText(),'1');
  await page.reload();await page.locator('#delivery-tests-status').waitFor();await page.waitForFunction(()=>document.querySelector('.delivery-count strong')?.textContent==='1');
  assert.equal(await page.locator('#delivery-tests-note').inputValue(),'此前人工核对的备注必须保留');
 });
 await scenario('delivery_storage_failure_blocks_navigation_until_saved_or_explicitly_discarded',async(page,state)=>{
  await page.goto(`${origin.origin}/delivery`);await page.locator('#delivery-tests-note').waitFor();
  await page.evaluate(()=>{const original=Storage.prototype.setItem;window.restoreDeliveryStorage=()=>{Storage.prototype.setItem=original;};Storage.prototype.setItem=function(key,value){if(key.includes('delivery'))throw new DOMException('Synthetic quota limit','QuotaExceededError');return original.call(this,key,value);};});
  await page.locator('#delivery-tests-note').fill('存储失败仍须保留的本机核对备注');await page.getByText(/本机保存失败/).waitFor();
  await page.locator('#delivery-project').selectOption(B);const dialog=page.getByRole('dialog',{name:'保留未保存的编辑'});await dialog.waitFor();
  await dialog.getByRole('button',{name:'保存并继续'}).click();await dialog.getByText(/保存未成功/).waitFor();assert.equal(await page.locator('#delivery-project').inputValue(),A);
  await dialog.getByRole('button',{name:'留在此页'}).click();assert.equal(await page.locator('#delivery-tests-note').inputValue(),'存储失败仍须保留的本机核对备注');
  await page.getByRole('link',{name:'我的项目',exact:true}).first().click();await dialog.waitFor();await page.evaluate(()=>window.restoreDeliveryStorage());await dialog.getByRole('button',{name:'保存并继续'}).click();await page.waitForURL('**/projects');
  await page.goto(`${origin.origin}/delivery`);assert.equal(await page.locator('#delivery-tests-note').inputValue(),'存储失败仍须保留的本机核对备注');
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
 await scenario('workspace_motion_is_opt_in_and_reduced_motion_disables_playback',async(page)=>{
  await page.emulateMedia({reducedMotion:'no-preference'});await page.goto(`${origin.origin}/dashboard`);const visual=page.locator('.workspace-visual--webgl');await visual.waitFor();assert.equal(await visual.getAttribute('data-motion'),'paused');
  await page.getByRole('button',{name:'开启动效',exact:true}).click();assert.equal(await visual.getAttribute('data-motion'),'running');
  await page.emulateMedia({reducedMotion:'reduce'});await page.getByRole('button',{name:'静态预览',exact:true}).waitFor();assert.ok(await page.getByRole('button',{name:'静态预览',exact:true}).isDisabled());assert.equal(await visual.getAttribute('data-motion'),'paused');
 });
 await scenario('restoring_history_requires_a_choice_and_cancel_does_not_claim_success',async(page)=>{
  await page.goto(`${origin.origin}/projects/${A}/requirements`);await page.locator('#requirement').fill('恢复历史时不能静默覆盖的草稿');await page.getByRole('button',{name:'查看需求版本 1',exact:true}).click();
  await page.getByRole('button',{name:'使用此版本编辑',exact:true}).click();await page.getByRole('button',{name:'替换编辑区内容',exact:true}).click();
  const guard=page.getByRole('dialog',{name:'保留未保存的编辑'});await guard.waitFor();await guard.getByRole('button',{name:'留在此页'}).click();assert.equal(await page.locator('#requirement').inputValue(),'恢复历史时不能静默覆盖的草稿');assert.equal(await page.locator('.history-notice').count(),0);
 });
 await scenario('failed_project_load_recovers_without_editing_the_wrong_project',async(page,state)=>{
  state.detailStatus=503;await page.goto(`${origin.origin}/projects/${B}/requirements`);await page.getByRole('alert').waitFor();assert.equal(await page.locator('#requirement').count(),0);
  state.detailStatus=200;await page.getByRole('button',{name:'重试',exact:true}).click();await page.locator('#requirement').waitFor();assert.equal(await page.locator('#requirement').inputValue(),'项目 B 的需求正文');
 });
 await scenario('old_unauthorized_response_cannot_clear_a_newer_session',async(page,state)=>{
  state.detailStatus=401;state.delay=()=>450;await page.goto(`${origin.origin}/projects/${A}/requirements`,{waitUntil:'domcontentloaded'});await waitFor(()=>state.detailCounts[A]);
  await page.evaluate(()=>localStorage.setItem('gongxu_token','newer-session-fixture'));await page.waitForTimeout(600);assert.equal(await page.evaluate(()=>localStorage.getItem('gongxu_token')),'newer-session-fixture');
 });
 await scenario('repeated_save_is_single_write_and_keyboard_cancel_restores_focus',async(page,state)=>{
  state.saveDelay=250;await page.goto(`${origin.origin}/projects/${A}/requirements`);await page.locator('#requirement').fill('重复点击只能保存一次');
  await page.getByRole('button',{name:/保存需求草稿/}).evaluate(button=>{button.click();button.click();});await waitFor(()=>state.writes.length);await page.waitForTimeout(350);assert.equal(state.writes.length,1);
  await page.locator('#requirement').fill('键盘保护草稿');const link=page.getByRole('link',{name:'我的项目',exact:true}).first();await link.focus();await page.keyboard.press('Enter');const dialog=page.getByRole('dialog',{name:'保留未保存的编辑'});await dialog.waitFor();
  for(let i=0;i<7;i++){await page.keyboard.press('Tab');assert.ok(await dialog.evaluate(el=>el.contains(document.activeElement)));}
  await page.keyboard.press('Escape');assert.equal(await dialog.isVisible(),false);assert.ok(await link.evaluate(el=>el===document.activeElement));assert.equal(await page.locator('#requirement').inputValue(),'键盘保护草稿');
 });
 await scenario('late_agent_run_detail_does_not_replace_the_new_selection',async(page,state)=>{
  state.runs=[RA,RB].map((id,i)=>({id,requirementVersionId:RA,status:'confirmed',plan:null,errorCode:null,createdAt:i?now:'2026-10-31T11:00:00Z'}));state.runDelay=id=>id===RA?400:0;
  await page.goto(`${origin.origin}/projects/${A}/agent`);await page.getByText('运行A输出',{exact:true}).waitFor();
  const runs=page.locator('.module-list .run-link');await runs.first().click();await waitFor(()=>state.runCounts[RA]>=2);await runs.nth(1).click();await page.waitForTimeout(600);
  assert.equal(await runs.nth(1).getAttribute('aria-pressed'),'true');assert.equal(await page.getByText('运行B输出',{exact:true}).count(),1);
 });
 await scenario('knowledge_cancel_ignores_late_result_and_allows_retry',async(page,state)=>{
  state.searchDelay=450;await page.goto(`${origin.origin}/knowledge`);await page.getByLabel('检索问题').fill('检索合成资料');await page.getByRole('button',{name:/检索知识/}).click();await waitFor(()=>state.searches===1);
  await page.getByRole('button',{name:'取消检索或索引',exact:true}).click();await page.waitForTimeout(550);assert.equal(await page.getByText('成功检索的合成片段',{exact:true}).count(),0);
  state.searchDelay=0;await page.getByRole('button',{name:/检索知识/}).click();await page.getByText('成功检索的合成片段',{exact:true}).waitFor();
 });
}finally{await browser.close();report.finishedAt=new Date().toISOString();await writeFile(new URL('report.json',directory),JSON.stringify(report,null,2));}
