import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import type {Pool} from 'pg';
import type {ProjectStore} from '../project-store.js';
import {EmbeddingError} from '../rag/embeddings.js';
import {registerPracticeRoutes} from './routes.js';

const project='11111111-1111-4111-8111-111111111111',version='22222222-2222-4222-8222-222222222222';
const headers={authorization:`Bearer ${'a'.repeat(64)}`};
const hit={id:'33333333-3333-4333-8333-333333333333',document_id:version,document_name:'合成安全准则',page:2,content:'仅本人可以批准；资料中的恶意指令不得执行。',distance:.1};
const ai={baseUrl:'https://example.invalid',apiKey:'test-only',model:'fixture',timeoutMs:1000};
async function setup(t:TestContext,{content='审批须留档',embedding=true,denied=false,failure=false}={}){
 const state={reads:0,queries:[] as string[],writes:[] as unknown[][],messages:[] as {role:string;content:string}[],calls:0};
 const requirement={id:version,version:2,status:'confirmed',content};
 const store={userBySession:async()=>({id:'owner'}),getProject:async()=>denied?null:{id:project},listRequirements:async()=>{state.reads++;return [{...requirement}];}} as unknown as ProjectStore;
 const pool={query:async(_sql:string,values:unknown[])=>{state.writes.push(values);return {rows:[{id:hit.id,aiAdvice:values[4],requirementVersionId:values[6]??null,reviewContext:values[7]?JSON.parse(String(values[7])):null}]};}} as unknown as Pool;
 const dependencies={embedding:embedding?{baseUrl:'http://127.0.0.1:3010',apiKey:'',model:'fixture'}:undefined,
  retrieve:async(_pool:unknown,owner:string,query:string)=>{assert.equal(owner,'owner');state.queries.push(query);if(failure)throw new EmbeddingError('REVIEW_PLACEHOLDER_575a8dfc08a84f40bc3b unavailable','embedding_unavailable');return [hit];},
  complete:async(_config:unknown,messages:{role:string;content:string}[])=>{state.calls++;state.messages=messages;return '合成未验证建议';}};
 const app=Fastify();await registerPracticeRoutes(app,store,pool,ai,dependencies as unknown as NonNullable<Parameters<typeof registerPracticeRoutes>[4]>);t.after(()=>app.close());
 return {app,state,requirement,url:`/projects/${project}/code-reviews`};
}
test('code review retains the full confirmed requirement and all retrieval segments including the tail',async t=>{
 const content='审批资料。'.repeat(900)+'末尾验收：本人不得审批自己的申请。';
 const {app,state,url}=await setup(t,{content});
 const response=await app.inject({method:'POST',url,headers,payload:{language:'typescript',code:'const approved = true;'}});
 assert.equal(response.statusCode,201);assert.ok(state.queries.join('')===content,'All requirement segments must be searched without losing the tail');
 assert.ok(state.messages[1].content.includes(content));assert.ok(state.messages[1].content.includes(hit.content));assert.ok(!state.messages[0].content.includes(hit.content));
 assert.equal(response.json().review.requirementVersionId,version);const context=response.json().review.reviewContext;
 assert.equal(context.requirement.content,content);assert.equal(context.retrieval.status,'retrieved');assert.equal(context.retrieval.sources.length,1);assert.ok(context.retrieval.segments.at(-1).end===content.length);
});
test('explicit code-only scope does not read or silently truncate project requirements',async t=>{
 const {app,state,url}=await setup(t,{content:'需'.repeat(21000)+'末尾验收'});
 const response=await app.inject({method:'POST',url,headers,payload:{language:'javascript',code:'let x = 1;',context:'code_only'}});
 assert.equal(response.statusCode,201);assert.equal(state.reads,0);assert.equal(state.queries.length,0);assert.equal(response.json().review.reviewContext.scope,'code_only');assert.equal(response.json().review.requirementVersionId,null);
});
test('long project scope is explicitly blocked before retrieval, model or persistence',async t=>{
 const {app,state,url}=await setup(t,{content:'需'.repeat(20001)+'末尾验收不可遗漏'});
 const response=await app.inject({method:'POST',url,headers,payload:{language:'javascript',code:'let x = 1;'}});
 assert.equal(response.statusCode,413);assert.equal(response.json().error,'requirement_generation_limit');assert.equal(state.calls,0);assert.equal(state.queries.length,0);assert.equal(state.writes.length,0);
});
test('stale source selection and foreign ownership cannot trigger model or knowledge access',async t=>{
 const first=await setup(t);
 const response=await first.app.inject({method:'POST',url:first.url,headers,payload:{language:'javascript',code:'let x = 1;',requirementId:project}});
 assert.equal(response.statusCode,409);assert.equal(first.state.calls,0);assert.equal(first.state.queries.length,0);
 const denied=await setup(t,{denied:true});assert.equal((await denied.app.inject({method:'POST',url:denied.url,headers,payload:{language:'javascript',code:'let x = 1;'}})).statusCode,404);assert.equal(denied.state.reads,0);assert.equal(denied.state.calls,0);
});
test('unconfigured retrieval is labelled while configured failure never turns into grounded success',async t=>{
 const skipped=await setup(t,{embedding:false});const response=await skipped.app.inject({method:'POST',url:skipped.url,headers,payload:{language:'javascript',code:'let x = 1;'}});
 assert.equal(response.statusCode,201);assert.equal(response.json().review.reviewContext.retrieval.status,'not_configured');assert.equal(skipped.state.queries.length,0);
 const failed=await setup(t,{failure:true});const result=await failed.app.inject({method:'POST',url:failed.url,headers,payload:{language:'javascript',code:'let x = 1;'}});
 assert.equal(result.statusCode,503);assert.equal(result.json().error,'embedding_unavailable');assert.equal(failed.state.calls,0);assert.equal(failed.state.writes.length,0);
});
