import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from './app.js';
import type {ProjectStore} from './project-store.js';
import {PgProjectStore,RequirementWriteConflict} from './project-store.js';
import type {Pool} from 'pg';

const project='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222';
const root=`/projects/${project}/requirements/${id}`;
const headers={authorization:`Bearer ${'a'.repeat(64)}`};
function fixture(){
 const calls:unknown[][]=[];
 const store={userBySession:async()=>({id:'owner'}),updateRequirement:async(...args:unknown[])=>{calls.push(args);return {id,status:'draft',content:'new'};},confirmRequirement:async(...args:unknown[])=>{calls.push(args);return {id,status:'confirmed',content:'seen'};}} as unknown as ProjectStore;
 return {store,calls};
}
test('requirement update and confirmation require an explicitly reviewed content snapshot',async t=>{
 const {store,calls}=fixture(),app=await createApp({corsOrigin:'http://localhost:5173',projectStore:store});t.after(()=>app.close());
 for(const [method,url,payload] of [['PATCH',root,{content:'new'}],['POST',root+'/confirm',undefined]] as const){
  const response=await app.inject({method,url,headers,...(payload?{payload}:{})});
  assert.equal(response.statusCode,428);assert.equal(response.json().error,'requirement_snapshot_required');
 }
 assert.equal(calls.length,0);
});
test('requirement snapshot is forwarded without trimming and invalid snapshots never reach storage',async t=>{
 const {store,calls}=fixture(),app=await createApp({corsOrigin:'http://localhost:5173',projectStore:store});t.after(()=>app.close());
 const expectedContent='seen\n';
 assert.equal((await app.inject({method:'PATCH',url:root,headers,payload:{content:'new',expectedContent}})).statusCode,200);
 assert.deepEqual(calls[0],['owner',project,id,'new',expectedContent]);
 assert.equal((await app.inject({method:'POST',url:root+'/confirm',headers,payload:{expectedContent}})).statusCode,200);
 assert.deepEqual(calls[1],['owner',project,id,expectedContent]);
 for(const expectedContent of [null,3,'','x'.repeat(50001)])assert.equal((await app.inject({method:'POST',url:root+'/confirm',headers,payload:{expectedContent}})).statusCode,400);
 assert.equal(calls.length,2);
});
test('draft snapshot and latest-version conflicts roll back without a write',async()=>{
 for(const [seen,latest,expected] of [['outdated',id,'requirement_content_changed'],['saved','newer','requirement_newer_draft_exists']] as const){
  const queries:string[]=[];let released=false;
  const client={query:async(sql:string)=>{
   queries.push(sql);
   if(sql.includes('FROM projects'))return {rowCount:1,rows:[{id:project}]};
   if(sql.startsWith('SELECT id, project_id'))return {rows:[{id,content:'saved',status:'draft'}]};
   if(sql.startsWith('SELECT id FROM requirement_versions'))return {rows:[{id:latest}]};
   return {rows:[]};
  },release:()=>{released=true;}};
  const store=new PgProjectStore({connect:async()=>client} as unknown as Pool);
  await assert.rejects(store.confirmRequirement('owner',project,id,seen),error=>error instanceof RequirementWriteConflict&&error.code===expected);
  assert.ok(!queries.some(sql=>sql.startsWith('UPDATE')));assert.equal(queries.at(-1),'ROLLBACK');assert.ok(released);
 }
});
test('draft no-op keeps the same record while foreign and confirmed records are never editable',async()=>{
 for(const mode of ['noop','foreign','confirmed'] as const){
  const queries:string[]=[];const row={id,content:'saved',status:mode==='confirmed'?'confirmed':'draft'};
  const client={query:async(sql:string)=>{
   queries.push(sql);
   if(sql.includes('FROM projects'))return {rowCount:mode==='foreign'?0:1,rows:mode==='foreign'?[]:[{id:project}]};
   if(sql.startsWith('SELECT id, project_id'))return {rows:[row]};
   return {rows:[]};
  },release:()=>{}};
  const store=new PgProjectStore({connect:async()=>client} as unknown as Pool),result=await store.updateRequirement('owner',project,id,'saved','saved');
  assert.deepEqual(result,mode==='noop'?row:null);assert.ok(!queries.some(sql=>sql.startsWith('UPDATE')));
  assert.equal(queries.at(-1),mode==='noop'?'COMMIT':'ROLLBACK');
 }
});
test('snapshot conflicts are explicit HTTP errors without returning the unseen original',async t=>{
 const {store}=fixture();store.confirmRequirement=async()=>{throw new RequirementWriteConflict('requirement_content_changed');};
 const app=await createApp({corsOrigin:'http://localhost:5173',projectStore:store});t.after(()=>app.close());
 const response=await app.inject({method:'POST',url:root+'/confirm',headers,payload:{expectedContent:'read before'}});
 assert.equal(response.statusCode,409);assert.deepEqual(response.json(),{error:'requirement_content_changed'});
});
