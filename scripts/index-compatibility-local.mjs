import {createRequire} from 'node:module';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {loadConfig} from '../apps/api/dist/config.js';
import {PgProjectStore} from '../apps/api/dist/project-store.js';
import {registerProjectRoutes} from '../apps/api/dist/project-routes.js';
import {registerKnowledgeRoutes} from '../apps/api/dist/rag/routes.js';
import {loadEmbeddingConfig,saveText,indexDocument,retrieveKnowledge} from '../apps/api/dist/rag/service.js';
const require=createRequire(new URL('../apps/api/package.json',import.meta.url));require('dotenv').config({path:fileURLToPath(new URL('../apps/api/.env',import.meta.url))});
const config=loadConfig(),embedding=loadEmbeddingConfig(),local=value=>['127.0.0.1','localhost','[::1]'].includes(new URL(value).hostname);
if(!config.DATABASE_URL||!local(config.DATABASE_URL)||!embedding||!local(embedding.baseUrl))throw Error('Existing local database and embedding required');
let failEmbedding=false,embeddingCalls=0;const send=globalThis.fetch;
globalThis.fetch=(input,init)=>{const url=input instanceof Request?input.url:String(input);if(!local(url))throw Error('External request prohibited');if(url.startsWith(embedding.baseUrl)){embeddingCalls++;if(failEmbedding)return Promise.reject(new TypeError('Synthetic local transport failure'));}return send(input,{...init,redirect:'error'});};
const {Pool}=require('pg'),Fastify=require('fastify');
const pool=new Pool({connectionString:config.DATABASE_URL,connectionTimeoutMillis:3000,statement_timeout:15000,query_timeout:18000});
const store=new PgProjectStore(pool),app=Fastify({logger:false});await registerProjectRoutes(app,store);await registerKnowledgeRoutes(app,store,pool,embedding);
app.get('/health',async()=>({status:'ok',service:'gongxu-api'}));app.get('/ready',async()=>({status:'ready'}));app.get('/ai/status',async()=>({configured:false}));
const directory=new URL(`../.runtime/index-compatibility-local-${randomUUID()}/`,import.meta.url);await mkdir(directory,{recursive:true});
const report={scope:'real_local_embedding_database_http_browser_with_controlled_old_identity_and_transport_failure',realChatModel:false,REVIEW_PLACEHOLDER_575a8dfc08a84f40bc3bRecords:true,checks:[],startedAt:new Date().toISOString()};
let owner,foreign,browser,stage='setup',document;
const call=(method,url,payload,identity=owner)=>app.inject({method,url,headers:{authorization:`Bearer ${identity.token}`},...(payload===undefined?{}:{payload})});
async function check(name,run){stage=name;await run();report.checks.push({name,status:'passed'});console.log(`PASS ${name}`);}
const text='软件工程验收条件需要描述可观察结果、输入边界和失败处理；模型生成建议仍须人工核对。';
try{
 for(const other of [false,true]){const r=await app.inject({method:'POST',url:'/auth/register',payload:{name:'索引来源 · 合成',email:`index-source-${randomUUID()}@example.test`,password:randomBytes(24).toString('base64url')}});assert.equal(r.statusCode,201);const d=r.json(),identity={id:d.user.id,token:d.token};if(other)foreign=identity;else owner=identity;}
 document=await saveText(pool,owner.id,'索引兼容性 · 合成资料',text);
 await check('actual_index_is_current_only_after_embedding_and_owned_chunks_match',async()=>{
  let listing=(await call('GET','/knowledge')).json();assert.equal(listing.documents[0].indexCompatibility,'awaiting_embedding');assert.equal(listing.documents[0].chunkCount,1);
  await indexDocument(pool,owner.id,document.id,embedding);listing=(await call('GET','/knowledge')).json();assert.equal(listing.documents[0].indexCompatibility,'current');assert.equal(listing.documents[0].currentChunks,1);assert.equal(listing.totalDocuments,1);assert.equal(listing.listLimited,false);
  assert.equal((await retrieveKnowledge(pool,owner.id,text,embedding))[0].document_id,document.id);
 });
 await check('controlled_old_identity_stops_current_search_and_is_not_exposed_to_browser',async()=>{
  // This update affects only the new REVIEW_PLACEHOLDER_575a8dfc08a84f40bc3b fixture, not configuration or
  // any existing user document. It stands for stored vectors from an old model.
  await pool.query("UPDATE knowledge_chunks SET embedding_model='REVIEW_PLACEHOLDER_575a8dfc08a84f40bc3b-old-model-identity' WHERE document_id=$1",[document.id]);
  const listing=(await call('GET','/knowledge')).json();assert.equal(listing.documents[0].status,'ready');assert.equal(listing.documents[0].indexCompatibility,'model_changed');assert.equal(listing.documents[0].currentChunks,0);assert.equal(JSON.stringify(listing).includes(embedding.baseUrl),false);assert.equal(JSON.stringify(listing).includes('REVIEW_PLACEHOLDER_575a8dfc08a84f40bc3b-old-model-identity'),false);
  assert.deepEqual(await retrieveKnowledge(pool,owner.id,text,embedding),[]);assert.deepEqual((await call('GET','/knowledge',undefined,foreign)).json().documents,[]);
  assert.equal((await call('POST',`/knowledge/${document.id}/index`,undefined,foreign)).statusCode,404);
 });
 await check('desktop_explicit_rebuild_failure_recovery_and_upload_draft_preservation',async()=>{
  const address=await app.listen({host:'127.0.0.1',port:0}),{chromium}=await import('playwright');browser=await chromium.launch({headless:true,channel:'msedge'});const context=await browser.newContext({viewport:{width:1440,height:950},reducedMotion:'reduce'});await context.addInitScript(token=>localStorage.setItem('gongxu_token',token),owner.token);const page=await context.newPage();page.setDefaultTimeout(12000);let errors=0;page.on('pageerror',()=>errors++);
  await page.route('**/*',async route=>{const url=new URL(route.request().url());if(!local(url.href))return route.abort();if(!url.pathname.startsWith('/api/'))return route.continue();const response=await route.fetch({url:address+url.pathname.slice(4)+url.search,maxRedirects:0});await route.fulfill({response});});
  const before=embeddingCalls;await page.goto('http://127.0.0.1:5173/knowledge');const list=page.getByRole('region',{name:'知识资料与索引来源'});await list.getByText('模型已变化 · 待重建',{exact:true}).waitFor();assert.equal(embeddingCalls,before);
  await page.getByLabel('文档名称',{exact:true}).fill('尚未上传的合成草稿');await page.getByLabel('文档内容',{exact:true}).fill('重建或刷新状态不得覆盖上传草稿。');await list.getByRole('button',{name:'刷新资料状态',exact:true}).click();await list.getByRole('button',{name:'重建索引',exact:true}).waitFor();assert.equal(await page.getByLabel('文档内容',{exact:true}).inputValue(),'重建或刷新状态不得覆盖上传草稿。');
  failEmbedding=true;await list.getByRole('button',{name:'重建索引',exact:true}).click();await page.getByRole('alert').filter({hasText:'向量'}).waitFor();assert.equal(await list.getByText('当前模型索引',{exact:true}).count(),0);assert.ok(embeddingCalls-before<=3);
  failEmbedding=false;await list.getByRole('button',{name:'重建索引',exact:true}).click();await list.getByText('当前模型索引',{exact:true}).waitFor();assert.equal(await page.getByLabel('文档名称',{exact:true}).inputValue(),'尚未上传的合成草稿');assert.equal(await page.getByLabel('文档内容',{exact:true}).inputValue(),'重建或刷新状态不得覆盖上传草稿。');assert.equal(errors,0);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);
  await page.screenshot({path:fileURLToPath(new URL('knowledge-index-current.png',directory))});await context.close();
 });
 await check('rebuild_restores_actual_retrieval_without_changing_original_text',async()=>{
  const listing=(await call('GET','/knowledge')).json();assert.equal(listing.documents[0].indexCompatibility,'current');assert.equal((await retrieveKnowledge(pool,owner.id,text,embedding))[0].content,text);
  assert.equal((await pool.query('SELECT content FROM knowledge_chunks WHERE document_id=$1',[document.id])).rows[0].content,text);assert.deepEqual(await retrieveKnowledge(pool,foreign.id,text,embedding),[]);
 });
 report.status='passed';
}catch(error){report.status='failed';report.failedStage=stage;report.errorType=error.constructor.name;console.log(`FAIL ${stage} (${error.constructor.name})`);process.exitCode=1;}
finally{await browser?.close();for(const identity of [owner,foreign])if(identity)await call('POST','/auth/logout',undefined,identity).catch(()=>{});await app.close();await pool.end();report.localEmbeddingAttempts=embeddingCalls;report.finishedAt=new Date().toISOString();await writeFile(new URL('report.json',directory),JSON.stringify(report,null,2));console.log(`Report: ${fileURLToPath(new URL('report.json',directory))}`);}
