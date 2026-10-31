import {createRequire} from 'node:module';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {loadConfig} from '../apps/api/dist/config.js';
import {PgProjectStore} from '../apps/api/dist/project-store.js';
import {registerProjectRoutes} from '../apps/api/dist/project-routes.js';
import {PgDocumentStore} from '../apps/api/dist/documents/store.js';
import {registerDocumentRoutes} from '../apps/api/dist/documents/routes.js';
const require=createRequire(new URL('../apps/api/package.json',import.meta.url));
require('dotenv').config({path:fileURLToPath(new URL('../apps/api/.env',import.meta.url))});
const config=loadConfig();
const local=value=>['127.0.0.1','localhost','[::1]'].includes(new URL(value).hostname);
if(!config.DATABASE_URL||!local(config.DATABASE_URL))throw Error('Existing local database required');
const send=globalThis.fetch;globalThis.fetch=(input,init)=>{if(!local(input instanceof Request?input.url:String(input)))throw Error('External request prohibited');return send(input,{...init,redirect:'error'});};
const {Pool}=require('pg'),Fastify=require('fastify');
const pool=new Pool({connectionString:config.DATABASE_URL,connectionTimeoutMillis:3000,statement_timeout:15000,query_timeout:18000});
const projects=new PgProjectStore(pool),documents=new PgDocumentStore(pool),app=Fastify({logger:false});
let calls=0,captured='',owner,foreign,browser,stage='setup';
await registerProjectRoutes(app,projects);
await registerDocumentRoutes(app,projects,documents,{baseUrl:'https://example.invalid',apiKey:'fixture-only',model:'controlled-fixture',timeoutMs:1000},async(_config,messages)=>{calls++;captured=messages[1].content;return '# 合成资料报告\n只用于完整性验证，尚未验证真实模型效果。';});
app.get('/health',async()=>({status:'ok',service:'gongxu-api'}));app.get('/ready',async()=>({status:'ready'}));app.get('/ai/status',async()=>({configured:false}));
const directory=new URL(`../.runtime/document-context-local-${randomUUID()}/`,import.meta.url);await mkdir(directory,{recursive:true});
const report={scope:'real_local_database_http_browser_with_document_chat_fixture',realModel:false,syntheticRecords:true,startedAt:new Date().toISOString(),checks:[]};
const call=(method,url,payload,identity=owner)=>app.inject({method,url,headers:{authorization:`Bearer ${identity.token}`},...(payload===undefined?{}:{payload})});
async function check(name,run){stage=name;await run();report.checks.push({name,status:'passed'});console.log(`PASS ${name}`);}
async function project(){
 const p=await call('POST','/projects',{name:'文档完整性 · 合成验证',description:'仅本地合成数据，不作为真实学生成绩'});assert.equal(p.statusCode,201);const id=p.json().project.id;
 const r=await call('POST',`/projects/${id}/requirements`,{content:'保留完整执行说明与原始版本，不能将合成通过写成真实环境已验证。'});assert.equal(r.statusCode,201);const version=r.json().requirement.id;
 assert.equal((await call('POST',`/projects/${id}/requirements/${version}/confirm`)).statusCode,200);return{id,version,url:`/projects/${id}`};
}
async function cases(p,count,note=''){
 return pool.query(`INSERT INTO practice_test_cases(project_id,requirement_version_id,title,category,preconditions,steps,expected,model_name,result,execution_note,executed_at)
 SELECT $1,$2,'文档合成用例 '||n,'normal','独立合成账号','核对真实写入与原文','来源与正文一致','controlled-fixture','blocked',$4,now() FROM generate_series(1,$3::integer) n RETURNING id`,[p.id,p.version,count,note||'合成阻塞说明，尚无真实运行证据']);
}
async function tasks(p,count){
 const run=await pool.query(`INSERT INTO agent_runs(project_id,requirement_version_id,model_name,status,plan,confirmed_at) VALUES($1,$2,'controlled-fixture','confirmed','{"tasks":[]}'::jsonb,now()) RETURNING id`,[p.id,p.version]);
 return pool.query(`INSERT INTO tasks(project_id,requirement_version_id,agent_run_id,plan_key,title,stage,description,deliverable) SELECT $1,$2,$3,'fixture-'||n,'文档合成任务 '||n,'核对','必须保留完整任务依据','可复核的合成验收记录' FROM generate_series(1,$4::integer) n RETURNING id`,[p.id,p.version,run.rows[0].id,count]);
}
try{
 for(const isForeign of [false,true]){
  const response=await app.inject({method:'POST',url:'/auth/register',payload:{name:'文档完整性 · 合成',email:`document-context-${randomUUID()}@example.test`,password:randomBytes(24).toString('base64url')}});assert.equal(response.statusCode,201);const data=response.json();const identity={id:data.user.id,token:data.token};if(isForeign)foreign=identity;else owner=identity;
 }
 let complete,large;
 await check('real_context_retains_tail_note_task_and_case_identity',async()=>{
  complete=await project();const note='人工执行说明：本次为合成环境。'.repeat(40)+'末尾限制：真实收费模型和公网环境均未验证，不得作为已交付依据。';
  const c=await cases(complete,1,note),t=await tasks(complete,1);const context=await documents.getContext(owner.id,complete.id,complete.version);
  assert.equal(context.taskCount,1);assert.equal(context.testCounts.total,1);assert.equal(context.tasks[0].id,t.rows[0].id);assert.equal(context.testCases[0].id,c.rows[0].id);assert.equal(context.testCases[0].revision,1);assert.equal(context.testCases[0].executionNote,note);
  const response=await call('POST',complete.url+'/documents/generate',{type:'test_report'});assert.equal(response.statusCode,201);assert.ok(captured.includes(note));assert.ok(captured.includes('必须保留完整任务依据'));assert.ok(captured.includes(c.rows[0].id));assert.equal(calls,1);
 });
 for(const kind of ['case','task'])await check(`real_51_${kind}_details_are_explicitly_blocked`,async()=>{
  const p=await project();if(kind==='case')await cases(p,51);else await tasks(p,51);
  const context=await documents.getContext(owner.id,p.id,p.version);assert.equal(kind==='case'?context.testCounts.total:context.taskCount,51);assert.equal(kind==='case'?context.testCases.length:context.tasks.length,50);
  const response=await call('POST',p.url+'/documents/generate',{type:'summary'});assert.equal(response.statusCode,413);assert.equal(response.json().error,'document_context_incomplete');assert.equal((await documents.list(owner.id,p.id)).length,0);assert.equal(calls,1);
 });
 await check('real_large_evidence_blocks_before_generation_and_keeps_original_notes',async()=>{
  large=await project();const note='完整合成执行说明，保留全部文字。'.repeat(120);await cases(large,20,note);
  const response=await call('POST',large.url+'/documents/generate',{type:'test_report'});assert.equal(response.statusCode,413);assert.equal(response.json().error,'document_context_too_large');assert.ok(response.json().actualCharacters>30000);assert.equal(calls,1);
  const rows=await pool.query('SELECT execution_note FROM practice_test_cases WHERE project_id=$1',[large.id]);assert.equal(rows.rowCount,20);assert.ok(rows.rows.every(row=>row.execution_note===note));
  const snapshot=await documents.evidence(owner.id,large.id);await documents.create(owner.id,large.id,large.version,'test_report','# 原有人工草稿\n生成失败不能覆盖此文档。','manual-fixture',snapshot);
 });
 await check('foreign_account_cannot_generate_or_read_document_sources',async()=>{
  assert.equal((await call('POST',complete.url+'/documents/generate',{type:'test_report'},foreign)).statusCode,404);
  assert.equal((await call('GET',complete.url+'/documents',undefined,foreign)).statusCode,404);assert.equal(calls,1);
 });
 await check('real_desktop_displays_boundary_and_preserves_document',async()=>{
  const address=await app.listen({host:'127.0.0.1',port:0});const {chromium}=await import('playwright');browser=await chromium.launch({headless:true,channel:process.platform==='win32'?'msedge':undefined});
  const context=await browser.newContext({viewport:{width:1536,height:960},reducedMotion:'reduce'});await context.addInitScript(token=>localStorage.setItem('gongxu_token',token),owner.token);const page=await context.newPage();page.setDefaultTimeout(12000);let errors=0;page.on('pageerror',()=>errors++);
  await page.route('**/*',async route=>{const url=new URL(route.request().url());if(url.origin!=='http://127.0.0.1:5173')return route.abort();if(!url.pathname.startsWith('/api/'))return route.continue();const response=await route.fetch({url:address+url.pathname.slice(4)+url.search,maxRedirects:0});await route.fulfill({response});});
  await page.goto('http://127.0.0.1:5173'+large.url+'/documents');await page.locator('#doc-content').waitFor();const original=await page.locator('#doc-content').inputValue();
  await page.getByRole('button',{name:/生成草稿/}).click();await page.getByRole('alert').filter({hasText:'30000 字符'}).waitFor();assert.equal(await page.locator('#doc-content').inputValue(),original);assert.equal(calls,1);assert.equal(errors,0);
  await page.getByText('资料完整性与生成边界',{exact:true}).click();await page.screenshot({path:fileURLToPath(new URL('document-boundary-desktop.png',directory))});await context.close();
 });
 report.status='passed';
}catch(error){report.status='failed';report.failedStage=stage;report.errorType=error.constructor.name;process.exitCode=1;console.log(`FAIL ${stage} (${error.constructor.name})`);}
finally{
 await browser?.close();for(const identity of [owner,foreign])if(identity)await call('POST','/auth/logout',undefined,identity).catch(()=>{});
 await app.close();await pool.end();globalThis.fetch=send;report.chatFixtureCalls=calls;report.finishedAt=new Date().toISOString();await writeFile(new URL('report.json',directory),JSON.stringify(report,null,2));console.log(`Report: ${fileURLToPath(new URL('report.json',directory))}`);
}
