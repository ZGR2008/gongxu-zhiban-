import {test} from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import type {Pool} from 'pg';
import type {ProjectStore} from '../project-store.js';
import {registerPracticeRoutes} from './routes.js';

const project='11111111-1111-4111-8111-111111111111';
const headers={authorization:`Bearer ${'a'.repeat(64)}`};
const store={userBySession:async()=>({id:'owner'}),getProject:async()=>({id:project})} as unknown as ProjectStore;
const url=`/projects/${project}/code-draft`;

test('code drafts are separate from AI review and require an explicit revision',async t=>{
 let queries=0,modelCalls=0;
 const pool={query:async()=>{queries++;return {rows:[]};}} as unknown as Pool;
 const app=Fastify();await registerPracticeRoutes(app,store,pool,undefined,{complete:async()=>{modelCalls++;return '';}});t.after(()=>app.close());
 assert.equal((await app.inject({method:'PUT',url,headers,payload:{language:'typescript',code:'const x = 1;'}})).statusCode,428);
 assert.equal((await app.inject({method:'PUT',url,headers,payload:{language:'typescript',code:'x'.repeat(50001),expectedRevision:0}})).statusCode,400);
 assert.equal((await app.inject({method:'PUT',url,headers,payload:{language:'typescript',code:'',expectedRevision:-1}})).statusCode,400);
 assert.equal(queries,0);assert.equal(modelCalls,0);
});

test('draft reads and writes reject foreign projects before issuing a query',async t=>{
 let queries=0;
 const pool={query:async()=>{queries++;return {rows:[]};}} as unknown as Pool;
 const app=Fastify();await registerPracticeRoutes(app,{...store,getProject:async()=>null} as ProjectStore,pool);t.after(()=>app.close());
 assert.equal((await app.inject({method:'GET',url})).statusCode,401);
 assert.equal((await app.inject({method:'GET',url,headers})).statusCode,404);
 assert.equal((await app.inject({method:'PUT',url,headers,payload:{language:'javascript',code:'REVIEW_PLACEHOLDER_575a8dfc08a84f40bc3b',expectedRevision:0}})).statusCode,404);assert.equal(queries,0);
});

test('a saved code draft needs no model configuration and never executes the code',async t=>{
 const calls:{sql:string;values:unknown[]}[]=[];let modelCalls=0;
 const code='globalThis.__draftMustNotRun = true;';
 const pool={query:async(sql:string,values:unknown[])=>{calls.push({sql,values});return {rows:[{projectId:project,language:'javascript',code,revision:1}]};}} as unknown as Pool;
 const app=Fastify();await registerPracticeRoutes(app,store,pool,undefined,{complete:async()=>{modelCalls++;return '';}});t.after(()=>app.close());
 const response=await app.inject({method:'PUT',url,headers,payload:{language:'javascript',code,expectedRevision:0}});
 assert.equal(response.statusCode,201);assert.equal(response.json().draft.code,code);assert.equal(response.json().scope,'saved_project_draft_no_model');
 assert.equal(modelCalls,0);assert.equal((globalThis as Record<string,unknown>).__draftMustNotRun,undefined);assert.equal(calls[0].values[0],project);
});

test('stale draft writes return a conflict instead of overriding another window',async t=>{
 const pool={query:async(sql:string)=>({rows:sql.startsWith('SELECT')?[{revision:3}]:[]})} as unknown as Pool;
 const app=Fastify();await registerPracticeRoutes(app,store,pool);t.after(()=>app.close());
 const response=await app.inject({method:'PUT',url,headers,payload:{language:'typescript',code:'stale input',expectedRevision:2}});
 assert.equal(response.statusCode,409);assert.equal(response.json().error,'code_draft_conflict');assert.equal(response.json().currentRevision,3);
});
