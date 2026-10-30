import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import type { Pool } from 'pg';
import type { ProjectStore } from '../project-store.js';
import { registerAgentRoutes } from './routes.js';
const project='f121f4c1-2ec0-4d1f-8d9c-38a761d788be';
const requirement='d3d80f1c-5c71-4f7d-b3a6-cd8af99c3e9d';
const id='22222222-2222-4222-8222-222222222222';
const auth={authorization:`Bearer ${'a'.repeat(64)}`};

test('missing embedding is a recorded failure, not a fabricated plan', async t => {
  const writes:{sql:string; values:unknown[]}[]=[];
  const pool={query:async(sql:string,values:unknown[])=>{writes.push({sql,values});return {rows:sql.includes('RETURNING id')?[{id}]:[]};}} as unknown as Pool;
  const store={userBySession:async()=>({id:'user'}),getProject:async()=>({id:project}),listRequirements:async()=>[{id:requirement,status:'confirmed',content:'项目需求'}]} as unknown as ProjectStore;
  const app=Fastify(); await registerAgentRoutes(app,store,pool); t.after(()=>app.close());
  const url=`/projects/${project}/agent/runs`;
  assert.equal((await app.inject({method:'POST',url,payload:{requirementId:requirement}})).statusCode,401);
  const response=await app.inject({method:'POST',url,headers:auth,payload:{requirementId:requirement}});
  assert.equal(response.statusCode,503); assert.equal(response.json().error,'embedding_not_configured'); assert.equal(response.json().runId,id);
  assert.ok(writes.some(w=>w.sql.includes('UPDATE agent_tool_calls') && w.values[1]==='failed'));
  assert.ok(writes.some(w=>w.sql.includes('UPDATE agent_runs') && w.values[1]==='embedding_not_configured'));
  assert.equal(writes.some(w=>w.sql.includes('INSERT INTO tasks')),false);
});

test('actual workflow invokes retrieval, retries validation, then awaits human review', async t => {
  const writes:{sql:string;values:unknown[]}[]=[]; let plan:unknown;
  const pool={query:async(sql:string,values:unknown[])=>{
    writes.push({sql,values});
    if (sql.startsWith('INSERT INTO')) return {rows:[{id}]};
    if (sql.includes("status='awaiting_review'")) plan=JSON.parse(values[1] as string);
    if (sql.includes('FROM agent_runs WHERE id=')) return {rows:[{id,status:'awaiting_review',plan}]};
    return {rows:[]};
  }} as unknown as Pool;
  const store={userBySession:async()=>({id:'user'}),getProject:async()=>({id:project}),listRequirements:async()=>[{id:requirement,status:'confirmed',content:'项目需求'}]} as unknown as ProjectStore;
  let retrieval=0,models=0;
  const app=Fastify();
  await registerAgentRoutes(app,store,pool,{baseUrl:'https://test.invalid',apiKey:'test',model:'test',timeoutMs:1000},{baseUrl:'https://test.invalid',apiKey:'test',model:'embedding'}, {
    retrieve:async()=>{retrieval++;return [];},
    complete:async()=>{models++;return models===1?'invalid json':JSON.stringify({tasks:[{key:'t1',stage:'开发',title:'实现',description:'完成代码',deliverable:'源码',dependsOn:[],citations:[]}]});},
  }); t.after(()=>app.close());
  const response=await app.inject({method:'POST',url:`/projects/${project}/agent/runs`,headers:auth,payload:{requirementId:requirement}});
  assert.equal(response.statusCode,201); assert.equal(retrieval,1); assert.equal(models,2);
  assert.equal(response.json().run.status,'awaiting_review');
  assert.ok(writes.some(w=>w.sql.includes('UPDATE agent_tool_calls') && w.values[1]==='failed'));
  assert.equal(writes.some(w=>w.sql.includes('INSERT INTO tasks')),false);
});

test('plan approval takes project lock before checking version and rejects a newer confirmed requirement', async t => {
  const queries:string[]=[];
  const client={
    query:async(sql:string)=>{
      queries.push(sql);
      if (sql.includes('FROM projects') && sql.includes('FOR UPDATE')) return {rowCount:1,rows:[{id:project}]};
      if (sql.includes('FROM agent_runs')) return {rows:[{id,status:'awaiting_review',requirement_version_id:requirement}]};
      if (sql.includes('FROM requirement_versions')) return {rows:[{id:'newer-requirement'}]};
      return {rows:[]};
    },
    release:()=>{},
  };
  const pool={connect:async()=>client} as unknown as Pool;
  const store={userBySession:async()=>({id:'user'}),getProject:async()=>({id:project})} as unknown as ProjectStore;
  const app=Fastify(); await registerAgentRoutes(app,store,pool); t.after(()=>app.close());
  const response=await app.inject({method:'POST',url:`/projects/${project}/agent/runs/${id}/confirm`,headers:auth});
  assert.equal(response.statusCode,409); assert.equal(response.json().error,'requirement_version_outdated');
  const projectLock=queries.findIndex(q=>q.includes('FROM projects') && q.includes('FOR UPDATE'));
  const runLock=queries.findIndex(q=>q.includes('FROM agent_runs') && q.includes('FOR UPDATE'));
  const versionCheck=queries.findIndex(q=>q.includes('FROM requirement_versions'));
  assert.ok(projectLock>0 && projectLock<runLock && runLock<versionCheck);
  assert.equal(queries.some(q=>q.includes('INSERT INTO tasks')),false);
  assert.equal(queries.at(-1),'ROLLBACK');
});
