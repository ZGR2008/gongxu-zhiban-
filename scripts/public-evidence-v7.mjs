// Read ONLY the authorized public curriculum from the local primary database.
// Copy matching public texts/vectors into a new synthetic database for screenshots.
// No private rows, real identities, paid models, video, or primary writes.
import {createRequire} from 'node:module';import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';import assert from 'node:assert/strict';
import {chromium} from 'playwright';import {curriculum} from '../knowledge/teaching-v6/catalog.mjs';
import {savePublicLesson} from '../apps/api/dist/rag/public.js';import {loadEmbeddingConfig} from '../apps/api/dist/rag/service.js';
import {createApp} from '../apps/api/dist/app.js';import {PgProjectStore} from '../apps/api/dist/project-store.js';
const require=createRequire(new URL('../apps/api/package.json',import.meta.url));require('dotenv').config({path:fileURLToPath(new URL('../apps/api/.env',import.meta.url)),quiet:true});
const local=s=>['localhost','127.0.0.1','[::1]'].includes(new URL(s).hostname),embedding=loadEmbeddingConfig();
assert.ok(local(process.env.DATABASE_URL)&&embedding&&local(embedding.baseUrl));
const {Pool}=require('pg'),source=new Pool({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:3000});
const name='gx_public_ui_v7_'+randomUUID().replaceAll('-',''),target=new URL(process.env.DATABASE_URL);target.pathname='/'+name;
const out=new URL(`../.runtime/public-evidence-v7-${randomUUID()}/`,import.meta.url);await mkdir(out,{recursive:true});
const report={scope:'public_only_primary_read_synthetic_database_ui',primaryWrites:0,privateRowsRead:0,paidCalls:0,videoRecorded:false,lessons:[],screenshots:[],retainedDatabase:name};
const originalFetch=globalThis.fetch;globalThis.fetch=(u,o)=>{if(!local(u instanceof Request?u.url:String(u)))throw Error('External requests forbidden');return originalFetch(u,o);};let db,app,browser;
try{
 const publicRows=(await source.query("SELECT id,name,content_hash,status,source_metadata FROM knowledge_documents WHERE visibility='platform_public' ORDER BY source_metadata->>'lessonId'")).rows;
 report.primaryPublicDocuments=publicRows.length;assert.equal(publicRows.length,51);assert.ok(publicRows.every(x=>!x.source_metadata.lessonId.startsWith('GX-TEST-99')));
 await source.query(`CREATE DATABASE ${name} TEMPLATE template0`);await promisify(execFile)(process.execPath,[fileURLToPath(new URL('../apps/api/dist/migrate.js',import.meta.url))],{cwd:fileURLToPath(new URL('../apps/api/',import.meta.url)),env:{...process.env,DATABASE_URL:target.href},windowsHide:true,timeout:30000,maxBuffer:128000});
 db=new Pool({connectionString:target.href});
 for(const lesson of curriculum){const hash=createHash('sha256').update(lesson.text).digest('hex'),src=publicRows.find(r=>r.content_hash===hash);assert.ok(src,'Public source must match the reviewed original curriculum');
  const chunks=(await source.query("SELECT c.position,c.content,c.embedding::text AS embedding,c.embedding_model FROM knowledge_chunks c JOIN knowledge_documents d ON d.id=c.document_id WHERE d.visibility='platform_public' AND d.id=$1 ORDER BY c.position",[src.id])).rows;
  assert.ok(chunks.length>0&&chunks.every(c=>c.embedding&&c.embedding_model));const saved=await savePublicLesson(db,lesson);
  for(const c of chunks){const r=await db.query('UPDATE knowledge_chunks SET embedding=$3::vector,embedding_model=$4 WHERE document_id=$1 AND position=$2 AND content=$5',[saved.id,c.position,c.embedding,c.embedding_model,c.content]);assert.equal(r.rowCount,1);}
  await db.query('UPDATE knowledge_documents SET status=$2 WHERE id=$1',[saved.id,src.status]);report.lessons.push({lessonId:lesson.lessonId,hash,chunks:chunks.length,status:src.status,embeddingModel:chunks[0].embedding_model});
 }
 report.indexedChunks=report.lessons.reduce((n,r)=>n+r.chunks,0);assert.equal(report.indexedChunks,53);
 app=await createApp({pool:db,projectStore:new PgProjectStore(db),database:{query:s=>db.query(s),end:async()=>{}},embeddingConfig:embedding,corsOrigin:'http://127.0.0.1:5173'});const origin=await app.listen({host:'127.0.0.1',port:0});
 const registration=await fetch(origin+'/auth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'公共课程核对 · 合成账号',email:`public-evidence-${randomUUID()}@example.test`,password:randomBytes(24).toString('base64url')})});assert.equal(registration.status,201);const user=await registration.json();
 browser=await chromium.launch({headless:true,channel:'msedge'});const context=await browser.newContext({viewport:{width:1480,height:1000},reducedMotion:'reduce'});await context.addInitScript(t=>localStorage.setItem('gongxu_token',t),user.token);const page=await context.newPage();
 await page.route('**/*',async r=>{const u=new URL(r.request().url());if(!local(u.href))return r.abort();if(u.pathname.startsWith('/api/')){const res=await r.fetch({url:origin+u.pathname.slice(4)+u.search});return r.fulfill({response:res});}return r.continue();});
 await page.goto('http://127.0.0.1:5173/knowledge');const panel=page.getByRole('region',{name:'平台公共教学知识库'});await panel.getByText(/共 51 篇/).waitFor();await panel.locator('summary').filter({hasText:'浏览公共资料目录与版本'}).click();assert.equal(await panel.getByText('待维护人员完成索引',{exact:true}).count(),0);assert.equal(await panel.getByText(/可检索 ·/).count(),50);
 for(const [label,locator] of [['public-catalogue',panel]]){const path=fileURLToPath(new URL(label+'.png',out));await locator.screenshot({path});report.screenshots.push({label,path,unaltered:true});}
 const caseRow=panel.locator('li').filter({hasText:'GX-CASE-01'});await caseRow.getByRole('button',{name:'阅读原文片段',exact:true}).click();await panel.getByText(/实际存储片段/).waitFor();const path=fileURLToPath(new URL('public-original-source.png',out));await panel.locator('.teaching-snapshot').screenshot({path});report.screenshots.push({label:'public-original-source',path,unaltered:true});
 const response=await fetch(origin+'/knowledge/search',{method:'POST',headers:{authorization:'Bearer '+user.token,'content-type':'application/json'},body:JSON.stringify({query:'校园物品借用期限与申请人自行审批的边界如何验收？'})});assert.equal(response.status,200);const result=await response.json();report.retrieval=result;report.answerQuality='not_evaluated_no_chat_call';report.status='passed';
}catch(e){report.status='failed';report.failure=e.message;process.exitCode=1;console.error(e.message);}
finally{await browser?.close();await app?.close();await db?.end();await source.end();globalThis.fetch=originalFetch;report.finishedAt=new Date().toISOString();await writeFile(new URL('report.json',out),JSON.stringify(report,null,2));console.log(fileURLToPath(new URL('report.json',out)));}
