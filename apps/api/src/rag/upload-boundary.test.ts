import {test} from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import type {Pool} from 'pg';
import type {ProjectStore} from '../project-store.js';
import {registerKnowledgeRoutes} from './routes.js';
import {savePages} from './service.js';
import {chunkPages} from './chunk.js';
const user='11111111-1111-4111-8111-111111111111',headers={authorization:`Bearer ${'a'.repeat(64)}`};
test('an accepted-size text that expands past 250 chunks is explicitly refused before any database connection',async t=>{
 const text=('字'.repeat(601)+'。').repeat(300)+'末尾关键原文必须保留';assert.ok(text.length<200000);assert.ok(chunkPages([{page:null,text}]).length>250);
 let connections=0;const pool={connect:async()=>{connections++;throw Error('No writes allowed');}} as unknown as Pool;
 const store={userBySession:async()=>({id:user})} as unknown as ProjectStore;
 const app=Fastify();await registerKnowledgeRoutes(app,store,pool);t.after(()=>app.close());const r=await app.inject({method:'POST',url:'/knowledge/text',headers,payload:{name:'合成分块边界',text}});
 assert.equal(r.statusCode,413);assert.equal(r.json().error,'document_too_many_chunks');assert.equal(r.json().maxChunks,250);assert.ok(r.json().actualChunks>250);assert.equal(connections,0);
});
test('exactly 250 chunks preserve their last content and 251 chunks do not open a transaction',async()=>{
 const saved:unknown[][]=[];let connections=0;
 const pool={connect:async()=>{connections++;return {query:async(sql:string,values:unknown[]=[])=>{if(sql.startsWith('INSERT INTO knowledge_chunks'))saved.push(values);return{rows:[{id:user}]};},release:()=>{}};}} as unknown as Pool;
 const pages=Array.from({length:250},(_,i)=>({page:i+1,text:i===249?'末页的关键验收要求':'合成原文'}));
 const result=await savePages(pool,user,'合成250块','text/plain',pages);assert.equal(result.chunks,250);assert.equal(saved.at(-1)?.[3],'末页的关键验收要求');assert.equal(connections,1);
 await assert.rejects(savePages(pool,user,'合成251块','text/plain',[...pages,{page:251,text:'超限部分不能静默丢弃'}]),/document_too_many_chunks/);assert.equal(connections,1);assert.equal(saved.length,250);
});
