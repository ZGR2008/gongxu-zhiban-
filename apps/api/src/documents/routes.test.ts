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
 },page:async()=>{throw Error('Catalogue is not used by this generation fixture');},history:async()=>[],evidence:async()=>null,update:async(_u:string,_p:string,_id:string,content:string,revision:number)=>{ if (!saved) return null; assert.equal(revision,saved.revision);saved={...saved,content,revision:revision+1}; return saved; }} as DocumentStore;
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

test('generation retains the context snapshot even if evidence changes during the model call',async t=>{
 const snapshot={requirementVersionId:requirement,requirementVersion:2,taskRevision:1,caseRevision:2,traceRevision:0,documentRevision:0,capturedAt:new Date().toISOString()};
 let current={...snapshot},savedSnapshot:unknown;
 const docs={getContext:async()=>({snapshot,tasks:[],testCases:[],testCounts:{total:0,notRun:0,passed:0,failed:0,blocked:0}}),evidence:async()=>current,create:async(_u:string,_p:string,_r:string,_type:string,_content:string,_model:string,source:unknown)=>{savedSnapshot=source;return{id,sourceSnapshot:source};}} as unknown as DocumentStore;
 const app=Fastify();await registerDocumentRoutes(app,store,docs,config,async()=>{current={...current,caseRevision:3};return '# 合成草稿';});t.after(()=>app.close());
 const response=await app.inject({method:'POST',url:`/projects/${project}/documents/generate`,headers,payload:{type:'test_report'}});
 assert.equal(response.statusCode,201);assert.equal(response.json().document.sourceSnapshot.caseRevision,2);assert.equal(response.json().evidence.caseRevision,3);assert.deepEqual(savedSnapshot,snapshot);
});


test('document context queries are scoped to owner, project and requirement and preserve real counts', async () => {
  const calls: {sql:string;values:unknown[]}[]=[];
  let released=false;
  const client={release:()=>{released=true;},query:async(sql:string,values:unknown[])=>{
    calls.push({sql,values});
    if (sql.includes('practice_test_cases')) return {rows:[{title:'边界',category:'boundary',result:'not_run',executionNote:'',executedAt:null,total:'70',notRun:'68',passed:'1',failed:'1',blocked:'0'}]};
    return {rows:[{id,title:'任务',stage:'开发',status:'done',description:'完整说明',deliverable:'验收产物',total:'51'}]};
  }};
  const { PgDocumentStore }=await import('./store.js');
  const context=await new PgDocumentStore({connect:async()=>client} as never).getContext('owner',project,requirement);
  assert.deepEqual(context.testCounts,{total:70,notRun:68,passed:1,failed:1,blocked:0});
  assert.equal(context.testCases[0].result,'not_run');
  assert.equal(context.taskCount,51);assert.equal(context.tasks[0].id,id);assert.equal(context.tasks[0].description,'完整说明');
  assert.equal(calls.length,5);assert.equal(calls[0].sql,'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');assert.equal(calls.at(-1)?.sql,'COMMIT');assert.ok(released);
  for(const call of calls.filter(call=>call.values)){ assert.deepEqual(call.values,['owner',project,requirement]); assert.match(call.sql,/p\.owner_id=\$1/);assert.match(call.sql,call.sql.includes('statement_timestamp')?/r\.id=\$3/:/requirement_version_id=\$3/); }
  assert.ok(calls.some(call=>call.sql.includes("a.status='confirmed'")));
});

test('document model context retains complete execution notes and actual task/case identifiers',async t=>{
 let captured='';const note='人工登记上下文。'.repeat(70)+'末尾限制：仅本地合成替身通过，真实模型与公网部署未验证。';
 const docs={getContext:async()=>({taskCount:1,tasks:[{id:other,title:'合成任务',stage:'测试',status:'done',description:'完整任务说明',deliverable:'人工审核证据'}],testCases:[{id,revision:3,title:'合成用例',category:'normal',preconditions:'独立账号',steps:'执行实际操作',expected:'满足当前需求',result:'passed',executionNote:note,executedAt:new Date()}],testCounts:{total:1,notRun:0,passed:1,failed:0,blocked:0}}),evidence:async()=>null,create:async()=>({id})} as unknown as DocumentStore;
 const app=Fastify();await registerDocumentRoutes(app,store,docs,config,async(_config,messages)=>{captured=messages[1].content;return '# 合成报告';});t.after(()=>app.close());
 const response=await app.inject({method:'POST',url:`/projects/${project}/documents/generate`,headers,payload:{type:'test_report'}});
 assert.equal(response.statusCode,201);assert.ok(captured.includes(note));assert.ok(captured.includes(other));assert.ok(captured.includes(id));assert.match(captured,/完整任务说明/);assert.match(captured,/执行实际操作/);
});

test('incomplete document details are blocked before model calls or writes instead of presenting a complete report',async t=>{
 for(const kind of ['task','case']){
  let calls=0,writes=0;
  const docs={getContext:async()=>({taskCount:kind==='task'?51:0,tasks:kind==='task'?Array.from({length:50},()=>({title:'合成',stage:'测试',status:'todo'})):[],testCases:kind==='case'?Array.from({length:50},()=>({title:'合成',category:'normal',result:'not_run',executionNote:'',executedAt:null})):[],testCounts:{total:kind==='case'?51:0,notRun:kind==='case'?51:0,passed:0,failed:0,blocked:0}}),create:async()=>{writes++;return{id};},evidence:async()=>null} as unknown as DocumentStore;
  const app=Fastify();await registerDocumentRoutes(app,store,docs,config,async()=>{calls++;return '# 未完整';});t.after(()=>app.close());
  const response=await app.inject({method:'POST',url:`/projects/${project}/documents/generate`,headers,payload:{type:'test_report'}});
  assert.equal(response.statusCode,413);assert.equal(response.json().error,'document_context_incomplete');assert.equal(response.json().maximumDetailItems,50);assert.equal(calls,0);assert.equal(writes,0);
 }
});

test('oversized full document evidence blocks generation and does not consume model-attempt rate quota',async t=>{
 let oversized=true,calls=0,writes=0;
 const docs={getContext:async()=>({taskCount:0,tasks:[],testCases:oversized?Array.from({length:20},()=>({title:'合成记录',category:'normal',result:'blocked',executionNote:'完整说明'.repeat(500),executedAt:new Date()})):[],testCounts:{total:oversized?20:0,notRun:0,passed:0,failed:0,blocked:oversized?20:0}}),create:async()=>{writes++;return{id};},evidence:async()=>null} as unknown as DocumentStore;
 const app=Fastify();await registerDocumentRoutes(app,store,docs,config,async()=>{calls++;return '# 合成报告';});t.after(()=>app.close());
 for(let attempt=0;attempt<6;attempt++){
  const response=await app.inject({method:'POST',url:`/projects/${project}/documents/generate`,headers,payload:{type:'summary'}});
  assert.equal(response.statusCode,413);assert.equal(response.json().error,'document_context_too_large');assert.equal(response.json().maxCharacters,30000);
 }
 assert.equal(calls,0);assert.equal(writes,0);oversized=false;
 assert.equal((await app.inject({method:'POST',url:`/projects/${project}/documents/generate`,headers,payload:{type:'summary'}})).statusCode,201);assert.equal(calls,1);assert.equal(writes,1);
});

test('exactly fifty complete short records remain eligible rather than being treated as truncated',async t=>{
 let calls=0;
 const docs={getContext:async()=>({taskCount:50,tasks:Array.from({length:50},(_,i)=>({title:`合成任务${i}`,stage:'开发',status:'todo'})),testCases:Array.from({length:50},(_,i)=>({title:`合成用例${i}`,category:'normal',result:'not_run',executionNote:'',executedAt:null})),testCounts:{total:50,notRun:50,passed:0,failed:0,blocked:0}}),create:async()=>({id}),evidence:async()=>null} as unknown as DocumentStore;
 const app=Fastify();await registerDocumentRoutes(app,store,docs,config,async(_config,messages)=>{calls++;assert.ok(messages[1].content.includes('合成任务49'));assert.ok(messages[1].content.includes('合成用例49'));return '# 完整合成草稿';});t.after(()=>app.close());
 const response=await app.inject({method:'POST',url:`/projects/${project}/documents/generate`,headers,payload:{type:'summary'}});assert.equal(response.statusCode,201);assert.equal(calls,1);
});
