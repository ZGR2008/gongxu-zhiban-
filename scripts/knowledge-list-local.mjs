import {createRequire} from 'node:module';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {loadConfig} from '../apps/api/dist/config.js';
import {PgProjectStore} from '../apps/api/dist/project-store.js';
import {registerProjectRoutes} from '../apps/api/dist/project-routes.js';
import {registerKnowledgeRoutes} from '../apps/api/dist/rag/routes.js';
import {loadEmbeddingConfig,saveText,retrieveKnowledge} from '../apps/api/dist/rag/service.js';
const require=createRequire(new URL('../apps/api/package.json',import.meta.url));require('dotenv').config({path:fileURLToPath(new URL('../apps/api/.env',import.meta.url))});
const config=loadConfig(),embedding=loadEmbeddingConfig(),local=value=>['127.0.0.1','localhost','[::1]'].includes(new URL(value).hostname);
if(!config.DATABASE_URL||!local(config.DATABASE_URL)||!embedding||!local(embedding.baseUrl))throw Error('Existing local database and embedding required');
let embeddingCalls=0;const send=globalThis.fetch;globalThis.fetch=(input,init)=>{const url=input instanceof Request?input.url:String(input);if(!local(url))throw Error('External request prohibited');if(url.startsWith(embedding.baseUrl))embeddingCalls++;return send(input,{...init,redirect:'error'});};
const {Pool}=require('pg'),Fastify=require('fastify');
const pool=new Pool({connectionString:config.DATABASE_URL,connectionTimeoutMillis:3000,statement_timeout:15000,query_timeout:18000});
const store=new PgProjectStore(pool),app=Fastify({logger:false});await registerProjectRoutes(app,store);await registerKnowledgeRoutes(app,store,pool,embedding);
app.get('/health',async()=>({status:'ok',service:'gongxu-api'}));app.get('/ready',async()=>({status:'ready'}));app.get('/ai/status',async()=>({configured:false}));
const directory=new URL(`../.runtime/knowledge-list-local-${randomUUID()}/`,import.meta.url);await mkdir(directory,{recursive:true});
const report={scope:'real_local_database_embedding_http_browser_knowledge_pagination',realChatModel:false,syntheticRecords:true,checks:[],startedAt:new Date().toISOString()};
let owner,foreign,browser,page,stage='setup',first,last;
const call=(method,url,payload,identity=owner)=>app.inject({method,url,headers:{authorization:`Bearer ${identity.token}`},...(payload===undefined?{}:{payload})});
async function check(name,run){stage=name;await run();report.checks.push({name,status:'passed'});console.log(`PASS ${name}`);}
const text='需求验收时保留失败记录与末尾条件，引用原文供人工复核，旧版通过不得计入新版验证。';
try{
 for(const other of [false,true]){const r=await app.inject({method:'POST',url:'/auth/register',payload:{name:'知识分页 · 合成',email:`kb-page-${randomUUID()}@example.test`,password:randomBytes(24).toString('base64url')}});assert.equal(r.statusCode,201);const d=r.json(),identity={id:d.user.id,token:d.token};if(other)foreign=identity;else owner=identity;}
 last=await saveText(pool,owner.id,'最早合成资料 · 仍须可管理',text);
 await pool.query("UPDATE knowledge_documents SET created_at='2026-10-30T00:00:00.123456Z' WHERE id=$1",[last.id]);
 await pool.query(`WITH added AS(INSERT INTO knowledge_documents(owner_id,name,media_type,status,created_at)
 SELECT $1,'较新合成资料 '||n,'text/plain','awaiting_embedding','2026-11-01T00:00:00.123456Z'::timestamptz FROM generate_series(1,200) n RETURNING id)
 INSERT INTO knowledge_chunks(document_id,position,content) SELECT id,0,'这是一份尚未建立向量的合成知识资料。' FROM added`,[owner.id]);
 await check('bounded_page_has_complete_count_and_legacy_range_is_explicit',async()=>{
  const legacy=(await call('GET','/knowledge')).json();assert.equal(legacy.documents.length,200);assert.equal(legacy.scope,'latest_200_legacy');assert.ok(!legacy.documents.some(d=>d.id===last.id));
  const r=await call('GET','/knowledge?limit=20');assert.equal(r.statusCode,200);first=r.json();assert.equal(first.documents.length,20);assert.equal(first.page.total,201);assert.ok(first.page.nextCursor);assert.ok(first.documents.every(d=>d.chunkCount===1&&d.indexCompatibility==='awaiting_embedding'));assert.equal(embeddingCalls,0);assert.equal(JSON.stringify(first).includes(embedding.baseUrl),false);
 });
 await check('eleven_pages_reach_oldest_document_without_microsecond_gaps_or_duplicates',async()=>{
  let data=first,ids=[],count=0;do{count++;ids.push(...data.documents.map(d=>d.id));if(!data.page.nextCursor)break;const r=await call('GET','/knowledge?limit=20&cursor='+encodeURIComponent(data.page.nextCursor));assert.equal(r.statusCode,200);data=r.json();}while(count<15);
  assert.equal(count,11);assert.equal(ids.length,201);assert.equal(new Set(ids).size,201);assert.equal(ids.at(-1),last.id);assert.equal(data.documents[0].indexCompatibility,'awaiting_embedding');assert.equal(embeddingCalls,0);
 });
 await check('foreign_invalid_and_missing_anchor_cursors_cannot_reveal_owned_documents',async()=>{
  assert.deepEqual((await call('GET','/knowledge?limit=20',undefined,foreign)).json().documents,[]);assert.equal((await call('GET','/knowledge?cursor='+first.page.nextCursor,undefined,foreign)).statusCode,404);
  assert.equal((await call('POST',`/knowledge/${last.id}/index`,undefined,foreign)).statusCode,404);
  for(const q of ['limit=51','cursor=broken','limit=0'])assert.equal((await call('GET','/knowledge?'+q)).statusCode,400);
  const cursor=JSON.parse(Buffer.from(first.page.nextCursor,'base64url'));cursor.afterId=randomUUID();assert.equal((await call('GET','/knowledge?cursor='+Buffer.from(JSON.stringify(cursor)).toString('base64url'))).statusCode,409);
 });
 await check('desktop_last_page_explicit_index_retains_page_and_unsaved_inputs',async()=>{
  const address=await app.listen({host:'127.0.0.1',port:0}),{chromium}=await import('playwright');browser=await chromium.launch({headless:true,channel:'msedge'});const context=await browser.newContext({viewport:{width:1440,height:950},reducedMotion:'reduce'});await context.addInitScript(token=>localStorage.setItem('gongxu_token',token),owner.token);page=await context.newPage();page.setDefaultTimeout(12000);let errors=0;page.on('pageerror',()=>errors++);
  await page.route('**/*',async route=>{const url=new URL(route.request().url());if(!local(url.href))return route.abort();if(!url.pathname.startsWith('/api/'))return route.continue();const response=await route.fetch({url:address+url.pathname.slice(4)+url.search,maxRedirects:0});await route.fulfill({response});});
  await page.goto('http://127.0.0.1:5173/knowledge');const list=page.getByRole('region',{name:'知识资料与索引来源'});await list.getByText('读取时共 201 份 · 第 1 页 · 本页 20 份',{exact:true}).waitFor();
  await page.getByLabel('文档名称',{exact:true}).fill('尚未提交的合成草稿');await page.getByLabel('文档内容',{exact:true}).fill('分页与索引均保留这份草稿。');await page.getByLabel('检索问题').fill('尚未提交的检索问题');
  for(let i=2;i<=11;i++){await list.getByRole('button',{name:'下一页资料',exact:true}).click();await list.getByText(`读取时共 201 份 · 第 ${i} 页 · 本页 ${i===11?1:20} 份`,{exact:true}).waitFor();}
  await list.getByText('最早合成资料 · 仍须可管理',{exact:true}).waitFor();assert.equal(embeddingCalls,0);await list.getByRole('button',{name:'建立索引',exact:true}).click();await list.getByText('当前模型索引',{exact:true}).waitFor();assert.ok(embeddingCalls>0);await list.getByText('读取时共 201 份 · 第 11 页 · 本页 1 份',{exact:true}).waitFor();
  assert.equal(await page.getByLabel('文档名称',{exact:true}).inputValue(),'尚未提交的合成草稿');assert.equal(await page.getByLabel('文档内容',{exact:true}).inputValue(),'分页与索引均保留这份草稿。');assert.equal(await page.getByLabel('检索问题').inputValue(),'尚未提交的检索问题');assert.equal(errors,0);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);await page.screenshot({path:fileURLToPath(new URL('knowledge-oldest-managed.png',directory))});await context.close();page=null;
 });
 await check('indexed_oldest_source_is_retrievable_and_new_upload_invalidates_old_membership_cursor',async()=>{
  assert.equal((await retrieveKnowledge(pool,owner.id,text,embedding))[0].document_id,last.id);assert.equal((await pool.query('SELECT content FROM knowledge_chunks WHERE document_id=$1',[last.id])).rows[0].content,text);
  const stable=await call('GET','/knowledge?cursor='+first.page.nextCursor);assert.equal(stable.statusCode,200);
  await saveText(pool,owner.id,'后来新增合成资料','新增目录成员后需要重新读取分页。');const stale=await call('GET','/knowledge?cursor='+first.page.nextCursor);assert.equal(stale.statusCode,409);assert.equal(stale.json().error,'knowledge_list_changed');assert.equal((await call('GET','/knowledge?limit=20')).json().page.total,202);
 });
 report.status='passed';
}catch(error){report.status='failed';report.failedStage=stage;report.errorType=error.constructor.name;if(page)await page.screenshot({path:fileURLToPath(new URL('failure.png',directory))}).catch(()=>{});console.log(`FAIL ${stage} (${error.constructor.name})`);process.exitCode=1;}
finally{await browser?.close();for(const identity of [owner,foreign])if(identity)await call('POST','/auth/logout',undefined,identity).catch(()=>{});await app.close();await pool.end();report.localEmbeddingAttempts=embeddingCalls;report.finishedAt=new Date().toISOString();await writeFile(new URL('report.json',directory),JSON.stringify(report,null,2));console.log(`Report: ${fileURLToPath(new URL('report.json',directory))}`);}
