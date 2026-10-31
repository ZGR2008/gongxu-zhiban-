import {test} from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import type {Pool} from 'pg';
import type {ProjectStore} from '../project-store.js';
import {PgDocumentStore} from './store.js';
import {registerDocumentRoutes} from './routes.js';
const project='11111111-1111-4111-8111-111111111111',version='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const headers={authorization:`Bearer ${'a'.repeat(64)}`},owner='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const source={requirementVersionId:version,requirementVersion:1,taskRevision:0,caseRevision:0,traceRevision:0,documentRevision:101,capturedAt:'2026-11-01T00:00:00Z'};
const projects={userBySession:async()=>({id:owner}),getProject:async()=>({id:project})} as unknown as ProjectStore;
function database(){
 const calls:string[]=[];const documents=Array.from({length:101},(_,i)=>({id:`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,projectId:project,requirementVersionId:version,type:i===100?'api':'readme',content:'合成正文',revision:1}));
 const query=async(sql:string)=>{calls.push(sql);if(sql.includes('statement_timestamp'))return{rows:[source]};if(sql.includes('catalogRevision'))return{rows:[{total:101,catalogRevision:101}]};if(sql.includes('DISTINCT ON'))return{rows:[documents[0],documents[100]].map(({content:_,...doc})=>doc)};if(sql.includes('FROM project_documents'))return{rows:documents.slice(0,sql.includes('LIMIT 100')?100:21)};return{rows:[]};};
 return{pool:{query,connect:async()=>({query,release:()=>{}})} as unknown as Pool,calls};
}
test('document catalogue pagination declares complete count and a bounded continuation',async t=>{
 const f=database(),app=Fastify();await registerDocumentRoutes(app,projects,new PgDocumentStore(f.pool));t.after(()=>app.close());
 const r=await app.inject({url:`/projects/${project}/documents?limit=20`,headers});assert.equal(r.statusCode,200);assert.equal(r.json().page?.total,101);assert.equal(r.json().documents.length,20);assert.ok(r.json().page.nextCursor);assert.equal(r.json().summaryComplete,false);assert.equal(f.calls[0],'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');assert.equal(f.calls.at(-1),'COMMIT');
});
test('complete current-type summary includes an older type without sending full document text',async t=>{
 const f=database(),app=Fastify();await registerDocumentRoutes(app,projects,new PgDocumentStore(f.pool));t.after(()=>app.close());
 const r=await app.inject({url:`/projects/${project}/documents?summaryOnly=true`,headers});assert.equal(r.statusCode,200);assert.equal(r.json().summaryComplete,true);assert.deepEqual(r.json().documents.map((d:{type:string})=>d.type),['readme','api']);assert.ok(r.json().documents.every((d:object)=>!('content'in d)));assert.equal(r.json().evidence.requirementVersionId,version);
});
