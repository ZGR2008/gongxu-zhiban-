import {test} from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import type {Pool} from 'pg';
import type {ProjectStore} from '../project-store.js';
import {registerKnowledgeRoutes} from './routes.js';
import {indexCompatibility} from './index-compatibility.js';
const user='11111111-1111-4111-8111-111111111111';
const headers={authorization:`Bearer ${'a'.repeat(64)}`};
const store={userBySession:async()=>({id:user})} as unknown as ProjectStore;
const embedding={baseUrl:'http://127.0.0.1:3010/v1',apiKey:'',model:'current-synthetic-model'};
test('ready storage status with another model is not reported as currently searchable',async t=>{
 let params:unknown[]=[];
 const pool={query:async(_sql:string,values:unknown[])=>{params=values;return{rows:[{id:user,name:'合成文档',status:'ready',chunkCount:2,indexedChunks:2,currentChunks:0,totalDocuments:201}]};}} as unknown as Pool;
 const app=Fastify();await registerKnowledgeRoutes(app,store,pool,embedding);t.after(()=>app.close());const r=await app.inject({url:'/knowledge',headers});assert.equal(r.statusCode,200);
 assert.equal(r.json().documents[0].indexCompatibility,'model_changed');assert.equal(r.json().totalDocuments,201);assert.equal(r.json().listLimited,true);assert.equal(params[0],user);assert.ok(params[1]);assert.equal(JSON.stringify(r.json()).includes(embedding.baseUrl),false);
});
test('index compatibility needs every chunk and configured model, not a ready label alone',()=>{
 assert.equal(indexCompatibility('ready',true,2,2,2),'current');assert.equal(indexCompatibility('ready',true,2,2,1),'model_changed');assert.equal(indexCompatibility('ready',true,2,1,1),'incomplete');assert.equal(indexCompatibility('ready',true,0,0,0),'incomplete');assert.equal(indexCompatibility('ready',false,2,2,2),'unconfigured');assert.equal(indexCompatibility('awaiting_embedding',true,2,0,0),'awaiting_embedding');
});
