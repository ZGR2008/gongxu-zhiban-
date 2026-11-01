import {createRequire} from 'node:module';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {loadConfig} from '../apps/api/dist/config.js';
import {PgProjectStore} from '../apps/api/dist/project-store.js';
import {registerProjectRoutes} from '../apps/api/dist/project-routes.js';
import {registerPracticeRoutes} from '../apps/api/dist/practice/routes.js';
import {registerGrowthRoutes} from '../apps/api/dist/growth/routes.js';
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
await registerProjectRoutes(app,store);await registerPracticeRoutes(app,store,pool);await registerGrowthRoutes(app,store,pool);await registerDocumentRoutes(app,store,new PgDocumentStore(pool));await registerAgentRoutes(app,store,pool);
app.get('/health',async()=>({status:'ok',service:'gongxu-api'}));app.get('/ready',async()=>({status:'ready'}));app.get('/ai/status',async()=>({configured:false}));
// Genuine database routes are used; no chat provider is configured.
const directory=new URL(`../.runtime/test-list-local-${randomUUID()}/`,import.meta.url);await mkdir(directory,{recursive:true});
const report={scope:'real_local_database_http_browser_test_pagination',realModel:false,syntheticRecords:true,startedAt:new Date().toISOString(),checks:[]};
let owner,foreign,browser,browserPage,stage='setup',projectId,version,oldVersion,first;
const call=(method,url,payload,identity=owner)=>app.inject({method,url,headers:{authorization:`Bearer ${identity.token}`},...(payload===undefined?{}:{payload})});
async function check(name,run){stage=name;await run();report.checks.push({name,status:'passed'});console.log(`PASS ${name}`);}
const endpoint=()=>`/projects/${projectId}/test-cases`;
async function makeVersion(content){const r=await call('POST',`/projects/${projectId}/requirements`,{content});assert.equal(r.statusCode,201);const id=r.json().requirement.id;assert.equal((await call('POST',`/projects/${projectId}/requirements/${id}/confirm`,{expectedContent:r.json().requirement.content})).statusCode,200);return id;}
try{
 for(const other of [false,true]){
  const r=await app.inject({method:'POST',url:'/auth/register',payload:{name:'分页验证 · 合成',email:`test-list-${randomUUID()}@example.test`,password:randomBytes(24).toString('base64url')}});assert.equal(r.statusCode,201);const d=r.json();const identity={id:d.user.id,token:d.token};if(other)foreign=identity;else owner=identity;
 }
 const p=await call('POST','/projects',{name:'完整测试统计 · 合成验证',description:'只用于本地分页与来源一致性，不是真实学生数据'});assert.equal(p.statusCode,201);projectId=p.json().project.id;
 oldVersion=await makeVersion('旧需求的通过记录不能计入新版。');version=await makeVersion('当前版本必须呈现200条较新通过之后的失败记录；同一时刻记录不可遗漏。');
 await pool.query(`INSERT INTO practice_test_cases(project_id,requirement_version_id,category,title,preconditions,steps,expected,model_name,result,execution_note,executed_at,created_at)
  SELECT $1,$2,'normal','合成较新用例 '||n,'合成独立账号','人工核对','保留真实来源','controlled-fixture','passed','仅合成通过状态，不是真实产品测试证据',now(),'2026-11-01T00:00:00.123456Z'::timestamptz FROM generate_series(1,200) n`,[projectId,version]);
 const last=(await pool.query(`INSERT INTO practice_test_cases(project_id,requirement_version_id,category,title,preconditions,steps,expected,model_name,result,execution_note,executed_at,created_at)
  VALUES($1,$2,'exception','末页合成失败','合成独立账号','人工核对末尾失败','完整统计不能隐藏失败','controlled-fixture','failed','明确的合成失败记录',now(),'2026-10-31T00:00:00.123456Z') RETURNING id`,[projectId,version])).rows[0].id;
 await pool.query(`INSERT INTO practice_test_cases(project_id,requirement_version_id,category,title,preconditions,steps,expected,model_name,result,execution_note,executed_at) VALUES($1,$2,'normal','旧版合成通过','','人工核对','不得计入当前','controlled-fixture','passed','旧需求合成记录',now())`,[projectId,oldVersion]);
 await check('first_page_reports_all_201_cases_including_the_older_failure',async()=>{
  const r=await call('GET',endpoint());assert.equal(r.statusCode,200);first=r.json();assert.equal(first.cases.length,50);assert.equal(first.summary.total,201);assert.equal(first.summary.failed,1);assert.equal(first.summary.passed,200);assert.ok(first.cases.every(c=>c.result==='passed'));assert.ok(first.page.nextCursor);
 });
 await check('five_keyset_pages_preserve_microseconds_and_equal_timestamps_without_gaps',async()=>{
  let page=first,ids=[],pages=0;do{pages++;ids.push(...page.cases.map(c=>c.id));if(!page.page.nextCursor)break;const r=await call('GET',endpoint()+'?cursor='+encodeURIComponent(page.page.nextCursor));assert.equal(r.statusCode,200);page=r.json();assert.equal(page.summary.caseRevision,first.summary.caseRevision);}while(pages<8);
  assert.equal(pages,5);assert.equal(ids.length,201);assert.equal(new Set(ids).size,201);assert.equal(ids.at(-1),last);
 });
 await check('summary_history_growth_and_foreign_isolation_agree',async()=>{
  const summary=(await call('GET',endpoint()+'?summaryOnly=true')).json();assert.deepEqual(summary.cases,[]);assert.equal(summary.summary.total,201);assert.equal(summary.summary.failed,1);
  const old=(await call('GET',endpoint()+'?requirementVersionId='+oldVersion)).json();assert.equal(old.summary.total,1);assert.equal(old.summary.failed,0);assert.ok(old.cases.every(c=>c.requirementVersionId===oldVersion));
  const growth=(await call('GET','/growth')).json();assert.equal(growth.counts.testCases,201);assert.equal(growth.counts.testExecutions.failed,1);assert.equal((await call('GET','/growth?scope=history')).json().counts.testCases,202);
  assert.equal((await call('GET',endpoint(),undefined,foreign)).statusCode,404);assert.equal((await call('GET',endpoint()+'?cursor='+encodeURIComponent(first.page.nextCursor),undefined,foreign)).statusCode,404);assert.equal((await call('GET',endpoint()+'?requirementVersionId='+randomUUID())).statusCode,404);
  const changed=JSON.parse(Buffer.from(first.page.nextCursor,'base64url'));changed.projectId=randomUUID();assert.equal((await call('GET',endpoint()+'?cursor='+Buffer.from(JSON.stringify(changed)).toString('base64url'))).statusCode,400);
 });
 await check('editing_increments_revision_invalidates_old_cursor_and_preserves_history',async()=>{
  const c=first.cases[0],r=await call('PATCH',endpoint()+`/${c.id}/execution`,{result:'blocked',note:'新的合成阻塞记录',expectedRevision:c.revision});assert.equal(r.statusCode,200);
  const stale=await call('GET',endpoint()+'?cursor='+encodeURIComponent(first.page.nextCursor));assert.equal(stale.statusCode,409);assert.equal(stale.json().error,'test_list_changed');
  const fresh=(await call('GET',endpoint())).json();assert.equal(fresh.summary.blocked,1);assert.equal(fresh.summary.failed,1);assert.equal(fresh.summary.passed,199);assert.ok(fresh.summary.caseRevision>first.summary.caseRevision);
  assert.ok((await call('GET',endpoint()+`/${c.id}/history`)).json().history.length>=1);
 });
 await check('desktop_test_overview_delivery_and_historical_view_show_full_totals',async()=>{
  const address=await app.listen({host:'127.0.0.1',port:0}),{chromium}=await import('playwright');browser=await chromium.launch({channel:'msedge',headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:950},reducedMotion:'reduce'});await context.addInitScript(token=>localStorage.setItem('gongxu_token',token),owner.token);const page=await context.newPage();browserPage=page;page.setDefaultTimeout(10000);let errors=0;page.on('pageerror',()=>errors++);
  await page.route('**/*',async route=>{const url=new URL(route.request().url());if(!local(url.href))return route.abort();if(!url.pathname.startsWith('/api/'))return route.continue();const response=await route.fetch({url:address+url.pathname.slice(4)+url.search,maxRedirects:0});await route.fulfill({response});});
  report.browserStep='tests_first';await page.goto(`http://127.0.0.1:5173/projects/${projectId}/tests`);await page.getByText('完整版本共 201 条 · 第 1 页 · 本页 50 条',{exact:true}).waitFor();assert.equal(await page.locator('.case-item').count(),50);assert.ok((await page.locator('.test-summary').innerText()).includes('201'));
  for(let i=2;i<=5;i++){report.browserStep=`tests_page_${i}`;await page.getByRole('button',{name:'下一页用例',exact:true}).click();await page.getByText(`完整版本共 201 条 · 第 ${i} 页 · 本页 ${i===5?1:50} 条`,{exact:true}).waitFor();}
  await page.getByText('末页合成失败',{exact:true}).first().waitFor();await page.screenshot({path:fileURLToPath(new URL('tests-last-page.png',directory))});
  report.browserStep='history';await page.getByLabel('测试来源需求版本').selectOption(oldVersion);await page.getByText('完整版本共 1 条 · 第 1 页 · 本页 1 条',{exact:true}).waitFor();assert.ok((await page.locator('.test-summary').innerText()).includes('人工记录通过'));
  report.browserStep='overview';await page.goto(`http://127.0.0.1:5173/projects/${projectId}`);await page.getByText(/完整版本统计 · 人工登记/).waitFor();assert.match(await page.locator('.pulse-stats').innerText(),/201/);assert.match(await page.locator('.pulse-stats').innerText(),/失败或阻塞 2 条/);
  report.browserStep='delivery';await page.goto('http://127.0.0.1:5173/delivery');await page.getByText('201 条当前需求用例（完整版本统计），201 条人工登记结果，2 条失败或阻塞',{exact:true}).waitFor();assert.equal(errors,0);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);await page.screenshot({path:fileURLToPath(new URL('delivery-full-counts.png',directory))});await context.close();browserPage=null;
 });
 await check('confirming_a_new_requirement_rejects_default_cursor_but_keeps_explicit_history',async()=>{
  const page=(await call('GET',endpoint())).json();const next=await makeVersion('新需求没有自动继承旧版通过。');
  const r=await call('GET',endpoint()+'?cursor='+encodeURIComponent(page.page.nextCursor));assert.equal(r.statusCode,409);assert.equal(r.json().error,'test_list_changed');
  const current=(await call('GET',endpoint())).json();assert.equal(current.summary.requirementVersionId,next);assert.equal(current.summary.total,0);assert.deepEqual(current.cases,[]);
  assert.equal((await call('GET',endpoint()+`?requirementVersionId=${version}&cursor=${encodeURIComponent(page.page.nextCursor)}`)).statusCode,200);
 });
 report.status='passed';
}catch(error){report.status='failed';report.failedStage=stage;report.errorType=error.constructor.name;if(browserPage){await browserPage.screenshot({path:fileURLToPath(new URL('failure.png',directory))}).catch(()=>{});report.browserUrlPath=new URL(browserPage.url()).pathname;}console.log(`FAIL ${stage} ${report.browserStep??''} (${error.constructor.name})`);process.exitCode=1;}
finally{await browser?.close();for(const identity of [owner,foreign])if(identity)await call('POST','/auth/logout',undefined,identity).catch(()=>{});await app.close();await pool.end();report.finishedAt=new Date().toISOString();await writeFile(new URL('report.json',directory),JSON.stringify(report,null,2));console.log(`Report: ${fileURLToPath(new URL('report.json',directory))}`);}
