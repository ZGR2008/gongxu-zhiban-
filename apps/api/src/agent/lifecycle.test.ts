import {test} from 'node:test';
import assert from 'node:assert/strict';
import {executionLease,finishInterruptedRuns,AgentStopError} from './lifecycle.js';

test('lease loss and checkpoint errors stop waiting without launching another model call',async()=>{
 for(const failure of ['missing','database']){
  let pulses=0,calls=0;
  const lease=executionLease({query:async()=>{pulses++;if(failure==='database')throw Error('private connection details');return{rows:[]};}} as never,'fixture',{heartbeatMs:5,deadlineMs:100});
  const keepAlive=setTimeout(()=>{},300);
  try{await assert.rejects(lease.guard(async()=>{calls++;return new Promise(()=>{});}),{code:failure==='missing'?'agent_interrupted':'agent_checkpoint_failed'});assert.equal(calls,1);assert.equal(pulses,1);}
  finally{lease.dispose();clearTimeout(keepAlive);}
 }
});
test('overall deadline and explicit cancellation reject late model results',async()=>{
 for(const reason of ['deadline','cancel']){
  const lease=executionLease({query:async()=>({rows:[{id:'fixture'}]})} as never,'fixture',{heartbeatMs:1000,deadlineMs:20});
  let complete!:(value:string)=>void;
  const pending=lease.guard(()=>new Promise<string>(resolve=>{complete=resolve;}));const keepAlive=setTimeout(()=>{},300);
  try{
   await new Promise(resolve=>setTimeout(resolve,1));if(reason==='cancel')lease.stop(new AgentStopError('agent_cancelled'));
   await assert.rejects(pending,{code:reason==='deadline'?'agent_deadline_exceeded':'agent_cancelled'});complete('late output');
   let called=false;await assert.rejects(lease.guard(async()=>{called=true;return 'must not call';}));assert.equal(called,false);
  }finally{lease.dispose();clearTimeout(keepAlive);}
 }
});
test('recovery query scopes the project and updates only running records',async()=>{
 const calls:{sql:string;values:unknown[]}[]=[];
 await finishInterruptedRuns({query:async(sql:string,values:unknown[])=>{calls.push({sql,values});return{rows:[]};}} as never,'owned-project');
 assert.deepEqual(calls[0].values,['owned-project',null]);assert.match(calls[0].sql,/project_id=\$1 AND status='running'/);assert.match(calls[0].sql,/90 seconds/);assert.match(calls[0].sql,/s.status='running'/);assert.match(calls[0].sql,/t.status='running'/);assert.doesNotMatch(calls[0].sql,/DELETE|INSERT/);
});
