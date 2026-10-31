import { chromium, firefox, webkit } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import {existsSync} from 'node:fs';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';

// Optional read-only reproduction of a known local historical Knowledge module.
// Only this browser sees it; no checkout, source overwrite, DB or external calls.
const knowledgeBaseline=process.argv.find(arg=>arg.startsWith('--knowledge-baseline='))?.split('=')[1];
const workspaceBaseline=process.argv.find(arg=>arg.startsWith('--workspace-baseline='))?.split('=')[1];
const creationBaseline=process.argv.find(arg=>arg.startsWith('--creation-baseline='))?.split('=')[1];
const baselineCommit=knowledgeBaseline??workspaceBaseline??creationBaseline;
const baselineSource=workspaceBaseline?'App.tsx':creationBaseline?'components/ProjectCreateForm.tsx':'Modules.tsx';
const baselineFolder=creationBaseline?'components/':'';
let baselineModule;
if(baselineCommit){
 if([knowledgeBaseline,workspaceBaseline,creationBaseline].filter(Boolean).length!==1||!/^[a-f0-9]{7,40}$/.test(baselineCommit)||!process.argv.some(arg=>arg.startsWith(workspaceBaseline?'--case=session_':creationBaseline?'--case=project_creat':'--case=knowledge_')))throw Error('Historical reproduction requires a commit hash and matching case filter');
 const ts=createRequire(new URL('../apps/web/package.json',import.meta.url))('typescript');
 const source=execFileSync('git',['show',`${baselineCommit}:apps/web/src/${baselineSource}`],{cwd:new URL('../',import.meta.url),encoding:'utf8'});
 baselineModule=ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace(/import \{([^}]+)\} from ["'](react(?:\/jsx-runtime)?)["'];/g,(_match,bindings,module)=>{
  const key=module==='react'?'baselineReact':'baselineJsx',file=module==='react'?'react':'react_jsx-runtime';
  return `import ${key} from "/node_modules/.vite/deps/${file}.js";const {${bindings.replace(/\bas\b/g,':')}}=${key};`;
 });
 // Match Vite's canonical component URLs so React contexts are not instantiated
 // twice by extensionless historical imports versus current transformed imports.
 baselineModule=baselineModule.replace(/(["'])\.\/([^"'\n]+)\1/g,(original,quote,relative)=>{
  const target=['','.tsx','.ts'].map(suffix=>baselineFolder+relative+suffix).find(file=>existsSync(new URL('../apps/web/src/'+file,import.meta.url)));
  return target?`${quote}/src/${target}${quote}`:original;
 });
}

// Controlled UI regression only: all API traffic is intercepted; no model or DB calls.
const origin = new URL(process.env.SMOKE_WEB_URL || 'http://127.0.0.1:5173');
if (!['127.0.0.1','localhost','[::1]'].includes(origin.hostname) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw Error('Loopback origin required');
if(baselineModule){
 const response=await fetch(new URL(`/src/${baselineSource}`,origin));if(!response.ok)throw Error('Local transformed module unavailable');
 const current=await response.text();const imports=new Map([...current.matchAll(/["'](\/(?:src|node_modules)\/[^"']+)["']/g)].map(match=>[match[1].split('?')[0],match[1]]));
 baselineModule=baselineModule.replace(/(["'])(\/(?:src|node_modules)\/[^"']+)\1/g,(original,quote,path)=>imports.has(path)?`${quote}${imports.get(path)}${quote}`:original);
}
const directory = new URL(`../.runtime/reliability-ui-${randomUUID()}/`,import.meta.url);
await mkdir(directory,{recursive:true});
const engine=process.argv.find(arg=>arg.startsWith('--engine='))?.slice(9)??'chromium';
const accessibilityOnly=process.argv.includes('--accessibility');
if(!['chromium','firefox','webkit'].includes(engine))throw Error('Unsupported browser engine');
const report={scope:'controlled_browser_responses',browserEngine:engine,historicalKnowledgeModule:knowledgeBaseline??null,historicalWorkspaceModule:workspaceBaseline??null,historicalProjectCreationModule:creationBaseline??null,realDatabase:false,realModel:false,checks:[],startedAt:new Date().toISOString()};
let browser;
try{
 browser=await ({chromium,firefox,webkit}[engine]).launch({headless:true,timeout:30000,...(engine==='chromium'?{channel:process.env.SMOKE_BROWSER_CHANNEL || (process.platform==='win32'?'msedge':undefined)}:{})});report.browserVersion=browser.version();
}catch(error){
 report.status='not_run';report.launchErrorType=error.constructor.name;report.finishedAt=new Date().toISOString();await writeFile(new URL('report.json',directory),JSON.stringify(report,null,2));console.log(`Browser launch not completed (${report.launchErrorType}); report: ${directory.pathname}`);process.exit(1);
}
const A='11111111-1111-4111-8111-111111111111', B='22222222-2222-4222-8222-222222222222';
const RA='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', RB='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const now='2026-10-31T12:00:00Z';
const project=id=>({id,name:id===A?'受控项目 A':'受控项目 B',description:'合成测试，不是真实业务数据',status:'active',createdAt:now,updatedAt:now});
const detail=(id,content)=>({project:project(id),requirements:[{id:id===A?RA:RB,projectId:id,version:1,status:'draft',content:content||`项目 ${id===A?'A':'B'} 的需求正文`,createdAt:now}]});
async function scenario(name,work){
 if(name.startsWith('accessibility_')!==accessibilityOnly)return;
 const filter=process.argv.find(arg=>arg.startsWith('--case='))?.slice(7);if(filter&&!name.includes(filter))return;
 if(engine!=='chromium'&&name==='code_draft_save_and_leave_checks_committed_state_under_cpu_throttle'){
  report.checks.push({name,status:'not_run',reason:'This case requires Chromium CDP CPU emulation; not supported by this engine.'});console.log(`NOT RUN ${name} (Chromium-only CPU emulation)`);return;
 }
 const context=await browser.newContext({viewport:{width:1440,height:950},reducedMotion:'reduce'});
 if(name!=='accessibility_auth')await context.addInitScript(()=>localStorage.setItem('gongxu_token','controlled-browser-fixture'));
 const page=await context.newPage();page.setDefaultTimeout(6000);
 const state={detailCounts:{},delay:()=>0,makeDetail:id=>detail(id),saveDelay:0,docSaveDelay:0,docReadDelay:()=>0,docReads:0,docResponse:null,docConflict:false,docHistory:[],evidence:null,writes:[],failSave:false,errors:[],tasks:[],cases:[],documents:[],detailOverride:null,detailStatus:200,runs:[],runCounts:{},runDelay:()=>0,searchDelay:0,searches:0};
 page.on('pageerror',error=>{state.errors.push('page_error');if(baselineCommit)console.log(`Historical browser module error: ${error.message}`);});
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.origin!==origin.origin){state.externalRequests=(state.externalRequests??0)+1;return route.abort();}
  if(/\/MarkdownRenderer[.-]/.test(url.pathname)){
   state.markdownLoads=(state.markdownLoads??0)+1;
   if(state.markdownGate)await state.markdownGate;
   if(state.markdownFail)return route.abort('failed');
  }
  if(baselineModule&&url.pathname===`/src/${baselineSource}`)return route.fulfill({contentType:'application/javascript',body:baselineModule});
  if(!url.pathname.startsWith('/api/')) return route.continue();
  const path=url.pathname.slice(4),method=route.request().method();
  let status=200,body={};
  if(path==='/health')body={status:'ok',service:'gongxu-api'};
  else if(path==='/ready')body={status:'ready'};
  else if(path==='/ai/status')body={configured:false};
  else if(path==='/growth'){
   const scope=url.searchParams.get('scope')??'current';state.growthReads=(state.growthReads??0)+1;
   body={scope:state.growthResponseScope??scope,counts:{projects:2,confirmedRequirements:scope==='history'?3:2,tasks:{total:scope==='history'?4:2,todo:1,doing:1,review:0,done:scope==='history'?1:0,blocked:scope==='history'?1:0},codeReviews:1,syntaxFindings:0,testCases:scope==='history'?4:2,testExecutions:{total:scope==='history'?2:0,passed:scope==='history'?1:0,failed:scope==='history'?1:0,blocked:0}},events:[],recommendations:scope==='history'?[]:[{code:'unexecuted',text:'合成当前版本建议',evidence:'本次范围内仍未执行'}],disclaimer:scope==='history'?'历史累计不代表当前验收':'当前确认版本，不计旧结果'};
   await new Promise(r=>setTimeout(r,state.growthDelay?.(scope)??0));if(state.growthFail){status=503;body={error:'database_unavailable'};}
  }
  else if(path==='/auth/logout'){state.logoutRequests=(state.logoutRequests??0)+1;body={ok:true};}
  else if(path==='/auth/login')body={token:'controlled-browser-next-session',user:{id:B,name:'合成账号B'}};
  else if(path==='/projects'&&method==='POST'){
   const input=route.request().postDataJSON();state.writes.push({path,body:input});await new Promise(r=>setTimeout(r,state.createDelay??0));
   if(state.failCreate){status=503;body={error:'database_unavailable'};}else{const id=randomUUID();body={project:{...project(id),...input}};state.createdProjects??={};state.createdProjects[id]=body.project;state.projectList=[body.project,...(state.projectList??[project(A),project(B)])];status=201;}
  }
  else if(path==='/projects'){body={projects:state.projectList??[project(A),project(B)]};await new Promise(r=>setTimeout(r,state.projectListDelay??0));}
  else if(/^\/projects\/[^/]+$/.test(path)){
   const id=path.split('/')[2];state.detailCounts[id]=(state.detailCounts[id]||0)+1;
   const count=state.detailCounts[id];body=state.detailOverride||(state.createdProjects?.[id]?{project:state.createdProjects[id],requirements:[]}:state.makeDetail(id,count));if(state.detailGate)await state.detailGate(id,count);await new Promise(resolve=>setTimeout(resolve,state.delay(id,count)));if(state.detailStatus!==200){status=state.detailStatus;body={error:state.detailStatus===401?'unauthorized':'database_unavailable'};}
  } else if(path.endsWith('/requirements')&&method==='POST'){
   state.writes.push({path,body:route.request().postDataJSON()});
   await new Promise(resolve=>setTimeout(resolve,state.saveDelay));
   if(state.failSave){status=503;body={error:'database_unavailable'};} else body={requirement:{...detail(path.split('/')[2]).requirements[0],id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',version:2,content:route.request().postDataJSON().content}};
  } else if(path.endsWith('/documents/generate')&&method==='POST'){
   state.docGenerateCalls=(state.docGenerateCalls??0)+1;
   if(state.docGenerateError){status=413;body={error:state.docGenerateError};}
   else{status=201;const document={id:'cccccccc-cccc-4ccc-8ccc-cccccccccccd',type:route.request().postDataJSON().type,content:'恢复后生成的合成文档',revision:1,modelName:'fixture',createdAt:now,requirementVersionId:RA};state.documents.unshift(document);body={document,evidence:state.evidence};}
  } else if(path.endsWith('/documents')) {state.docReads++;body={documents:(state.docResponse?state.docResponse(state.docReads):state.documents).map(row=>({revision:1,...row})),evidence:state.evidence};await new Promise(resolve=>setTimeout(resolve,state.docReadDelay(state.docReads)));}
  else if(/\/documents\/[^/]+$/.test(path)&&method==='PATCH'){
   state.writes.push({path,body:route.request().postDataJSON()});
   await new Promise(resolve=>setTimeout(resolve,state.docSaveDelay));
   if(state.failSave){status=503;body={error:'database_unavailable'};}else if(state.docConflict){status=409;body={error:'document_conflict',currentRevision:2};}else{const doc=state.documents.find(row=>path.endsWith('/'+row.id));body={document:{...doc,revision:(doc.revision||1)+1,content:route.request().postDataJSON().content}};state.documents=state.documents.map(row=>row.id===doc.id?body.document:row);}
  } else if(/\/documents\/[^/]+\/history$/.test(path))body={history:state.docHistory,nextCursor:null};
  else if(/\/documents\/[^/]+$/.test(path)&&method==='GET')body={document:state.documents.find(row=>path.endsWith('/'+row.id))};
  else if(path.endsWith('/test-cases')&&method==='GET'){
   const source=url.searchParams.get('requirementVersionId')??[...(state.detailOverride??state.makeDetail(path.split('/')[2])).requirements].filter(row=>row.status==='confirmed').sort((a,b)=>b.version-a.version)[0]?.id??null;
   const rows=state.cases.filter(row=>row.requirementVersionId===source),cursor=url.searchParams.get('cursor'),offset=cursor?Number(cursor.split('-')[1]):0,limit=Number(url.searchParams.get('limit')??50),revision=state.caseListRevision??1;
   const only=url.searchParams.get('summaryOnly')==='true',summary={requirementVersionId:source,requirementVersion:1,caseRevision:revision,capturedAt:now,total:rows.length,passed:rows.filter(row=>row.result==='passed').length,failed:rows.filter(row=>row.result==='failed').length,blocked:rows.filter(row=>row.result==='blocked').length,notRun:rows.filter(row=>row.result==='not_run').length};
   body={cases:only?[]:rows.slice(offset,offset+limit),summary:state.omitCaseSummary?undefined:summary,page:{limit,hasMore:!only&&offset+limit<rows.length,nextCursor:!only&&offset+limit<rows.length?`offset-${offset+limit}-${revision}`:null}};
   if(cursor&&Number(cursor.split('-')[2])!==revision){status=409;body={error:'test_list_changed'};}
   state.caseListReads=(state.caseListReads??0)+1;await new Promise(resolve=>setTimeout(resolve,state.caseListDelay?.(offset)??0));
   if(state.caseListFail){status=503;body={error:'database_unavailable'};}
  }
  else if(path.endsWith('/test-cases'))body={cases:state.cases};
  else if(/\/test-cases\/[^/]+\/execution$/.test(path)&&method==='PATCH'){
   const input=route.request().postDataJSON(),id=path.split('/').at(-2);state.writes.push({path,body:input});if(state.failCaseSave){status=503;body={error:'database_unavailable'};}else{state.caseListRevision=(state.caseListRevision??1)+1;state.cases=state.cases.map(row=>row.id===id?{...row,result:input.result,executionNote:input.note,executedAt:now,revision:(row.revision??1)+1}:row);body={case:state.cases.find(row=>row.id===id)};}
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
  else if(path==='/knowledge/answer'){state.answers=(state.answers??0)+1;state.answerQueries??=[];state.answerQueries.push(route.request().postDataJSON().query);await new Promise(r=>setTimeout(r,state.answerDelay??0));body={answer:'合成回答内容，不是真实模型结果',sources:[{id:RA,document_name:'合成回答来源',content:'回答实际提供的原文',page:1,distance:0.1}]};}
  else if(/\/tasks\/[^/]+$/.test(path)&&method==='PATCH'){
   const input=route.request().postDataJSON();state.writes.push({path,body:input});
   if(state.taskUpdateConflict){status=409;body={error:'task_requirement_outdated'};}else{state.tasks=state.tasks.map(task=>path.endsWith('/'+task.id)?{...task,status:input.status}:task);body={task:state.tasks.find(task=>path.endsWith('/'+task.id))};}
  }
  else if(path.endsWith('/tasks'))body={tasks:state.tasks};
  else if(path.endsWith('/code-draft')&&method==='GET'){body={draft:state.codeDraft??null};await new Promise(r=>setTimeout(r,state.codeDraftReadDelay??0));}
  else if(path.endsWith('/code-draft')&&method==='PUT'){
   const input=route.request().postDataJSON();state.writes.push({path,body:input});await new Promise(r=>setTimeout(r,state.codeSaveDelay??0));
   if(state.failSave){status=503;body={error:'database_unavailable'};}else if(state.codeConflict){status=409;body={error:'code_draft_conflict'};}else{state.codeDraft={projectId:A,language:input.language,code:input.code,revision:(state.codeDraft?.revision??0)+1,updatedAt:now};body={draft:state.codeDraft};}
  }
  else if(path.endsWith('/code-reviews')&&method==='POST'){
   const input=route.request().postDataJSON();state.writes.push({path,body:input});await new Promise(r=>setTimeout(r,state.reviewDelay??0));body={review:{id:'new-review',...input,aiAdvice:'新的合成审查建议',syntaxFindings:[],modelName:'fixture',createdAt:now,reviewContext:state.reviewContext??null}};state.reviews=[body.review,...(state.reviews??[])];status=201;
  }
  else if(path.endsWith('/code-reviews'))body={reviews:state.reviews??[]};
  else {status=404;body={error:'not_found'};}
  await route.fulfill({status,json:body}).catch(()=>{});
  if(method==='GET'&&/^\/projects\/[^/]+$/.test(path)){state.detailResponses??={};const id=path.split('/')[2];state.detailResponses[id]=(state.detailResponses[id]??0)+1;}
 });
 try{await work(page,state);assert.equal(state.errors.length,0);report.checks.push({name,status:'passed'});console.log(`PASS ${name}`);}
 catch(error){report.checks.push({name,status:'failed',errorType:error.constructor.name});console.log(`FAIL ${name}`);if(name.startsWith('workspace_motion'))console.log(await page.evaluate(()=>({hidden:document.hidden,reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,label:document.querySelector('.workspace-motion-toggle')?.textContent,motion:document.querySelector('.workspace-visual')?.getAttribute('data-motion')})));console.log((error.stack??'').split('\n').filter(line=>line.includes('reliability-browser.mjs')).slice(0,2).join('\n'));await page.screenshot({path:new URL(`${name}.png`,directory).pathname.replace(/^\/([A-Za-z]:)/,'$1')}).catch(()=>{});process.exitCode=1;}
 finally{await context.close();}
}
async function routeTo(page,id){await page.evaluate(path=>{history.pushState({},'',path);dispatchEvent(new PopStateEvent('popstate'));},`/projects/${id}/requirements`);}
async function waitFor(check){for(let i=0;i<100;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,20));}throw Error('Fixture request not observed');}
function casePageFixture(state,count=201){
 state.detailOverride={project:project(A),requirements:[{id:RA,version:2,status:'confirmed',content:'完整测试统计 · 合成',createdAt:now}]};
 state.cases=Array.from({length:count},(_,i)=>({id:`fixture-case-${i}`,title:i===count-1?'末页失败不能被隐藏':`分页合成用例 ${i+1}`,requirementVersionId:RA,category:'normal',revision:1,preconditions:'独立合成资料',steps:'人工检查',expected:'保留真实记录',result:i===count-1?'failed':'passed',executionNote:'合成记录，不是真实产品测试证据',executedAt:now}));
}
function traceFixture(state){
 const test={id:RB,title:'合成配对用例',requirementVersionId:RA,category:'normal',revision:1,preconditions:'',steps:'核对登记',expected:'审批留存',result:'not_run',executionNote:'',executedAt:null};
 state.detailOverride={project:project(A),requirements:[{id:RA,version:1,status:'confirmed',content:'审批留档',createdAt:now}]};state.cases=[test];
 state.traceData={version:{id:RA,number:1,current:true},items:[{id:RA,key:'REQ-fixture',position:1,start:0,end:4,text:'审批留档',change:'initial',coverage:{suggested:0,confirmedTasks:1,confirmedCases:1,stale:0,manualEvidence:0}}],links:[{id:'task-link',itemId:RA,taskId:RA,caseId:null,status:'confirmed',origin:'human'},{id:'case-link',itemId:RA,taskId:null,caseId:RB,caseRevision:1,status:'confirmed',origin:'human'}],tasks:[{id:RA,title:'合成审批任务'}],cases:[test],previousItems:[],impact:null,taskTests:[],taskTestHistory:[],scope:'受控浏览器替身，不是业务数据'};
}
async function auditAccessibility(page,name){
 await page.addScriptTag({path:createRequire(import.meta.url).resolve('axe-core/axe.min.js')});
 const result=await page.evaluate(async()=>{
  await document.fonts.ready;
  return window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa']}});
 });
 report.accessibility??={tool:result.testEngine,scope:'WCAG 2.0/2.1 A/AA rules supported by axe; synthetic content only; not a conformance claim',screens:[]};
 const compact=rows=>rows.map(row=>({id:row.id,impact:row.impact,description:row.description,helpUrl:row.helpUrl,nodes:row.nodes.map(node=>({target:node.target,html:node.html,failureSummary:node.failureSummary,checks:[...node.any,...node.all,...node.none].map(check=>({id:check.id,message:check.message,data:check.data}))}))}));
 report.accessibility.screens.push({name,url:new URL(page.url()).pathname,violations:compact(result.violations),incomplete:compact(result.incomplete),passedRuleCount:result.passes.length,inapplicableRuleCount:result.inapplicable.length});
 await page.screenshot({path:new URL(`${name}.png`,directory).pathname.replace(/^\/([A-Za-z]:)/,'$1'),fullPage:true});
 console.log(`${name}: ${result.violations.length} violation rules; ${result.incomplete.length} rules require manual review`);
 assert.equal(result.violations.length,0,`${name}: ${result.violations.map(row=>row.id).join(', ')}`);
}
try{
 const accessibilityScreens=[
  ['dashboard','/dashboard','.project-info strong'],['projects','/projects','.project-info strong'],
  ['missions','/missions','.mission-library'],['runs','/runs','#runs-project'],['delivery','/delivery','#delivery-project'],
  ['knowledge','/knowledge','#knowledge-name'],['growth','/growth','.growth-stats'],
  ['overview',`/projects/${A}`,'#pulse-title'],['requirements',`/projects/${A}/requirements`,'#requirement'],
  ['agent',`/projects/${A}/agent`,'.confirmed-task-panel'],['reviews',`/projects/${A}/reviews`,'#code-input'],
  ['tests',`/projects/${A}/tests`,'.case-item'],['documents',`/projects/${A}/documents`,'#doc-content'],
 ];
 for(const [name,path,selector] of accessibilityScreens)await scenario(`accessibility_${name}`,async(page,state)=>{
  traceFixture(state);
  state.tasks=[{id:RA,title:'合成审批任务',stage:'开发',description:'核对审批留档',deliverable:'合成记录',status:'todo',dependsOn:[],requirementVersionId:RA}];
  state.documents=[{id:RA,type:'readme',content:'# 合成项目\n\n审批留档说明',revision:1,modelName:'fixture',createdAt:now,requirementVersionId:RA}];
  await page.goto(`${origin.origin}${path}`);await page.locator(selector).first().waitFor();
  await auditAccessibility(page,`accessibility_${name}`);
 });
 await scenario('accessibility_edit_guard_dialog',async(page)=>{
  await page.goto(`${origin.origin}/projects/${A}/requirements`);await page.locator('#requirement').fill('合成未保存草稿');
  await page.getByRole('link',{name:'我的项目',exact:true}).first().click();await page.getByRole('dialog',{name:'保留未保存的编辑'}).waitFor();
  await auditAccessibility(page,'accessibility_edit_guard_dialog');
 });
 await scenario('accessibility_auth',async(page)=>{
  await page.goto(`${origin.origin}/dashboard`);await page.locator('.auth-page').waitFor();
  await auditAccessibility(page,'accessibility_auth');
 });
 await scenario('accessibility_quick_navigation_dialog',async(page)=>{
  await page.goto(`${origin.origin}/dashboard`);await page.locator('.quick-nav-trigger').click();await page.locator('#quick-nav-query').waitFor();
  await auditAccessibility(page,'accessibility_quick_navigation_dialog');
 });
 await scenario('accessibility_display_settings',async(page)=>{
  await page.goto(`${origin.origin}/dashboard`);await page.locator('.display-settings summary').click();await page.locator('.display-settings-panel').waitFor();
  await auditAccessibility(page,'accessibility_display_settings');
 });
 await scenario('accessibility_create_project',async(page)=>{
  await page.goto(`${origin.origin}/dashboard`);await page.getByRole('button',{name:/创建实训项目/}).click();await page.locator('#create-title').waitFor();
  await auditAccessibility(page,'accessibility_create_project');
 });
 await scenario('accessibility_requirement_history',async(page)=>{
  await page.goto(`${origin.origin}/projects/${A}/requirements`);await page.getByRole('button',{name:'查看需求版本 1',exact:true}).click();
  await page.getByRole('button',{name:'使用此版本编辑',exact:true}).waitFor();
  await auditAccessibility(page,'accessibility_requirement_history');
 });
 await scenario('keyboard_skip_navigation_preserves_route_and_marks_current_page',async(page)=>{
  await page.goto(`${origin.origin}/projects/${A}/requirements`);await page.locator('#requirement').waitFor();
  const previousUrl=page.url(),previousLength=await page.evaluate(()=>history.length);
  await page.keyboard.press('Tab');const skip=page.getByRole('link',{name:'跳到主要内容',exact:true});
  if(!(await skip.evaluate(el=>el===document.activeElement)))console.log(await page.evaluate(()=>`First Tab focused ${document.activeElement?.tagName}.${document.activeElement?.className}`));
  assert.ok(await skip.evaluate(el=>el===document.activeElement),await page.evaluate(()=>`First Tab focused ${document.activeElement?.tagName}.${document.activeElement?.className}`));assert.ok(await skip.isVisible());
  await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>document.activeElement?.id),'workspace-main');
  assert.equal(page.url(),previousUrl);assert.equal(await page.evaluate(()=>history.length),previousLength);
  assert.equal(await page.locator('.side-nav [aria-current="page"]').count(),1);
  assert.equal(await page.locator('.side-nav [aria-current="page"]').getAttribute('aria-label'),'我的项目');
  await page.keyboard.press('Tab');assert.ok(await page.locator('main').evaluate(main=>main.contains(document.activeElement)));
 });
 await scenario('markdown_deferred_load_keeps_complete_draft_and_builds_outline',async(page,state)=>{
  let release;state.markdownGate=new Promise(resolve=>{release=resolve;});
  const source='# 延迟排版标题\n\n<script>window.fixtureExecuted=true</script>\n![不可外发](https://example.invalid/fixture.png)\n\n## 末尾验收要求\n审批后必须保存记录';
  try{
   await page.goto(`${origin.origin}/dashboard`);await page.locator('.project-info strong').first().waitFor();assert.equal(state.markdownLoads??0,0);
   await routeTo(page,A);await page.locator('#requirement').fill(source);await page.getByRole('button',{name:'分栏',exact:true}).click();await waitFor(()=>state.markdownLoads>0);
   assert.equal(await page.locator('.rich-content-fallback').innerText(),source);assert.equal(await page.locator('#requirement').inputValue(),source);
   const edited=source+'\n加载期间新增的条件';await page.locator('#requirement').fill(edited);assert.equal(await page.locator('.rich-content-fallback').innerText(),edited);
   release();await page.getByRole('region',{name:'文档预览'}).getByRole('heading',{name:'末尾验收要求',exact:true}).waitFor();await page.getByRole('button',{name:'文档大纲',exact:true}).click();assert.equal(await page.locator('.document-outline button').count(),2);
   assert.equal(await page.locator('#requirement').inputValue(),edited);assert.equal(await page.locator('.rich-content img, .rich-content script').count(),0);assert.equal(await page.evaluate(()=>window.fixtureExecuted),undefined);assert.equal(state.externalRequests??0,0);
  }finally{release();}
 });
 await scenario('markdown_failed_chunk_retains_raw_text_and_retries_without_losing_edits',async(page,state)=>{
  state.markdownFail=true;const source='# 断网时的原文\n\n末尾条件必须保留';
  await page.goto(`${origin.origin}/projects/${A}/requirements`);await page.locator('#requirement').fill(source);await page.getByRole('button',{name:'分栏',exact:true}).click();await page.getByRole('button',{name:'重试排版',exact:true}).waitFor();
  assert.equal(await page.locator('.rich-content-fallback').innerText(),source);const edited=source+'\n断网后继续输入';await page.locator('#requirement').fill(edited);
  state.markdownFail=false;await page.getByRole('button',{name:'重试排版',exact:true}).click();await page.getByRole('region',{name:'文档预览'}).getByRole('heading',{name:'断网时的原文',exact:true}).waitFor();assert.equal(await page.locator('#requirement').inputValue(),edited);assert.ok(state.markdownLoads>=2);assert.equal(state.writes.length,0);
 });
 await scenario('markdown_late_renderer_never_reintroduces_previous_project_content',async(page,state)=>{
  let release;state.markdownGate=new Promise(resolve=>{release=resolve;});state.makeDetail=id=>detail(id,id===A?'# A项目原文':'# B项目原文\n\nB的验收条件');
  try{
   await page.goto(`${origin.origin}/projects/${A}/requirements`);await page.locator('#requirement').waitFor();await page.getByRole('button',{name:'预览',exact:true}).click();await waitFor(()=>state.markdownLoads>0);
   await routeTo(page,B);await waitFor(()=>state.detailCounts[B]>0);await page.locator('#requirement').waitFor();assert.equal(await page.locator('#requirement').inputValue(),'# B项目原文\n\nB的验收条件');await page.getByRole('button',{name:'预览',exact:true}).click();assert.equal(await page.locator('.rich-content-fallback').innerText(),'# B项目原文\n\nB的验收条件');release();await page.getByRole('region',{name:'文档预览'}).getByRole('heading',{name:'B项目原文',exact:true}).waitFor();assert.equal(await page.getByRole('heading',{name:'A项目原文',exact:true}).count(),0);assert.equal(await page.locator('#requirement').inputValue(),'# B项目原文\n\nB的验收条件');
  }finally{release();}
 });
 await scenario('growth_scope_fast_switch_discards_late_history_and_hides_old_statistics',async(page,state)=>{
  await page.goto(`${origin.origin}/growth`);await page.getByRole('heading',{name:'当前版本任务进度',exact:true}).waitFor();assert.ok((await page.getByRole('region',{name:'任务进度',exact:true}).innerText()).includes('共 2 项'));
  state.growthDelay=scope=>scope==='history'?450:0;const reads=state.growthReads;await page.getByLabel('任务与测试统计范围').selectOption('history');await waitFor(()=>state.growthReads>reads);
  assert.equal(await page.locator('.growth-stats').count(),0);await page.getByLabel('任务与测试统计范围').selectOption('current');await page.getByRole('heading',{name:'当前版本任务进度',exact:true}).waitFor();await page.waitForTimeout(550);
  assert.equal(await page.getByRole('heading',{name:'历史任务状态',exact:true}).count(),0);assert.ok((await page.getByRole('region',{name:'任务进度',exact:true}).innerText()).includes('共 2 项'));await page.getByText('合成当前版本建议',{exact:true}).waitFor();
 });
 await scenario('growth_scope_failure_and_mismatched_response_never_show_successful_statistics',async(page,state)=>{
  await page.goto(`${origin.origin}/growth`);await page.locator('.growth-stats').waitFor();state.growthFail=true;
  await page.getByLabel('任务与测试统计范围').selectOption('history');await page.getByRole('alert').waitFor();assert.equal(await page.locator('.growth-stats').count(),0);
  state.growthFail=false;state.growthResponseScope='current';await page.getByRole('button',{name:'重试',exact:true}).click();await page.getByText('统计范围与本次选择不一致，请刷新后重试。',{exact:false}).waitFor();assert.equal(await page.locator('.growth-stats').count(),0);
  state.growthResponseScope=null;await page.getByRole('button',{name:'重试',exact:true}).click();await page.getByRole('heading',{name:'历史任务状态',exact:true}).waitFor();assert.ok((await page.getByRole('region',{name:'任务进度',exact:true}).innerText()).includes('共 4 项'));assert.equal(await page.getByText('合成当前版本建议',{exact:true}).count(),0);
 });
 await scenario('growth_scope_keyboard_and_desktop_controls_remain_reachable',async(page)=>{
  await page.goto(`${origin.origin}/growth`);const selection=page.getByLabel('任务与测试统计范围');await page.locator('.growth-stats').waitFor();
  await selection.focus();await selection.press('ArrowDown');await selection.press('Enter');await page.getByRole('heading',{name:'历史任务状态',exact:true}).waitFor();assert.equal(await selection.evaluate(node=>document.activeElement===node),true);
  for(const [width,height,zoom]of [[1366,768,1],[1536,864,1.25],[1920,1080,1.5]]){
   await page.setViewportSize({width,height});await page.evaluate(z=>{document.documentElement.style.zoom=String(z);window.scrollTo(0,0);},zoom);
   const rect=await selection.boundingBox();assert.ok(rect&&rect.x>=0&&rect.y>=0&&rect.x+rect.width<=width+2&&rect.y+rect.height<=height,'Scope controls remain on-screen');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);
  }
 });
 await scenario('code_review_sources_distinguish_supplied_context_history_and_unknown',async(page,state)=>{
  state.detailOverride={project:project(A),requirements:[{id:RA,version:2,status:'confirmed',content:'当前合成需求',createdAt:now}]};
  state.reviews=[{id:'source-review',language:'typescript',code:'const x = 1;',aiAdvice:'基于旧需求的合成建议，尚未验证',syntaxFindings:[],modelName:'fixture',createdAt:now,reviewContext:{schemaVersion:1,scope:'project',capturedAt:now,requirement:{id:RB,version:1,content:'历史需求原文必须能核对'},retrieval:{status:'retrieved',segments:[{part:1,start:0,end:12,sourceIds:[RB]}],sources:[{id:RB,documentName:'实际传入的合成资料',page:2,content:'原文片段：只允许审批者操作。',distance:.1}]}}},{id:'legacy-review',language:'javascript',code:'let x;',aiAdvice:'旧审查',syntaxFindings:[],modelName:'fixture',createdAt:now}];
  await page.goto(`${origin.origin}/projects/${A}/reviews`);const sources=page.getByRole('region',{name:'本次审查依据'});await sources.getByText(/依据为历史需求/).waitFor();await sources.getByText(/核对提交时的完整需求/).click();await sources.getByText('历史需求原文必须能核对',{exact:true}).waitFor();await sources.getByText(/实际传入的合成资料/).click();await sources.getByText('原文片段：只允许审批者操作。',{exact:true}).waitFor();assert.equal(await sources.getByText(/并不证明模型实际引用/).count(),1);
  await page.locator('.run-link').nth(1).click();await sources.getByText(/历史记录未保存来源快照/).waitFor();assert.equal(await sources.getByText(/依据为历史需求/).count(),0);
  await page.locator('#review-scope').selectOption('code_only');await page.locator('#code-input').fill('const explicitScope = 1;');await page.getByRole('button',{name:'提交审查',exact:true}).click();await waitFor(()=>state.writes.some(row=>row.path.endsWith('/code-reviews')));const sent=state.writes.find(row=>row.path.endsWith('/code-reviews')).body;assert.equal(sent.context,'code_only');assert.equal(sent.requirementId,undefined);
 });
 await scenario('code_review_cancellation_keeps_draft_and_ignores_late_advice',async(page,state)=>{
  state.reviewDelay=600;await page.goto(`${origin.origin}/projects/${A}/reviews`);await page.locator('#code-input').fill('const retained = 1;');await page.getByRole('button',{name:'提交审查',exact:true}).click();await waitFor(()=>state.writes.some(row=>row.path.endsWith('/code-reviews')));
  await page.getByRole('button',{name:'取消审查等待',exact:true}).click();await page.waitForTimeout(750);assert.equal(await page.getByText('新的合成审查建议',{exact:true}).count(),0);assert.equal(await page.locator('#code-input').inputValue(),'const retained = 1;');await page.getByText(/本地等待已取消/).waitFor();assert.equal(state.codeDraft.code,'const retained = 1;');
 });
 await scenario('code_draft_save_and_leave_checks_committed_state_under_cpu_throttle',async(page,state)=>{
  const session=await page.context().newCDPSession(page);await session.send('Emulation.setCPUThrottlingRate',{rate:4});page.setDefaultTimeout(12000);
  try{await page.goto(`${origin.origin}/projects/${A}/reviews`);await page.locator('#code-input').fill('const committedSnapshot = 1;');await page.getByRole('link',{name:'知识库',exact:true}).first().click();
   await page.getByRole('dialog',{name:'保留未保存的编辑'}).getByRole('button',{name:'保存并继续'}).click();await page.waitForURL('**/knowledge');assert.equal(state.writes.length,1);assert.equal(state.codeDraft.code,'const committedSnapshot = 1;');assert.ok(state.writes[0].path.endsWith('/code-draft'));
  }finally{await session.send('Emulation.setCPUThrottlingRate',{rate:1});await session.detach();}
 });
 await scenario('project_creation_guard_blocks_loss_and_only_leaves_after_success',async(page,state)=>{
  await page.goto(`${origin.origin}/dashboard`);await page.getByRole('button',{name:'创建实训项目'}).click();await page.locator('#name').fill('尚未创建的合成项目');await page.locator('#description').fill('切页前必须保留的想法');
  await page.getByRole('link',{name:'知识库',exact:true}).first().click();const guard=page.getByRole('dialog',{name:'保留未保存的编辑'});await guard.waitFor();await page.keyboard.press('Escape');assert.equal(await page.locator('#description').inputValue(),'切页前必须保留的想法');
  state.failCreate=true;await page.getByRole('link',{name:'知识库',exact:true}).first().click();await guard.getByRole('button',{name:'保存并继续'}).click();await guard.getByText(/保存未成功/).waitFor();assert.ok(page.url().endsWith('/dashboard'));assert.equal(await page.locator('#name').inputValue(),'尚未创建的合成项目');
  state.failCreate=false;await guard.getByRole('button',{name:'保存并继续'}).click();await page.waitForURL('**/knowledge');assert.equal(state.writes.length,2);assert.ok(state.writes.every(write=>write.path==='/projects'));assert.equal(Object.keys(state.createdProjects).length,1);
 });
 await scenario('project_creation_single_flight_and_new_input_survive_response',async(page,state)=>{
  state.createDelay=600;await page.goto(`${origin.origin}/dashboard`);await page.getByRole('button',{name:'创建实训项目'}).click();await page.locator('#name').fill('第一次项目提交');
  await page.locator('#name').evaluate(input=>{input.form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));input.form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});await waitFor(()=>state.writes.length>0);await page.locator('#name').fill('创建等待期间的新项目');await page.locator('#description').fill('不能被迟到创建响应清空');await page.waitForTimeout(850);
  assert.equal(state.writes.length,1);assert.ok(page.url().endsWith('/dashboard'));assert.equal(await page.locator('#description').inputValue(),'不能被迟到创建响应清空');assert.equal(await page.locator('#name').inputValue(),'创建等待期间的新项目');
  state.createDelay=0;await page.locator('#name').evaluate(input=>input.form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));await page.waitForURL('**/projects/*');assert.equal(state.writes.length,2);await page.locator('.detail-heading h2').filter({hasText:'创建等待期间的新项目'}).waitFor();
 });
 await scenario('project_creation_close_and_back_navigation_keep_cancelled_input',async(page)=>{
  await page.goto(`${origin.origin}/dashboard`);await page.getByRole('link',{name:'我的项目',exact:true}).first().click();await page.waitForURL('**/projects');await page.getByRole('button',{name:'创建实训项目'}).click();await page.locator('#name').fill('返回时仍保留的项目');
  await page.goBack();const guard=page.getByRole('dialog',{name:'保留未保存的编辑'});await guard.waitFor();await guard.getByRole('button',{name:'留在此页'}).click();assert.ok(page.url().endsWith('/projects'));assert.equal(await page.locator('#name').inputValue(),'返回时仍保留的项目');
  await page.getByRole('button',{name:'关闭',exact:true}).click();await guard.waitFor();await page.keyboard.press('Escape');assert.equal(await page.locator('#name').inputValue(),'返回时仍保留的项目');await page.getByRole('button',{name:'关闭',exact:true}).click();await guard.getByRole('button',{name:'放弃并继续'}).click();await page.locator('#name').waitFor({state:'hidden'});
  await page.getByRole('button',{name:'创建实训项目'}).click();assert.equal(await page.locator('#name').inputValue(),'');
 });
 await scenario('project_create_navigation_waits_for_committed_clear_not_a_frame',async(page,state)=>{
  await page.goto(`${origin.origin}/dashboard`);await page.getByRole('button',{name:'创建实训项目'}).click();await page.locator('#name').fill('保存状态提交后进入 · 合成');
  // A legal frame/React ordering observed in WebKit is made deterministic here:
  // the next frame callback runs before React commits the async save result.
  await page.locator('#name').evaluate(input=>{const original=window.requestAnimationFrame;window.requestAnimationFrame=callback=>{window.requestAnimationFrame=original;queueMicrotask(()=>callback(performance.now()));return 0;};input.form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
  await page.waitForURL('**/projects/*');
  assert.equal(state.writes.filter(write=>write.path==='/projects').length,1);assert.equal(await page.getByRole('dialog',{name:'保留未保存的编辑'}).count(),0);await page.locator('.detail-heading h2').filter({hasText:'保存状态提交后进入 · 合成'}).waitFor();
 });
 await scenario('session_new_account_cannot_see_previous_project_cache',async(page,state)=>{
  await page.goto(`${origin.origin}/dashboard`);await page.locator('.project-explorer').getByText('受控项目 A',{exact:true}).waitFor();
  await page.getByRole('link',{name:'知识库',exact:true}).first().click();await page.locator('#knowledge-name').waitFor();await page.getByRole('button',{name:/退出登录/}).click();await page.locator('#email').waitFor();
  state.projectList=[project(B)];await page.locator('#email').fill('synthetic-b@example.invalid');await page.locator('#password').fill('fixture-password-only');await page.getByRole('button',{name:/登录工作空间/}).click();await page.locator('#knowledge-name').waitFor();
  await page.keyboard.press('Control+k');await page.locator('#quick-nav-query').fill('受控项目 A');assert.equal(await page.locator('.quick-nav-results').getByText('受控项目 A',{exact:true}).count(),0);
 });
 await scenario('session_storage_change_invalidates_old_editor_and_late_response',async(page,state)=>{
  await page.goto(`${origin.origin}/projects/${A}/requirements`);await page.locator('#requirement').fill('账号A未保存的合成内容');
  state.detailStatus=404;state.delay=()=>450;
  await page.evaluate(()=>{const oldValue=localStorage.getItem('gongxu_token');localStorage.setItem('gongxu_token','controlled-browser-next-session');dispatchEvent(new StorageEvent('storage',{key:'gongxu_token',oldValue,newValue:'controlled-browser-next-session',storageArea:localStorage}));});
  await page.waitForTimeout(650);assert.equal(await page.locator('#requirement').count(),0);assert.equal(await page.getByText('受控项目 A',{exact:true}).count(),0);assert.equal(await page.evaluate(()=>localStorage.getItem('gongxu_token')),'controlled-browser-next-session');
 });
 await scenario('session_normal_logout_still_requires_unsaved_choice',async(page,state)=>{
  await page.goto(`${origin.origin}/projects/${A}/requirements`);await page.locator('#requirement').fill('正常退出前的合成草稿');await page.getByRole('button',{name:/退出登录/}).click();
  const guard=page.getByRole('dialog',{name:'保留未保存的编辑'});await guard.waitFor();await page.keyboard.press('Escape');assert.equal(state.logoutRequests??0,0);assert.equal(await page.locator('#requirement').inputValue(),'正常退出前的合成草稿');
  state.failSave=true;await page.getByRole('button',{name:/退出登录/}).click();await guard.getByRole('button',{name:'保存并继续'}).click();await guard.getByText(/保存未成功/).waitFor();assert.equal(state.logoutRequests??0,0);
  await guard.getByRole('button',{name:'放弃并继续'}).click();await page.locator('#email').waitFor();assert.equal(state.logoutRequests,1);
 });
 await scenario('code_workspace_desktop_primary_actions_and_long_input_fit',async(page,state)=>{
  for(const [width,height] of [[1366,768],[1536,864],[1920,1080]]){
   await page.setViewportSize({width,height});await page.goto(`${origin.origin}/projects/${A}/reviews`);await page.locator('#code-input').waitFor();
   for(const name of ['保存代码草稿','提交审查']){const box=await page.getByRole('button',{name,exact:true}).boundingBox();assert.ok(box&&box.y>=0&&box.y+box.height<=height,`Primary action not initially visible at ${width}`);}
   await page.screenshot({path:new URL(`code-workspace-${width}.png`,directory).pathname.replace(/^\/([A-Za-z]:)/,'$1')});
   await page.locator('#code-input').fill('const longIdentifier = "'+'x'.repeat(40000)+'";');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+2),true);
  }
 });
 await scenario('code_review_late_reply_preserves_selected_history_and_newer_draft',async(page,state)=>{
  state.reviewDelay=650;state.reviews=[RA,RB].map((id,i)=>({id,language:'typescript',code:'const old = 0;',syntaxFindings:[],aiAdvice:i?'历史B合成建议':'历史A合成建议',modelName:'fixture',createdAt:now}));
  state.codeDraft={language:'typescript',code:'const saved = 0;',revision:1,updatedAt:now};await page.goto(`${origin.origin}/projects/${A}/reviews`);await page.locator('#code-input').fill('const submitted = 1;');
  await page.locator('#code-input').evaluate(input=>{input.form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));input.form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});await waitFor(()=>state.writes.some(row=>row.path.endsWith('/code-reviews')));
  await page.locator('.run-link').nth(1).click();await page.locator('#code-input').fill('const newest = 2;');await page.waitForTimeout(800);
  assert.equal(await page.getByText('历史B合成建议',{exact:true}).count(),1);assert.equal(await page.locator('#code-input').inputValue(),'const newest = 2;');assert.equal(state.writes.filter(row=>row.path.endsWith('/code-reviews')).length,1);assert.equal(state.writes.find(row=>row.path.endsWith('/code-reviews')).body.code,'const submitted = 1;');
 });
 await scenario('code_draft_leave_guard_saves_without_invoking_ai',async(page,state)=>{
  await page.goto(`${origin.origin}/projects/${A}/reviews`);await page.locator('#code-input').fill('const pending = 1;');await page.getByRole('link',{name:'知识库',exact:true}).first().click();const guard=page.getByRole('dialog',{name:'保留未保存的编辑'});await guard.waitFor();await page.keyboard.press('Escape');assert.equal(await page.locator('#code-input').inputValue(),'const pending = 1;');
  state.failSave=true;await page.getByRole('link',{name:'知识库',exact:true}).first().click();await guard.getByRole('button',{name:'保存并继续'}).click();await guard.getByText(/保存未成功/).waitFor();assert.ok(page.url().endsWith('/reviews'));assert.equal(state.writes.length,1);assert.ok(state.writes[0].path.endsWith('/code-draft'));
  state.failSave=false;await guard.getByRole('button',{name:'保存并继续'}).click();await page.waitForURL('**/knowledge');assert.equal(state.writes.length,2);assert.ok(state.writes.every(row=>row.path.endsWith('/code-draft')));await page.goto(`${origin.origin}/projects/${A}/reviews`);await page.waitForFunction(()=>document.querySelector('#code-input')?.value==='const pending = 1;');
 });
 await scenario('code_draft_save_conflict_and_new_input_never_discard_content',async(page,state)=>{
  state.codeSaveDelay=650;state.codeDraft={language:'typescript',code:'const original = 0;',revision:1,updatedAt:now};await page.goto(`${origin.origin}/projects/${A}/reviews`);await page.locator('#code-input').fill('const saved = 1;');
  await page.getByRole('button',{name:'保存代码草稿',exact:true}).click();await waitFor(()=>state.writes.length===1);await page.locator('#code-input').fill('const newer = 2;');await page.waitForTimeout(800);assert.equal(await page.locator('#code-input').inputValue(),'const newer = 2;');assert.equal(state.writes[0].body.code,'const saved = 1;');
  state.codeSaveDelay=0;state.codeConflict=true;state.codeDraft={language:'typescript',code:'const otherWindow = 3;',revision:3,updatedAt:now};await page.getByRole('button',{name:'保存代码草稿',exact:true}).click();await page.getByText('const otherWindow = 3;', {exact:true}).waitFor();assert.equal(await page.locator('#code-input').inputValue(),'const newer = 2;');
  await page.getByRole('button',{name:'已核对，以当前输入继续编辑',exact:true}).click();state.codeConflict=false;await page.getByRole('button',{name:'保存代码草稿',exact:true}).click();await waitFor(()=>state.writes.length===3);assert.equal(state.writes[2].body.expectedRevision,3);assert.equal(state.writes[2].body.code,'const newer = 2;');
 });
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
 await scenario('document_generation_boundary_preserves_selected_content_and_can_recover',async(page,state)=>{
  state.makeDetail=id=>{const value=detail(id);value.requirements[0].status='confirmed';return value;};
  state.documents=[{id:RA,type:'readme',content:'已有文档原文必须保留',revision:1,modelName:'fixture',createdAt:now,requirementVersionId:RA}];
  await page.goto(`${origin.origin}/projects/${A}/documents`);await page.locator('#doc-content').waitFor();
  for(const [code,text] of [['document_context_incomplete','50 条'],['document_context_too_large','30000 字符']]){
   state.docGenerateError=code;await page.getByRole('button',{name:/生成草稿/}).click();
   await page.getByRole('alert').filter({hasText:text}).waitFor();assert.equal(await page.locator('#doc-content').inputValue(),'已有文档原文必须保留');assert.equal(state.documents.length,1);assert.ok(!await page.getByRole('button',{name:/生成草稿/}).isDisabled());
  }
  state.docGenerateError=null;await page.getByRole('button',{name:/生成草稿/}).click();await page.getByText('已生成草稿，请核实并编辑。',{exact:true}).waitFor();
  assert.equal(await page.locator('#doc-content').inputValue(),'恢复后生成的合成文档');assert.equal(state.docGenerateCalls,3);
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
 await scenario('agent_stale_task_write_is_disabled_and_refresh_preserves_review_choice',async(page,state)=>{
  const old={id:RA,version:1,status:'confirmed',content:'初始确认需求',createdAt:now};state.detailOverride={project:project(A),requirements:[old]};
  state.runs=[{id:RA,requirementVersionId:RA,status:'awaiting_review',createdAt:now,plan:{tasks:[]},errorCode:null}];state.tasks=[{id:RB,title:'切版前的任务',status:'todo',stage:'开发',description:'只在对应版本更新',deliverable:'合成产物',dependsOn:[],requirementVersionId:RA}];
  await page.goto(`${origin.origin}/projects/${A}/agent`);await page.locator('#plan-review-note').fill('必须保留的人工审核草稿');state.taskUpdateConflict=true;await page.getByLabel('切版前的任务状态').selectOption('done');await page.getByRole('button',{name:'重新读取项目需求',exact:true}).waitFor();assert.equal(await page.getByLabel('切版前的任务状态').isDisabled(),true);assert.equal(await page.getByLabel('切版前的任务状态').inputValue(),'todo');
  state.detailOverride={project:project(A),requirements:[{id:RB,version:2,status:'confirmed',content:'其他标签的新确认需求',createdAt:now},old]};
  await page.getByRole('button',{name:'重新读取项目需求',exact:true}).click();const guard=page.getByRole('dialog',{name:'保留未保存的编辑'});await guard.waitFor();await guard.getByRole('button',{name:'留在此页'}).click();assert.equal(await page.locator('#plan-review-note').inputValue(),'必须保留的人工审核草稿');assert.equal(await page.getByLabel('切版前的任务状态').isDisabled(),true);
  await page.getByRole('button',{name:'重新读取项目需求',exact:true}).click();await guard.getByRole('button',{name:'放弃并继续'}).click();await page.getByRole('option',{name:'当前需求 V2',exact:true}).waitFor({state:'attached'});assert.equal(await page.getByText('切版前的任务',{exact:true}).count(),0);assert.equal(state.writes.length,1);assert.ok(state.writes[0].path.endsWith('/tasks/'+RB));
  await page.getByLabel('任务来源需求版本').selectOption(RA);await page.getByText('切版前的任务',{exact:true}).waitFor();assert.equal(await page.getByLabel('切版前的任务状态').isDisabled(),true);
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
 await scenario('test_pages_show_complete_totals_and_reach_the_hidden_failure',async(page,state)=>{
  casePageFixture(state);await page.goto(`${origin.origin}/projects/${A}/tests`);
  await page.getByText('完整版本共 201 条 · 第 1 页 · 本页 50 条',{exact:true}).waitFor();assert.equal(await page.locator('.case-item').count(),50);assert.match(await page.locator('.test-summary').innerText(),/201/);assert.match(await page.locator('.test-summary [data-outcome=failed]').innerText(),/1/);
  await waitFor(()=>state.traceReads>=2);const traceReads=state.traceReads;
  for(let n=2;n<=5;n++){await page.getByRole('button',{name:'下一页用例',exact:true}).click();await page.getByText(`完整版本共 201 条 · 第 ${n} 页 · 本页 ${n===5?1:50} 条`,{exact:true}).waitFor();}
  await page.getByText('末页失败不能被隐藏',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'下一页用例',exact:true}).isDisabled(),true);
  assert.equal(state.traceReads,traceReads,'Paging unchanged cases must not reload the complete trace graph');
  await page.getByLabel('执行状态筛选').selectOption('passed');await page.getByText('没有匹配的用例，请调整筛选条件。',{exact:true}).waitFor();assert.match(await page.locator('.test-summary').innerText(),/201/);assert.ok((await page.locator('.test-collection').innerText()).includes('搜索与筛选仅作用于本页'));
  await page.getByRole('button',{name:'上一页用例',exact:true}).click();await page.getByText('完整版本共 201 条 · 第 4 页 · 本页 50 条',{exact:true}).waitFor();assert.equal(await page.getByLabel('执行状态筛选').inputValue(),'all');
  await page.goto(`${origin.origin}/projects/${A}`);await page.getByText(/完整版本统计 · 人工登记/).waitFor();assert.match(await page.locator('.pulse-stats').innerText(),/失败或阻塞 1 条/);
  await page.goto(`${origin.origin}/delivery`);await page.getByText('201 条当前需求用例（完整版本统计），201 条人工登记结果，1 条失败或阻塞',{exact:true}).waitFor();
  state.omitCaseSummary=true;await page.getByRole('button',{name:'刷新成果记录',exact:true}).click();await page.getByText('完整版本统计暂不可用，请刷新核对',{exact:true}).waitFor();
 });
 await scenario('test_page_navigation_guards_cancel_repeated_clicks_and_failed_save',async(page,state)=>{
  casePageFixture(state,51);await page.goto(`${origin.origin}/projects/${A}/tests`);const note=page.locator('.case-item').first().getByLabel('执行说明 / 证据');await note.fill('分页前必须保留的人工草稿');const before=state.caseListReads;
  await page.getByRole('button',{name:'下一页用例',exact:true}).evaluate(button=>{button.click();button.click();});const dialog=page.getByRole('dialog',{name:'保留未保存的编辑'});await dialog.waitFor();assert.equal(state.caseListReads,before);
  await dialog.getByRole('button',{name:'留在此页'}).click();assert.equal(await note.inputValue(),'分页前必须保留的人工草稿');assert.ok((await page.getByRole('group',{name:'测试用例分页'}).innerText()).includes('第 1 页'));
  state.failCaseSave=true;await page.getByRole('button',{name:'下一页用例',exact:true}).click();await dialog.getByRole('button',{name:'保存并继续'}).click();await dialog.getByText(/保存未成功/).waitFor();assert.equal(state.caseListReads,before);assert.equal(await note.inputValue(),'分页前必须保留的人工草稿');
  await dialog.getByRole('button',{name:'留在此页'}).click();state.failCaseSave=false;await page.getByRole('button',{name:'下一页用例',exact:true}).click();await dialog.getByRole('button',{name:'放弃并继续'}).click();await page.getByText('完整版本共 51 条 · 第 2 页 · 本页 1 条',{exact:true}).waitFor();assert.equal(state.writes.length,1);
 });
 await scenario('test_page_stale_cursor_and_refresh_failure_keep_edits_until_recovery',async(page,state)=>{
  casePageFixture(state,51);await page.goto(`${origin.origin}/projects/${A}/tests`);await page.getByText('完整版本共 51 条 · 第 1 页 · 本页 50 条',{exact:true}).waitFor();state.caseListRevision=2;
  await page.getByRole('button',{name:'下一页用例',exact:true}).click();await page.getByRole('alert').filter({hasText:'用例记录或需求来源已变化'}).waitFor();assert.equal(await page.locator('.case-item').count(),50);assert.equal(await page.getByRole('button',{name:'下一页用例',exact:true}).isDisabled(),true);assert.match(await page.locator('.test-summary').innerText(),/待刷新/);
  const note=page.locator('.case-item').first().getByLabel('执行说明 / 证据');await note.fill('刷新失败也要保留');state.caseListFail=true;
  await page.getByRole('button',{name:'刷新用例与统计',exact:true}).click();const dialog=page.getByRole('dialog',{name:'保留未保存的编辑'});await dialog.getByRole('button',{name:'放弃并继续'}).click();await page.getByRole('alert').filter({hasText:'数据服务暂不可用'}).waitFor();assert.equal(await note.inputValue(),'刷新失败也要保留');
  state.caseListFail=false;state.caseListDelay=()=>450;await page.getByRole('button',{name:'刷新用例与统计',exact:true}).click();await dialog.getByRole('button',{name:'放弃并继续'}).click();await page.getByText('正在读取选定版本与完整统计，当前页暂不可编辑…',{exact:true}).waitFor();assert.equal(await note.isDisabled(),true);
  await page.getByText('完整版本共 51 条 · 第 1 页 · 本页 50 条',{exact:true}).waitFor();assert.equal(await note.inputValue(),'合成记录，不是真实产品测试证据');assert.equal(await note.isDisabled(),false);assert.equal(await page.getByRole('button',{name:'下一页用例',exact:true}).isEnabled(),true);
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
  state.makeDetail=(id,count)=>detail(id,`${id===A?'A':'B'} 第 ${count} 次新鲜响应`);
  // Mount on B first so React StrictMode's initial effect replay cannot be
  // mistaken for the second A visit. Then release the old A response last.
  await page.goto(`${origin.origin}/projects/${B}/requirements`);await page.locator('#requirement').waitFor();
  let releaseOld;const oldReply=new Promise(resolve=>{releaseOld=resolve;});state.detailGate=(id,count)=>id===A&&count===1?oldReply:Promise.resolve();
  try{
   await routeTo(page,A);await waitFor(()=>state.detailCounts[A]===1);await routeTo(page,B);await page.locator('#requirement').waitFor();
   await routeTo(page,A);await waitFor(()=>state.detailCounts[A]===2);await page.waitForFunction(()=>document.querySelector('#requirement')?.value==='A 第 2 次新鲜响应');
   releaseOld();await waitFor(()=>state.detailResponses[A]===2);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   assert.equal(await page.locator('#requirement').inputValue(),'A 第 2 次新鲜响应');
   await page.getByRole('button',{name:/保存需求草稿/}).click();await waitFor(()=>state.writes.length===1);assert.ok(state.writes[0].path.includes(A));assert.equal(state.writes[0].body.content,'A 第 2 次新鲜响应');
  }finally{releaseOld();}
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
 await scenario('knowledge_answer_cancel_and_retry_keep_response_question_identity',async(page,state)=>{
  state.answerDelay=400;await page.goto(`${origin.origin}/knowledge`);await page.getByLabel('检索问题').fill('第一次回答的问题');
  await page.getByRole('button',{name:/知识增强回答/}).click();await waitFor(()=>state.answers===1);
  await page.getByRole('button',{name:'取消回答等待',exact:true}).click();await page.getByRole('status').filter({hasText:/本次回答等待已取消/}).waitFor();
  await page.waitForTimeout(450);assert.equal(await page.getByText('合成回答内容，不是真实模型结果',{exact:true}).count(),0);
  await page.getByLabel('检索问题').fill('实际发出的第二个问题');await page.getByRole('button',{name:/知识增强回答/}).click();await waitFor(()=>state.answers===2);
  await page.getByLabel('检索问题').fill('尚未发出的新问题');await page.getByText('合成回答内容，不是真实模型结果',{exact:true}).waitFor();
  assert.equal(await page.getByLabel('检索问题').inputValue(),'尚未发出的新问题');
  await page.getByText('本次回答问题：实际发出的第二个问题',{exact:true}).waitFor();
  assert.deepEqual(state.answerQueries,['第一次回答的问题','实际发出的第二个问题']);
 });
 await scenario('knowledge_search_result_keeps_original_question_when_input_changes',async(page,state)=>{
  state.searchDelay=300;await page.goto(`${origin.origin}/knowledge`);await page.getByLabel('检索问题').fill('已发出的检索问题');
  await page.getByRole('button',{name:/检索知识/}).click();await waitFor(()=>state.searches===1);await page.getByLabel('检索问题').fill('尚未检索的新输入');
  await page.getByText('成功检索的合成片段',{exact:true}).waitFor();await page.getByText('本次检索问题：已发出的检索问题',{exact:true}).waitFor();
  assert.equal(await page.getByLabel('检索问题').inputValue(),'尚未检索的新输入');
 });
}finally{await browser.close();report.finishedAt=new Date().toISOString();await writeFile(new URL('report.json',directory),JSON.stringify(report,null,2));}
