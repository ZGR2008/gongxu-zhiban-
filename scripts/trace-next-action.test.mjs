import test from 'node:test';import assert from 'node:assert/strict';
import {traceNextAction} from '../apps/web/src/components/trace-next-action.ts';
const item={id:'current',coverage:{confirmedTasks:1,confirmedCases:1,stale:0,manualEvidence:1}};
const pair={itemId:'current',status:'confirmed',evidence:{state:'manual_pass_record',manualEvidence:true}};
test('links and an unrelated pass never skip task-test pairing or execution evidence',()=>{
 assert.equal(traceNextAction(item,[],true).stage,'pair');
 assert.equal(traceNextAction(item,[{...pair,itemId:'old-version'}],true).stage,'pair');
 assert.equal(traceNextAction(item,[pair,{...pair,evidence:{state:'manual_fail_record',manualEvidence:false}}],true).stage,'execution');
 assert.equal(traceNextAction(item,[pair],true).stage,'delivery');
});
test('stale source and current missing relationships are prioritized; history cannot become an actionable pass',()=>{
 assert.equal(traceNextAction({...item,coverage:{...item.coverage,stale:1}},[pair],true).stage,'review');
 assert.equal(traceNextAction({...item,coverage:{...item.coverage,confirmedTasks:0}},[pair],true).stage,'task');
 assert.equal(traceNextAction({...item,coverage:{...item.coverage,confirmedCases:0}},[pair],true).stage,'case');
 assert.equal(traceNextAction(item,[pair],false).stage,'history');assert.equal(traceNextAction(item,[pair],false).pending,false);
});
