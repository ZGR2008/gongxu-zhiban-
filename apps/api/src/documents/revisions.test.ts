import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import type { ProjectStore } from '../project-store.js';
import { PgDocumentStore } from './store.js';
import { registerDocumentRoutes } from './routes.js';

const project='11111111-1111-4111-8111-111111111111';
const id='22222222-2222-4222-8222-222222222222';
const headers={authorization:`Bearer ${'a'.repeat(64)}`};
const projects={userBySession:async()=>({id:'owner'}),getProject:async()=>({id:project})} as unknown as ProjectStore;

test('document save requires a revision and never issues an unguarded write',async t=>{
 const calls:string[]=[];
 const docs=new PgDocumentStore({query:async(sql:string)=>{calls.push(sql);return {rows:[{id,revision:2,content:'latest'}]};}} as never);
 const app=Fastify();await registerDocumentRoutes(app,projects,docs);t.after(()=>app.close());
 const response=await app.inject({method:'PATCH',url:`/projects/${project}/documents/${id}`,headers,payload:{content:'stale edit'}});
 assert.equal(response.statusCode,428);assert.equal(response.json().error,'document_revision_required');assert.equal(calls.length,0);
});

test('stale document revision returns conflict without overwriting content',async t=>{
 const calls:{sql:string;values:unknown[]}[]=[];
 const docs=new PgDocumentStore({query:async(sql:string,values:unknown[])=>{calls.push({sql,values});return {rows:sql.startsWith('UPDATE')?[]:[{id,revision:2,content:'latest'}]};}} as never);
 const app=Fastify();await registerDocumentRoutes(app,projects,docs);t.after(()=>app.close());
 const response=await app.inject({method:'PATCH',url:`/projects/${project}/documents/${id}`,headers,payload:{content:'stale edit',expectedRevision:1}});
 assert.equal(response.statusCode,409);assert.equal(response.json().error,'document_conflict');assert.equal(response.json().currentRevision,2);
 assert.match(calls[0].sql,/d\.revision=\$5/);assert.deepEqual(calls[0].values,['owner',project,id,'stale edit',1]);
});

test('document history is owned, cursor bounded, read only and paginated',async t=>{
 const calls:{sql:string;values:unknown[]}[]=[];
 const docs=new PgDocumentStore({query:async(sql:string,values:unknown[])=>{calls.push({sql,values});return {rows:sql.includes('project_document_history')?Array.from({length:21},(_,i)=>({revision:30-i,content:'synthetic history'})):[{id,revision:31}]};}} as never);
 const app=Fastify();await registerDocumentRoutes(app,projects,docs);t.after(()=>app.close());
 const url=`/projects/${project}/documents/${id}/history`;
 assert.equal((await app.inject({method:'GET',url})).statusCode,401);
 assert.equal((await app.inject({method:'GET',url:url+'?beforeRevision=-1',headers})).statusCode,400);
 const response=await app.inject({method:'GET',url:url+'?beforeRevision=31',headers});assert.equal(response.statusCode,200);assert.equal(response.json().history.length,20);assert.equal(response.json().nextCursor,11);
 const query=calls.find(call=>call.sql.includes('project_document_history'))!;assert.deepEqual(query.values,['owner',project,id,31]);assert.match(query.sql,/p\.owner_id=\$1/);assert.match(query.sql,/LIMIT 21/);assert.ok(calls.every(call=>call.sql.startsWith('SELECT')));
});
