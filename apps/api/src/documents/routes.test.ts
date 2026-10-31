import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import type { ProjectStore } from '../project-store.js';
import type { DocumentStore, ProjectDocument } from './store.js';
import { registerDocumentRoutes } from './routes.js';
const project='f121f4c1-2ec0-4d1f-8d9c-38a761d788be';
const other='f121f4c1-2ec0-4d1f-8d9c-38a761d788bf';
const requirement='d3d80f1c-5c71-4f7d-b3a6-cd8af99c3e9d';
const id='22222222-2222-4222-8222-222222222222';
const headers={authorization:`Bearer ${'a'.repeat(64)}`};
const config={baseUrl:'https://test.invalid',apiKey:'test',model:'test-model',timeoutMs:1000};
const store={userBySession:async()=>({id:'user'}),getProject:async(_u:string,p:string)=>p===project?{id:project,name:'项目',description:'描述'}:null,listRequirements:async()=>[{id:requirement,status:'confirmed',version:2,content:'需求内容'}]} as unknown as ProjectStore;

test('model generation uses confirmed project context, persists source and supports edit and export', async t=>{
 let saved:ProjectDocument | undefined; let messages='';
 const docs={getContext:async()=>({tasks:[{title:'实现登录',stage:'开发',status:'todo'}],testCases:[{title:'空输入',category:'boundary',result:'not_run',executionNote:'',executedAt:null}],testCounts:{total:1,notRun:1,passed:0,failed:0,blocked:0}}),list:async()=>saved?[saved]:[],get:async()=>saved??null,create:async(_u:string,p:string,r:string,type:string,content:string,model:string)=>{
   assert.equal(r,requirement); saved={id,projectId:p,requirementVersionId:r,type,content,modelName:model,revision:1,createdAt:new Date(),updatedAt:new Date()} as ProjectDocument; return saved;
 },history:async()=>[],update:async(_u:string,_p:string,_id:string,content:string,revision:number)=>{ if (!saved) return null; assert.equal(revision,saved.revision);saved={...saved,content,revision:revision+1}; return saved; }} as DocumentStore;
 const app=Fastify(); await registerDocumentRoutes(app,store,docs,config,async(_config,m)=>{messages=m.map(x=>x.content).join('\n');return '# 测试报告\n待补充';}); t.after(()=>app.close());
 const url=`/projects/${project}/documents`;
 assert.equal((await app.inject({method:'POST',url:`${url}/generate`,payload:{type:'test_report'}})).statusCode,401);
 const generated=await app.inject({method:'POST',url:`${url}/generate`,headers,payload:{type:'test_report'}});
 assert.equal(generated.statusCode,201); assert.match(messages,/需求内容/); assert.match(messages,/未提供代码/); assert.match(messages,/空输入/); assert.match(messages,/实现登录/);
 assert.match(generated.json().document.content,/未执行 1 条，通过 0 条/); assert.match(generated.json().document.content,/人工登记/); assert.equal(generated.json().document.requirementVersionId,requirement);
 assert.equal((await app.inject({method:'PATCH',url:`${url}/${id}`,headers,payload:{content:'# 人工编辑',expectedRevision:1}})).statusCode,200);
 const exported=await app.inject({method:'GET',url:`${url}/${id}/export`,headers}); assert.equal(exported.body,'# 人工编辑'); assert.match(exported.headers['content-type']!,/text\/markdown/);
 assert.equal((await app.inject({method:'GET',url:`/projects/${other}/documents/${id}`,headers})).statusCode,404);
});

test('generation requires configuration and a confirmed requirement without writing a document', async t=>{
 let writes=0; const docs={create:async()=>{writes++; return null;}} as unknown as DocumentStore;
 const app=Fastify(); await registerDocumentRoutes(app,store,docs); t.after(()=>app.close());
 const url=`/projects/${project}/documents/generate`;
 assert.equal((await app.inject({method:'POST',url,headers,payload:{type:'api'}})).json().error,'ai_not_configured'); assert.equal(writes,0);
 const noConfirmed={...store,listRequirements:async()=>[{status:'draft'}]} as unknown as ProjectStore;
 const second=Fastify(); await registerDocumentRoutes(second,noConfirmed,docs,config); t.after(()=>second.close());
 assert.equal((await second.inject({method:'POST',url,headers,payload:{type:'api'}})).statusCode,409); assert.equal(writes,0);
});


test('document context queries are scoped to owner, project and requirement and preserve real counts', async () => {
  const calls: {sql:string;values:unknown[]}[]=[];
  const pool={query:async(sql:string,values:unknown[])=>{
    calls.push({sql,values});
    if (sql.includes('practice_test_cases')) return {rows:[{title:'边界',category:'boundary',result:'not_run',executionNote:'',executedAt:null,total:'70',notRun:'68',passed:'1',failed:'1',blocked:'0'}]};
    return {rows:[{title:'任务',stage:'开发',status:'done'}]};
  }};
  const { PgDocumentStore }=await import('./store.js');
  const context=await new PgDocumentStore(pool as never).getContext('owner',project,requirement);
  assert.deepEqual(context.testCounts,{total:70,notRun:68,passed:1,failed:1,blocked:0});
  assert.equal(context.testCases[0].result,'not_run');
  assert.equal(calls.length,2);
  for(const call of calls){ assert.deepEqual(call.values,['owner',project,requirement]); assert.match(call.sql,/p\.owner_id=\$1/); assert.match(call.sql,/requirement_version_id=\$3/); }
  assert.ok(calls.some(call=>call.sql.includes("a.status='confirmed'")));
});
