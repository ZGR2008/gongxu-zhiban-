import {createRequire} from 'node:module';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {loadConfig} from '../apps/api/dist/config.js';
import {PgProjectStore} from '../apps/api/dist/project-store.js';
import {registerProjectRoutes} from '../apps/api/dist/project-routes.js';
import {registerPracticeRoutes} from '../apps/api/dist/practice/routes.js';
import {registerAgentRoutes} from '../apps/api/dist/agent/routes.js';
import {PgDocumentStore} from '../apps/api/dist/documents/store.js';
import {registerDocumentRoutes} from '../apps/api/dist/documents/routes.js';
const require=createRequire(new URL('../apps/api/package.json',import.meta.url));
require('dotenv').config({path:fileURLToPath(new URL('../apps/api/.env',import.meta.url))});
const config=loadConfig(),local=value=>['127.0.0.1','localhost','[::1]'].includes(new URL(value).hostname);
if(!config.DATABASE_URL||!local(config.DATABASE_URL))throw Error('Existing local database required');
const originalFetch=globalThis.fetch;globalThis.fetch=(input,init)=>{if(!local(input instanceof Request?input.url:String(input)))throw Error('External request prohibited');return originalFetch(input,{...init,redirect:'error'});};
const {Pool}=require('pg'),Fastify=require('fastify');
const pool=new Pool({connectionString:config.DATABASE_URL,connectionTimeoutMillis:3000,statement_timeout:15000,query_timeout:18000});
const store=new PgProjectStore(pool),app=Fastify({logger:false});
await registerProjectRoutes(app,store);await registerPracticeRoutes(app,store,pool);await registerDocumentRoutes(app,store,new PgDocumentStore(pool));await registerAgentRoutes(app,store,pool);
app.get('/health',async()=>({status:'ok',service:'gongxu-api'}));app.get('/ready',async()=>({status:'ready'}));app.get('/ai/status',async()=>({configured:false}));
// Genuine database routes are used; no chat provider is configured.
const directory=new URL(`../.runtime/document-list-local-${randomUUID()}/`,import.meta.url);await mkdir(directory,{recursive:true});
const report={scope:'real_local_database_http_browser_document_catalogue',realModel:false,REVIEW_PLACEHOLDER_575a8dfc08a84f40bc3bRecords:true,startedAt:new Date().toISOString(),checks:[]};
let owner,foreign,browser,page,stage='setup',projectId,version,oldVersion,first,last;
const call=(method,url,payload,identity=owner)=>app.inject({method,url,headers:{authorization:`Bearer ${identity.token}`},...(payload===undefined?{}:{payload})});
async function check(name,run){stage=name;await run();report.checks.push({name,status:'passed'});console.log(`PASS ${name}`);}
const endpoint=()=>`/projects/${projectId}/documents`;
async function makeVersion(content){const r=await call('POST',`/projects/${projectId}/requirements`,{content});assert.equal(r.statusCode,201);const id=r.json().requirement.id;assert.equal((await call('POST',`/projects/${projectId}/requirements/${id}/confirm`,{expectedContent:r.json().requirement.content})).statusCode,200);return id;}
try{
 for(const other of [false,true]){const r=await app.inject({method:'POST',url:'/auth/register',payload:{name:'文档目录验证 · 合成',email:`doc-list-${randomUUID()}@example.test`,password:randomBytes(24).toString('base64url')}});assert.equal(r.statusCode,201);const d=r.json(),identity={id:d.user.id,token:d.token};if(other)foreign=identity;else owner=identity;}
 const p=await call('POST','/projects',{name:'完整文档目录 · 合成验证',description:'独立合成数据，仅验证目录、修订和版本来源。'});assert.equal(p.statusCode,201);projectId=p.json().project.id;
 oldVersion=await makeVersion('历史设计文档不能计入当前文档准备。');version=await makeVersion('较早API文档须可访问；最近100份README不能掩盖目录中的其他类型。');
 await pool.query(`INSERT INTO project_documents(project_id,requirement_version_id,type,content,model_name,created_at)
  SELECT $1,$2,'readme','合成README正文 '||n,'controlled-fixture','2026-11-01T00:00:00.123456Z'::timestamptz FROM generate_series(1,100) n`,[projectId,version]);
 await pool.query(`INSERT INTO project_documents(project_id,requirement_version_id,type,content,model_name,created_at) VALUES($1,$2,'design','旧版设计合成正文','controlled-fixture','2026-10-31T00:00:00.123456Z')`,[projectId,oldVersion]);
 last=(await pool.query(`INSERT INTO project_documents(project_id,requirement_version_id,type,content,model_name,created_at) VALUES($1,$2,'api','最早API正文，尾部接口条件必须保留。','controlled-fixture','2026-10-30T00:00:00.123456Z') RETURNING id`,[projectId,version])).rows[0].id;
 await check('complete_summary_includes_hidden_current_type_without_bodies_or_old_version',async()=>{
  const legacy=(await call('GET',endpoint())).json();assert.equal(legacy.documents.length,100);assert.equal(legacy.summaryComplete,false);assert.equal(legacy.mayBeTruncated,true);assert.ok(legacy.documents.every(d=>d.type==='readme'));
  const r=await call('GET',endpoint()+'?summaryOnly=true');assert.equal(r.statusCode,200);const data=r.json();assert.equal(data.summaryComplete,true);assert.equal(data.evidence.requirementVersionId,version);assert.equal(data.page.total,102);assert.deepEqual(data.documents.map(d=>d.type).sort(),['api','readme']);assert.ok(data.documents.every(d=>!('content'in d)&&d.requirementVersionId===version));
 });
 await check('six_bounded_pages_preserve_equal_microsecond_timestamps_and_oldest_body',async()=>{
  const r=await call('GET',endpoint()+'?limit=20');assert.equal(r.statusCode,200);first=r.json();assert.equal(first.page.total,102);assert.equal(first.documents.length,20);
  let data=first,ids=[],count=0;do{count++;ids.push(...data.documents.map(d=>d.id));if(!data.page.nextCursor)break;const next=await call('GET',endpoint()+'?limit=20&cursor='+encodeURIComponent(data.page.nextCursor));assert.equal(next.statusCode,200);data=next.json();}while(count<8);
  assert.equal(count,6);assert.equal(ids.length,102);assert.equal(new Set(ids).size,102);assert.equal(ids.at(-1),last);assert.equal(data.documents.at(-1).content,'最早API正文，尾部接口条件必须保留。');
  const exported=await call('GET',endpoint()+`/${last}/export`);assert.equal(exported.statusCode,200);assert.equal(exported.body,'最早API正文，尾部接口条件必须保留。');
 });
 await check('foreign_and_tampered_cursors_are_rejected_without_disclosing_documents',async()=>{
  for(const suffix of ['?summaryOnly=true','?limit=20&cursor='+first.page.nextCursor,`/${last}/export`])assert.equal((await call('GET',endpoint()+suffix,undefined,foreign)).statusCode,404);
  for(const suffix of ['?limit=51','?cursor=broken','?summaryOnly=true&cursor='+first.page.nextCursor])assert.equal((await call('GET',endpoint()+suffix)).statusCode,400);
  const cursor=JSON.parse(Buffer.from(first.page.nextCursor,'base64url'));cursor.projectId=randomUUID();assert.equal((await call('GET',endpoint()+'?cursor='+Buffer.from(JSON.stringify(cursor)).toString('base64url'))).statusCode,400);
  cursor.projectId=projectId;cursor.afterId=randomUUID();assert.equal((await call('GET',endpoint()+'?cursor='+Buffer.from(JSON.stringify(cursor)).toString('base64url'))).statusCode,409);
 });
 await check('editing_invalidates_catalogue_cursor_and_keeps_revision_history_and_export',async()=>{
  const r=await call('PATCH',endpoint()+`/${last}`,{content:'人工修订合成API，尾部条件仍保留。',expectedRevision:1});assert.equal(r.statusCode,200);assert.equal(r.json().document.revision,2);
  const stale=await call('GET',endpoint()+'?cursor='+first.page.nextCursor);assert.equal(stale.statusCode,409);assert.equal(stale.json().error,'document_list_changed');
  const history=(await call('GET',endpoint()+`/${last}/history`)).json();assert.ok(history.history.some(row=>row.revision===1&&row.content==='最早API正文，尾部接口条件必须保留。'));
  assert.equal((await call('GET',endpoint()+`/${last}/export`)).body,'人工修订合成API，尾部条件仍保留。');
 });
 await check('desktop_opens_oldest_document_and_overview_delivery_use_complete_type_summary',async()=>{
  const address=await app.listen({host:'127.0.0.1',port:0}),{chromium}=await import('playwright');browser=await chromium.launch({channel:'msedge',headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:950},reducedMotion:'reduce'});await context.addInitScript(token=>localStorage.setItem('gongxu_token',token),owner.token);page=await context.newPage();page.setDefaultTimeout(10000);let errors=0;page.on('pageerror',()=>errors++);
  await page.route('**/*',async route=>{const url=new URL(route.request().url());if(!local(url.href))return route.abort();if(!url.pathname.startsWith('/api/'))return route.continue();const response=await route.fetch({url:address+url.pathname.slice(4)+url.search,maxRedirects:0});await route.fulfill({response});});
  report.browserStep='catalogue';await page.goto(`http://127.0.0.1:5173/projects/${projectId}/documents`);await page.getByText('读取时共 102 份 · 第 1 页 · 本页 20 份',{exact:true}).waitFor();
  for(let i=2;i<=6;i++){await page.getByRole('button',{name:'下一页文档',exact:true}).click();await page.getByText(`读取时共 102 份 · 第 ${i} 页 · 本页 ${i===6?2:20} 份`,{exact:true}).waitFor();}
  await page.getByRole('button',{name:/API 说明文档/}).click();assert.equal(await page.locator('#doc-content').inputValue(),'人工修订合成API，尾部条件仍保留。');await page.screenshot({path:fileURLToPath(new URL('documents-last-page.png',directory))});
  report.browserStep='overview';await page.goto(`http://127.0.0.1:5173/projects/${projectId}`);await page.waitForFunction(()=>document.querySelector('.pulse-stats > div:nth-child(4) strong')?.textContent.replace(/\s/g,'')==='2/6');
  assert.match(await page.locator('.pulse-document-list li').filter({hasText:'API 说明'}).innerText(),/已保存/);assert.match(await page.locator('.pulse-document-list li').filter({hasText:'软件设计'}).innerText(),/待补充/);await page.screenshot({path:fileURLToPath(new URL('overview-complete-document-types.png',directory))});
  report.browserStep='delivery';await page.goto('http://127.0.0.1:5173/delivery');await page.getByText(/2 类当前需求文档已保存（完整目录，各类最新一份）/).waitFor();assert.equal(errors,0);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);await context.close();page=null;
 });
 await check('new_confirmed_requirement_has_no_inherited_documents_while_history_remains_accessible',async()=>{
  const next=await makeVersion('新版尚无文档，不继承旧版准备状态。');const current=(await call('GET',endpoint()+'?summaryOnly=true')).json();assert.equal(current.evidence.requirementVersionId,next);assert.deepEqual(current.documents,[]);assert.equal(current.page.total,102);
  const retained=(await call('GET',endpoint()+`/${last}`)).json();assert.equal(retained.document.requirementVersionId,version);assert.equal(retained.document.revision,2);
 });
 report.status='passed';
}catch(error){report.status='failed';report.failedStage=stage;report.errorType=error.constructor.name;if(page){await page.screenshot({path:fileURLToPath(new URL('failure.png',directory))}).catch(()=>{});report.browserUrlPath=new URL(page.url()).pathname;}console.log(`FAIL ${stage} ${report.browserStep??''} (${error.constructor.name})`);process.exitCode=1;}
finally{await browser?.close();for(const identity of [owner,foreign])if(identity)await call('POST','/auth/logout',undefined,identity).catch(()=>{});await app.close();await pool.end();report.finishedAt=new Date().toISOString();await writeFile(new URL('report.json',directory),JSON.stringify(report,null,2));console.log(`Report: ${fileURLToPath(new URL('report.json',directory))}`);}
