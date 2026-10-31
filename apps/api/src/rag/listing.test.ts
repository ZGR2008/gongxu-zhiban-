import {test} from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import type {Pool} from 'pg';
import type {ProjectStore} from '../project-store.js';
import {registerKnowledgeRoutes} from './routes.js';
const owner='11111111-1111-4111-8111-111111111111',headers={authorization:`Bearer ${'a'.repeat(64)}`};
const store={userBySession:async()=>({id:owner})} as unknown as ProjectStore;
test('knowledge directory provides a bounded page and complete owned count',async t=>{
 const rows=Array.from({length:21},(_,i)=>({id:`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,name:'合成资料',status:'awaiting_embedding',chunkCount:1,indexedChunks:0,currentChunks:0,totalDocuments:201}));
 const calls:string[]=[];const query=async(sql:string)=>{calls.push(sql);if(sql.includes('AS total'))return{rows:[{total:201}]};if(sql.startsWith('WITH visible'))return{rows};return{rows:[]};};
 const pool={query,connect:async()=>({query,release:()=>{}})} as unknown as Pool;const app=Fastify();await registerKnowledgeRoutes(app,store,pool,{baseUrl:'http://127.0.0.1:3010/v1',apiKey:'',model:'synthetic-model'});t.after(()=>app.close());
 const r=await app.inject({url:'/knowledge?limit=20',headers});assert.equal(r.statusCode,200);assert.equal(r.json().page?.total,201);assert.equal(r.json().documents.length,20);assert.ok(r.json().page.nextCursor);assert.equal(r.json().documents[0].indexCompatibility,'awaiting_embedding');assert.equal(calls[0],'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');assert.equal(calls.at(-1),'COMMIT');
});
test('knowledge directory rejects invalid or foreign cursors before reading database',async t=>{
 let reads=0;const pool={query:async()=>{reads++;return{rows:[]};}} as unknown as Pool;const app=Fastify();await registerKnowledgeRoutes(app,store,pool);t.after(()=>app.close());
 for(const q of ['limit=51','cursor=broken','limit=0'])assert.equal((await app.inject({url:'/knowledge?'+q,headers})).statusCode,400);
 const cursor=Buffer.from(JSON.stringify({ownerId:'22222222-2222-4222-8222-222222222222',total:201,afterId:owner})).toString('base64url');assert.equal((await app.inject({url:'/knowledge?cursor='+cursor,headers})).statusCode,404);assert.equal(reads,0);
});
