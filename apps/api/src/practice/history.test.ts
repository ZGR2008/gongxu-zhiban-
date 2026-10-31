import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import type { Pool } from 'pg';
import type { ProjectStore } from '../project-store.js';
import { registerPracticeRoutes } from './routes.js';
const project='11111111-1111-4111-8111-111111111111',caseId='22222222-2222-4222-8222-222222222222';
const headers={authorization:`Bearer ${'a'.repeat(64)}`};
const store={userBySession:async()=>({id:project}),getProject:async()=>({id:project})} as unknown as ProjectStore;
test('stale test-definition revision cannot receive an execution outcome',async t=>{
 let updates=0;
 const pool={query:async(sql:string)=>{if(sql.startsWith('UPDATE')){updates++;return{rows:[]};}return{rows:[{id:caseId}]};}} as unknown as Pool;
 const app=Fastify();t.after(()=>app.close());await registerPracticeRoutes(app,store,pool);
 const response=await app.inject({method:'PATCH',url:`/projects/${project}/test-cases/${caseId}/execution`,headers,payload:{result:'passed',note:'针对旧定义的人工记录',expectedRevision:1}});
 assert.equal(response.statusCode,409);assert.equal(response.json().error,'test_case_changed');assert.equal(updates,1);
});
test('case history is scoped by the authenticated project before database access',async t=>{
 let reads=0;const pool={query:async()=>{reads++;return{rows:[{id:caseId,kind:'definition_changed',snapshot:{result:'passed',revision:1}}]};}} as unknown as Pool;
 const app=Fastify();t.after(()=>app.close());await registerPracticeRoutes(app,store,pool);
 const url=`/projects/${project}/test-cases/${caseId}/history`;
 assert.equal((await app.inject({method:'GET',url})).statusCode,401);assert.equal(reads,0);
 const response=await app.inject({method:'GET',url,headers});assert.equal(response.statusCode,200);assert.equal(response.json().history[0].snapshot.result,'passed');
});
test('a foreign project cannot inspect test execution history',async t=>{
 let reads=0;const pool={query:async()=>{reads++;return{rows:[]};}} as unknown as Pool;
 const app=Fastify();t.after(()=>app.close());await registerPracticeRoutes(app,{...store,getProject:async()=>null},pool);
 const response=await app.inject({method:'GET',url:`/projects/${project}/test-cases/${caseId}/history`,headers});assert.equal(response.statusCode,404);assert.equal(reads,0);
});
