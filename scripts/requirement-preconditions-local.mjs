import {createRequire} from 'node:module';
import {randomUUID,randomBytes} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {createApp} from '../apps/api/dist/app.js';
import {PgProjectStore} from '../apps/api/dist/project-store.js';
import {loadConfig} from '../apps/api/dist/config.js';

// Real loopback HTTP/DB, exclusively new synthetic accounts. No model, arbitrary
// code execution, real-account reads, configuration output or record deletion.
const require=createRequire(new URL('../apps/api/package.json',import.meta.url));
if(process.argv.slice(2).some(value=>value!=='--browser'))throw Error('Only --browser is supported');
require('dotenv').config({path:fileURLToPath(new URL('../apps/api/.env',import.meta.url))});
const config=loadConfig();
if(!config.DATABASE_URL||!['127.0.0.1','localhost','[::1]'].includes(new URL(config.DATABASE_URL).hostname))throw Error('Existing local database required');
const {Pool}=require('pg');
const pool=new Pool({connectionString:config.DATABASE_URL,connectionTimeoutMillis:3000,statement_timeout:15000,query_timeout:18000});
const app=await createApp({projectStore:new PgProjectStore(pool),pool,database:{query:sql=>pool.query(sql),end:async()=>{}},corsOrigin:'http://127.0.0.1:5173'});
const origin=await app.listen({host:'127.0.0.1',port:0});
const directory=new URL(`../.runtime/requirement-preconditions-local-${randomUUID()}/`,import.meta.url);await mkdir(directory,{recursive:true});
const report={scope:'real_local_database_and_http_new_synthetic_accounts',realModel:false,externalCalls:0,checks:[],startedAt:new Date().toISOString()};
let stage='setup',owner,foreign,project,first,browser;
const nativeFetch=globalThis.fetch;
globalThis.fetch=(input,init)=>{
 const url=new URL(input instanceof Request?input.url:String(input));if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw Error('External request prohibited');
 return nativeFetch(input,{...init,redirect:'error'});
};
async function call(method,path,payload,identity=owner){
 const response=await fetch(new URL(path,origin),{method,headers:{...(identity?{authorization:'Bearer '+identity.token}:{}),...(payload===undefined?{}:{'content-type':'application/json'})},body:payload===undefined?undefined:JSON.stringify(payload),signal:AbortSignal.timeout(15000)});
 return {status:response.status,body:await response.json()};
}
async function check(name,run){stage=name;await run();report.checks.push({name,status:'passed'});console.log(`PASS ${name}`);}
async function createDraft(text){const r=await call('POST',`/projects/${project}/requirements`,{content:text});assert.equal(r.status,201);return r.body.requirement;}
const read=async()=>{const r=await call('GET',`/projects/${project}`);assert.equal(r.status,200);return r.body.requirements;};
const url=id=>`/projects/${project}/requirements/${id}`;
try{
 for(const other of [false,true]){
  const r=await call('POST','/auth/register',{name:'需求原文核对 · 合成',email:`snapshot-${randomUUID()}@example.test`,password:randomBytes(24).toString('base64url')},null);assert.equal(r.status,201);
  if(other)foreign=r.body;else owner=r.body;
 }
 const p=await call('POST','/projects',{name:'需求确认并发 · 合成',description:'独立本机回归，不是真实学生数据'});assert.equal(p.status,201);project=p.body.project.id;
 first=await createDraft('最初已阅读的审批条件');
 await check('missing_snapshot_rejected_without_modifying_or_confirming',async()=>{
  assert.equal((await call('POST',url(first.id)+'/confirm')).status,428);
  assert.equal((await call('PATCH',url(first.id),{content:'未经原文核对的更新'})).status,428);
  const saved=(await read())[0];assert.equal(saved.content,first.content);assert.equal(saved.status,'draft');
 });
 await check('concurrent_edits_have_one_winner_and_old_content_cannot_be_confirmed',async()=>{
  const results=await Promise.all(['新条件A：保留审批记录','新条件B：保留操作时间'].map(content=>call('PATCH',url(first.id),{content,expectedContent:first.content})));
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  const saved=(await read())[0],accepted=results.find(r=>r.status===200).body.requirement;
  assert.equal(saved.content,accepted.content);assert.equal(saved.status,'draft');
  const stale=await call('POST',url(first.id)+'/confirm',{expectedContent:first.content});assert.equal(stale.status,409);assert.equal(stale.body.error,'requirement_content_changed');
  const noop=await call('PATCH',url(first.id),{content:saved.content,expectedContent:saved.content});assert.equal(noop.status,200);assert.equal(noop.body.requirement.id,first.id);assert.equal(noop.body.requirement.createdAt,first.createdAt);
 });
 await check('confirmation_only_accepts_latest_reviewed_draft_and_confirmed_content_is_immutable',async()=>{
  const old=(await read())[0],next=await createDraft('后续版本：需要第二人复核');
  const late=await call('POST',url(old.id)+'/confirm',{expectedContent:old.content});assert.equal(late.status,409);assert.equal(late.body.error,'requirement_newer_draft_exists');
  const accepted=await call('POST',url(next.id)+'/confirm',{expectedContent:next.content});assert.equal(accepted.status,200);assert.equal(accepted.body.requirement.status,'confirmed');
  assert.equal((await call('POST',url(next.id)+'/confirm',{expectedContent:next.content})).status,404);
  assert.equal((await call('PATCH',url(next.id),{content:'不能覆盖已确认原文',expectedContent:next.content})).status,404);
  const rows=await read();assert.equal(rows[0].content,next.content);assert.equal(rows[1].status,'draft');
 });
 await check('competing_confirmation_and_edit_never_confirm_unreviewed_content',async()=>{
  const draft=await createDraft('竞争前已阅读原文'),changed='另一窗口的新条件';
  const [confirm,edit]=await Promise.all([call('POST',url(draft.id)+'/confirm',{expectedContent:draft.content}),call('PATCH',url(draft.id),{content:changed,expectedContent:draft.content})]);
  const saved=(await read())[0];
  if(confirm.status===200){assert.equal(edit.status,404);assert.equal(saved.content,draft.content);assert.equal(saved.status,'confirmed');}
  else{assert.equal(confirm.status,409);assert.equal(edit.status,200);assert.equal(saved.content,changed);assert.equal(saved.status,'draft');}
 });
 await check('foreign_account_cannot_edit_confirm_or_read_the_owned_snapshot',async()=>{
  const draft=await createDraft('账号隔离条件');
  for(const [method,path,payload] of [['PATCH',url(draft.id),{content:'外账号尝试',expectedContent:draft.content}],['POST',url(draft.id)+'/confirm',{expectedContent:draft.content}],['GET',`/projects/${project}`,undefined]]){
   const r=await call(method,path,payload,foreign);assert.equal(r.status,404);assert.ok(!JSON.stringify(r.body).includes(draft.content));
  }
  assert.equal((await read())[0].content,draft.content);
 });
 if(process.argv.includes('--browser')){
  const {chromium}=await import('playwright');browser=await chromium.launch({headless:true,channel:process.platform==='win32'?'msedge':undefined,timeout:30000});
  const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),web=new URL('http://127.0.0.1:5173');
  await context.addInitScript(value=>localStorage.setItem('gongxu_token',value),owner.token);
  let failDraftSave=false,confirmPosts=0,pageErrors=0,traceFailures=0;
  await context.route('**/*',async route=>{
   const request=route.request(),target=new URL(request.url());if(target.origin!==web.origin)return route.abort();
   if(target.pathname.startsWith('/api/')){
    if(request.method()==='POST'&&target.pathname.endsWith('/confirm'))confirmPosts++;
    if(failDraftSave&&request.method()==='POST'&&target.pathname.endsWith('/requirements'))return route.fulfill({status:503,json:{error:'database_unavailable'}});
    return route.fulfill({response:await route.fetch({url:new URL(target.pathname.slice(4)+target.search,origin).href,maxRedirects:0,timeout:15000})});
   }
   return route.continue();
  });
  const page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',()=>pageErrors++);
  page.on('response',response=>{if(new URL(response.url()).pathname.endsWith('/trace')&&response.status()>=400)traceFailures++;});
  const seen='已在页面阅读的验收条件',changed='另一窗口保存的新验收条件',draft=await createDraft(seen);
  await check('real_browser_refuses_confirmation_of_text_changed_after_read',async()=>{
   await page.goto(new URL(`/projects/${project}/requirements`,web).href);await page.waitForFunction(text=>document.querySelector('#requirement')?.value===text,seen);
   assert.equal((await call('PATCH',url(draft.id),{content:changed,expectedContent:seen})).status,200);
   await page.getByRole('button',{name:/确认最新版本/}).click();await page.locator('.alert.error').filter({hasText:'原文已在另一处更新'}).waitFor();
   assert.equal(await page.locator('#requirement').inputValue(),seen);assert.ok(await page.getByRole('button',{name:/确认最新版本/}).isDisabled());
   const saved=(await read())[0];assert.equal(saved.status,'draft');assert.equal(saved.content,changed);
   await page.getByRole('group',{name:'当前版本追踪统计',exact:true}).waitFor();assert.equal(traceFailures,0);assert.equal(await page.locator('.trace-panel .alert.error').count(),0);
   await page.screenshot({path:fileURLToPath(new URL('requirement-conflict.png',directory)),fullPage:true});
  });
  await check('browser_refresh_cancellation_and_injected_save_failure_preserve_edits',async()=>{
   const typed=seen+'\n本地未保存的合并说明';await page.locator('#requirement').fill(typed);
   const refresh=page.getByRole('button',{name:'重新读取需求',exact:true}),guard=page.getByRole('dialog',{name:'保留未保存的编辑'});
   await refresh.click();await guard.getByRole('button',{name:'留在此页'}).click();assert.equal(await page.locator('#requirement').inputValue(),typed);
   const before=(await read()).length;failDraftSave=true;await refresh.click();await guard.getByRole('button',{name:'保存并继续'}).click();await guard.getByText(/保存未成功/).waitFor();
   assert.equal(await page.locator('#requirement').inputValue(),typed);assert.equal((await read()).length,before);
   await guard.getByRole('button',{name:'留在此页'}).click();failDraftSave=false;
   await refresh.click();await guard.getByRole('button',{name:'放弃并继续'}).click();await page.waitForFunction(text=>document.querySelector('#requirement')?.value===text,changed);
   const requests=confirmPosts;await page.getByRole('button',{name:/确认最新版本/}).evaluate(el=>{el.click();el.click();});await page.locator('.alert.success').filter({hasText:'需求版本已确认'}).waitFor();
   assert.equal(confirmPosts,requests+1);const saved=(await read())[0];assert.equal(saved.content,changed);assert.equal(saved.status,'confirmed');assert.equal(pageErrors,0);
   await page.getByRole('group',{name:'当前版本追踪统计',exact:true}).waitFor();assert.equal(traceFailures,0);assert.equal(await page.locator('.trace-panel .alert.error').count(),0);
   await page.screenshot({path:fileURLToPath(new URL('requirement-recovered.png',directory)),fullPage:true});
  });
  report.browser='Chromium Edge; two synthetic account HTTP actions; only save failure is injected';
 }
 report.status='passed';
}catch(error){report.status='failed';report.failedStage=stage;report.errorType=error.code??error.constructor.name;console.error(`FAILED ${stage} (${report.errorType})`);process.exitCode=1;}
finally{await browser?.close();await app.close();await pool.end();report.finishedAt=new Date().toISOString();await writeFile(new URL('report.json',directory),JSON.stringify(report,null,2));console.log(`Report: ${directory.pathname}`);}
