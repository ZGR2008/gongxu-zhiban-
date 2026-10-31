import {createRequire} from 'node:module';
import {randomUUID,randomBytes} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {PgProjectStore} from '../apps/api/dist/project-store.js';
import {registerProjectRoutes} from '../apps/api/dist/project-routes.js';
import {registerPracticeRoutes} from '../apps/api/dist/practice/routes.js';
import {loadConfig} from '../apps/api/dist/config.js';
import {loadEmbeddingConfig,saveText,indexDocument} from '../apps/api/dist/rag/service.js';
import {listEmbeddingActivities} from '../apps/api/dist/rag/activity.js';

// Existing config is used by the program, never printed, copied or reported.
// Every record belongs to newly generated synthetic accounts. No cleanup deletes.
const require=createRequire(new URL('../apps/api/package.json',import.meta.url));require('dotenv').config();
const local=value=>['127.0.0.1','localhost','[::1]'].includes(new URL(value).hostname);
const settings=loadConfig(),embedding=loadEmbeddingConfig();
if(!settings.DATABASE_URL||!local(settings.DATABASE_URL)||!embedding||!local(embedding.baseUrl))throw Error('This check requires the existing local DB and local embedding service');
const send=globalThis.fetch;globalThis.fetch=(input,init)=>{if(!local(input instanceof Request?input.url:String(input)))throw Error('External requests are prohibited');return send(input,init);};
const {Pool}=require('pg'),Fastify=require('fastify');const pool=new Pool({connectionString:settings.DATABASE_URL,connectionTimeoutMillis:3000});
const store=new PgProjectStore(pool),app=Fastify({logger:false});
const output=new URL(`../.runtime/review-context-local-${randomUUID()}/`,import.meta.url);await mkdir(output,{recursive:true});
const report={scope:'real_local_database_embedding_http_browser_with_chat_fixture',realModel:false,syntheticRecords:true,checks:[],startedAt:new Date().toISOString()};
let stage='setup',owner,foreign,root,version,modelCalls=0,modelHook=null,captured,browser,releaseModel,abortTransport;
const ai={baseUrl:'https://example.invalid',apiKey:'fixture-only',model:'controlled-fixture',timeoutMs:1000};
await registerProjectRoutes(app,store);
await registerPracticeRoutes(app,store,pool,ai,{embedding,complete:async(_config,messages)=>{modelCalls++;captured=JSON.parse(messages[1].content);if(modelHook)await modelHook();return '合成审查建议：请人工核对审批边界；未执行代码。';}});
app.get('/health',async()=>({status:'ok',service:'gongxu-api'}));app.get('/ready',async()=>({status:'ready'}));app.get('/ai/status',async()=>({configured:false}));
app.get('/knowledge/activity',async()=>({activities:owner?listEmbeddingActivities(owner.id):[]}));
const call=(method,path,payload,identity=owner)=>app.inject({method,url:path,headers:{authorization:`Bearer ${identity.token}`},...(payload===undefined?{}:{payload})});
async function check(name,work){stage=name;const start=Date.now();await work();report.checks.push({name,status:'passed',durationMs:Date.now()-start});console.log(`PASS ${name}`);}
async function enteredWithin(promise){let timer;try{await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Controlled model stage was not reached within 15 seconds')),15000);})]);}finally{clearTimeout(timer);}}
const requirement=('审批系统必须核对当前用户身份，失败必须回滚并保留原因。普通学生不能批准自己的申请，管理员操作必须留存记录。\n').repeat(80)+'末尾验收：库存不足时不能批准，不得扣减库存。';
try{
 for(const isForeign of [false,true]){
  const response=await app.inject({method:'POST',url:'/auth/register',payload:{name:'审查来源验证 · 合成',email:`review-context-${randomUUID()}@example.test`,password:randomBytes(24).toString('base64url')}});assert.equal(response.statusCode,201);const data=response.json();const account={id:data.user.id,token:data.token};if(isForeign)foreign=account;else owner=account;
 }
 const created=await call('POST','/projects',{name:'审查上下文 · 合成回归',description:'本地真实DB和向量，聊天明确替身，不代表学生数据'});assert.equal(created.statusCode,201);const project=created.json().project.id;root=`/projects/${project}`;
 const first=await call('POST',`${root}/requirements`,{content:requirement});version=first.json().requirement.id;assert.equal((await call('POST',`${root}/requirements/${version}/confirm`)).statusCode,200);
 let firstReview;
 await check('real_review_context_uses_owned_vectors_full_requirement_and_persists_source',async()=>{
  const ownDoc=await saveText(pool,owner.id,'审批规则 · 合成来源',requirement),foreignDoc=await saveText(pool,foreign.id,'不得跨账号使用 · 合成来源',requirement);
  await indexDocument(pool,owner.id,ownDoc.id,embedding);await indexDocument(pool,foreign.id,foreignDoc.id,embedding);
  const response=await call('POST',`${root}/code-reviews`,{language:'typescript',code:'globalThis.__untrustedExecution = true;',context:'project',requirementId:version});assert.equal(response.statusCode,201);
  firstReview=response.json().review;const context=firstReview.reviewContext;
  assert.equal(firstReview.requirementVersionId,version);assert.equal(context.requirement.content,requirement);assert.equal(context.retrieval.status,'retrieved');assert.equal(context.retrieval.segments.at(-1).end,requirement.length);
  assert.ok(context.retrieval.sources.some(row=>row.documentId===ownDoc.id));assert.ok(context.retrieval.sources.every(row=>row.documentId!==foreignDoc.id));assert.equal(globalThis.__untrustedExecution,undefined);
  assert.equal(captured.context.requirement.content,requirement);assert.equal(captured.context.retrieval.sources.length,context.retrieval.sources.length);
  const read=await call('GET',`${root}/code-reviews`);assert.deepEqual(read.json().reviews[0].reviewContext,context);
 });
 await check('review_in_flight_keeps_its_source_version_after_new_confirmation',async()=>{
  let entered,release;const started=new Promise(resolve=>{entered=resolve;}),waiting=new Promise(resolve=>{release=resolve;});releaseModel=release;modelHook=async()=>{entered();await waiting;};
  const request=call('POST',`${root}/code-reviews`,{language:'javascript',code:'const versionBound = true;',context:'project',requirementId:version});await enteredWithin(started);
  const next=await call('POST',`${root}/requirements`,{content:'新版本要求两个管理员共同批准；不能沿用旧审查。'});const nextVersion=next.json().requirement.id;assert.equal((await call('POST',`${root}/requirements/${nextVersion}/confirm`)).statusCode,200);
  release();const response=await request;modelHook=null;assert.equal(response.statusCode,201);assert.equal(response.json().review.requirementVersionId,version);assert.equal(response.json().review.reviewContext.requirement.content,requirement);
  const before=modelCalls;assert.equal((await call('POST',`${root}/code-reviews`,{language:'javascript',code:'let stale;',context:'project',requirementId:version})).statusCode,409);assert.equal(modelCalls,before);
 });
 await check('foreign_review_access_and_cross_project_context_are_rejected',async()=>{
  const before=modelCalls;assert.equal((await call('GET',`${root}/code-reviews`,undefined,foreign)).statusCode,404);assert.equal((await call('POST',`${root}/code-reviews`,{language:'javascript',code:'let forbidden;'},foreign)).statusCode,404);assert.equal(modelCalls,before);
  const other=await call('POST','/projects',{name:'关系隔离 · 合成',description:''});const otherRoot=`/projects/${other.json().project.id}`;const r=await call('POST',`${otherRoot}/requirements`,{content:'另一个项目的需求'});const otherVersion=r.json().requirement.id;await call('POST',`${otherRoot}/requirements/${otherVersion}/confirm`);
  const client=await pool.connect();try{await client.query('BEGIN');await assert.rejects(()=>client.query('INSERT INTO code_reviews(project_id,language,code,syntax_findings,ai_advice,model_name,requirement_version_id) VALUES($1,$2,$3,$4,$5,$6,$7)',[project,'javascript','let cross;','[]','合成建议','fixture',otherVersion]),error=>error.code==='23503');}finally{await client.query('ROLLBACK');client.release();}
 });
 await check('long_requirement_blocks_project_review_but_explicit_code_only_is_truthful',async()=>{
  const long=await call('POST',`${root}/requirements`,{content:'需求'.repeat(10500)+'末尾必须检查'});const longId=long.json().requirement.id;await call('POST',`${root}/requirements/${longId}/confirm`);
  const before=modelCalls;assert.equal((await call('POST',`${root}/code-reviews`,{language:'javascript',code:'let bounded;',context:'project',requirementId:longId})).statusCode,413);assert.equal(modelCalls,before);
  const response=await call('POST',`${root}/code-reviews`,{language:'javascript',code:'let explicit;',context:'code_only'});assert.equal(response.statusCode,201);assert.equal(response.json().review.reviewContext.scope,'code_only');assert.equal(response.json().review.requirementVersionId,null);assert.equal(response.json().review.reviewContext.retrieval.sources.length,0);
 });
 const address=await app.listen({host:'127.0.0.1',port:0});
 await check('disconnect_cancels_waiting_review_without_persisting_late_model_advice',async()=>{
  let entered,release;const started=new Promise(resolve=>{entered=resolve;}),waiting=new Promise(resolve=>{release=resolve;});releaseModel=release;modelHook=async()=>{entered();await waiting;};
  const before=(await call('GET',`${root}/code-reviews`)).json().reviews.length,controller=new AbortController();abortTransport=()=>controller.abort();
  const sent=fetch(`${address}${root}/code-reviews`,{method:'POST',headers:{authorization:`Bearer ${owner.token}`,'content-type':'application/json'},body:JSON.stringify({language:'javascript',code:'let cancel;',context:'code_only'}),signal:controller.signal}).catch(()=>null);
  await enteredWithin(started);controller.abort();await sent;await new Promise(resolve=>setTimeout(resolve,100));release();modelHook=null;await new Promise(resolve=>setTimeout(resolve,100));assert.equal((await call('GET',`${root}/code-reviews`)).json().reviews.length,before);
 });
 await check('real_desktop_displays_historical_requirement_and_actual_source_text',async()=>{
  const {chromium}=await import('playwright');browser=await chromium.launch({headless:true,channel:process.platform==='win32'?'msedge':undefined});const context=await browser.newContext({viewport:{width:1536,height:960},reducedMotion:'reduce'});
  await context.addInitScript(token=>localStorage.setItem('gongxu_token',token),owner.token);const page=await context.newPage();page.setDefaultTimeout(12000);let errors=0;page.on('pageerror',()=>errors++);
  await page.route('**/*',async route=>{const url=new URL(route.request().url());if(url.origin!=='http://127.0.0.1:5173')return route.abort();if(!url.pathname.startsWith('/api/'))return route.continue();const response=await route.fetch({url:address+url.pathname.slice(4)+url.search,maxRedirects:0});await route.fulfill({response});});
  await page.goto(`http://127.0.0.1:5173${root}/reviews`);await page.locator('.run-link').last().click();const sources=page.getByRole('region',{name:'本次审查依据'});await sources.getByText(/依据为历史需求/).waitFor();await sources.getByText(/核对提交时的完整需求/).click();assert.ok((await sources.locator('.review-source-text').first().textContent()).includes('末尾验收：库存不足'));
  await sources.locator('.review-source-list summary').first().click();await sources.scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);assert.equal(errors,0);
  await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:fileURLToPath(new URL('review-source-desktop.png',output))});await context.close();
 });
 report.status='passed';
}catch(error){report.status='failed';report.failedStage=stage;report.errorType=error.constructor.name;console.log(`FAIL ${stage} (${error.constructor.name})`);process.exitCode=1;}
finally{abortTransport?.();releaseModel?.();modelHook=null;await browser?.close();for(const identity of [owner,foreign])if(identity)await call('POST','/auth/logout',undefined,identity).catch(()=>{});await app.close();await pool.end();globalThis.fetch=send;report.finishedAt=new Date().toISOString();report.chatFixtureCalls=modelCalls;await writeFile(new URL('report.json',output),JSON.stringify(report,null,2));console.log(`Report: ${fileURLToPath(new URL('report.json',output))}`);}
