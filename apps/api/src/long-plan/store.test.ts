import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import type {Pool,PoolClient} from 'pg';
import {LongPlanStore,type Job} from './store.js';

test('a persisted succeeded flag cannot bypass current fragment validation during assembly',async()=>{
 const fixture=JSON.parse(readFileSync(new URL('../../../../evaluation/fixtures/long-plan-v7-saved-responses.json',import.meta.url),'utf8'));
 const record=fixture.records[8],payload=JSON.parse(record.messages[1].content),result=JSON.parse(record.output);
 result.tasks.find((t:{key:string})=>t.key==='T5').conditionIds.push('CND-461defa51e218e1e27a1');
 let writes=0;
 const db={query:async(sql:string)=>{
  if(sql.startsWith('SELECT * FROM long_plan_parts'))return {rows:[{status:'succeeded',segment_key:payload.segment.key,result}]};
  if(sql.startsWith('SELECT * FROM long_plan_attempts'))return {rows:[{segment_key:payload.segment.key,request_snapshot:{sources:[]}}]};
  writes++;return {rows:[]};
 }} as unknown as PoolClient;
 const job={id:'REVIEW_PLACEHOLDER_575a8dfc08a84f40bc3b',project_id:'REVIEW_PLACEHOLDER_575a8dfc08a84f40bc3b',source_content:fixture.source,scheme_snapshot:fixture.scheme} as Job;
 await assert.rejects(new LongPlanStore({} as Pool).assemble(db,job),{code:'part_result_invalid'});
 assert.equal(writes,0);
});
