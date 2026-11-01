import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Pool } from 'pg';
import { PgProjectStore } from '../project-store.js';

test('requirement confirmation locks its owned project in the transaction before updating', async () => {
  const queries:{sql:string;values:unknown[]}[]=[];
  const client={query:async(sql:string,values:unknown[]=[])=>{
    queries.push({sql,values});
    if (sql.includes('FROM projects')) return {rowCount:1,rows:[{id:'p'}]};
    if (sql.startsWith('SELECT id, project_id')) return {rows:[{id:'r',content:'reviewed',status:'draft'}]};
    if (sql.startsWith('SELECT id FROM requirement_versions')) return {rows:[{id:'r'}]};
    if (sql.startsWith('UPDATE requirement_versions')) return {rows:[{id:'r',status:'confirmed'}]};
    return {rows:[]};
  },release:()=>{}};
  const store=new PgProjectStore({connect:async()=>client} as unknown as Pool);
  const result=await store.confirmRequirement('u','p','r','reviewed');
  assert.equal(result?.status,'confirmed');
  assert.equal(queries[0].sql,'BEGIN');
  assert.match(queries[1].sql,/FROM projects.*FOR UPDATE/);
  assert.deepEqual(queries[1].values,['p','u']);
  assert.match(queries[2].sql,/FROM requirement_versions.*FOR UPDATE/);
  assert.match(queries[3].sql,/ORDER BY version DESC LIMIT 1/);
  assert.match(queries[4].sql,/^UPDATE requirement_versions/);
  assert.equal(queries[5].sql,'COMMIT');
});
