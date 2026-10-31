import {test} from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import type {Pool} from 'pg';
import type {ProjectStore} from '../project-store.js';
import {registerPracticeRoutes} from './routes.js';

const project='11111111-1111-4111-8111-111111111111', version='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', other='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const headers={authorization:`Bearer ${'a'.repeat(64)}`};
const store={userBySession:async()=>({id:other}),getProject:async()=>({id:project})} as unknown as ProjectStore;
const summary={requirementVersionId:version,requirementVersion:2,caseRevision:201,capturedAt:'2026-11-01T00:00:00Z',total:201,passed:200,failed:1,blocked:0,notRun:0};
function fixture(){
 const queries:string[]=[];let released=0;
 const rows=Array.from({length:51},(_,i)=>({id:`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,requirementVersionId:version,result:'passed'}));
 const query=async(sql:string)=>{queries.push(sql);return {rows:sql.includes('COUNT(*)')?[summary]:sql.includes('FROM requirement_versions r')?[summary]:sql.includes('FROM practice_test_cases')?rows:[]};};
 const pool={query,connect:async()=>({query,release:()=>released++})} as unknown as Pool;
 return {pool,queries,released:()=>released};
}
test('listing exposes full totals even when the first page contains only passed cases',async t=>{
 const f=fixture(),app=Fastify();await registerPracticeRoutes(app,store,f.pool);t.after(()=>app.close());
 const r=await app.inject({url:`/projects/${project}/test-cases`,headers});assert.equal(r.statusCode,200);
 assert.equal(r.json().summary?.total,201);assert.equal(r.json().summary.failed,1);assert.equal(r.json().cases.length,50);
 assert.equal(r.json().page.hasMore,true);assert.ok(r.json().page.nextCursor);assert.equal(f.queries[0],'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');assert.equal(f.queries.at(-1),'COMMIT');assert.equal(f.released(),1);
});
test('summary-only reading keeps all-version counts without downloading case bodies',async t=>{
 const f=fixture(),app=Fastify();await registerPracticeRoutes(app,store,f.pool);t.after(()=>app.close());
 const r=await app.inject({url:`/projects/${project}/test-cases?summaryOnly=true`,headers});assert.equal(r.statusCode,200);assert.deepEqual(r.json().cases,[]);assert.equal(r.json().summary.total,201);assert.equal(r.json().page.nextCursor,null);
 assert.equal(f.queries.some(sql=>sql.includes('preconditions')),false);
});
test('invalid page bounds, malformed and foreign cursors fail before any page is read',async t=>{
 const f=fixture(),app=Fastify();await registerPracticeRoutes(app,store,f.pool);t.after(()=>app.close());
 for(const q of ['limit=0','limit=201','limit=1.5','cursor=wrong','cursor='+'x'.repeat(800),'summaryOnly=false&unexpected=1'])assert.equal((await app.inject({url:`/projects/${project}/test-cases?${q}`,headers})).statusCode,400,q);
 assert.equal(f.queries.length,0);
});
