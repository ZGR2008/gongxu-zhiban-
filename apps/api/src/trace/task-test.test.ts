import {test} from 'node:test';
import assert from 'node:assert/strict';
import {taskTestEvidence,type TaskTestLink} from './task-test.js';
import type {EvidenceLink,EvidenceCase} from './domain.js';
const pair:TaskTestLink={id:'pair',itemId:'item',taskId:'task',caseId:'case',caseRevision:1,status:'confirmed',reviewNote:'人工核对',reviewedAt:'2026-11-01T00:00:00Z'};
const links:EvidenceLink[]=[{itemId:'item',taskId:'task',caseId:null,caseRevision:null,status:'confirmed'},{itemId:'item',taskId:null,caseId:'case',caseRevision:1,status:'confirmed'}];
const passed:EvidenceCase={id:'case',revision:1,result:'passed',executionNote:'合成执行记录',executedAt:'2026-11-01T00:00:00Z'};
test('a task-test pair only exposes manual evidence with reviewed source links and current definition',()=>{
 assert.deepEqual(taskTestEvidence(pair,links,[passed]),{state:'manual_pass_record',manualEvidence:true});
 assert.equal(taskTestEvidence(pair,links.map(l=>({...l,status:'suggested'})),[passed]).state,'source_review_required');
 assert.equal(taskTestEvidence(pair,links,[{...passed,revision:2}]).state,'stale_case');
 assert.equal(taskTestEvidence(pair,links,[{...passed,executionNote:' '}]).state,'missing_evidence');
 assert.equal(taskTestEvidence(pair,links,[{...passed,executedAt:null}]).state,'not_run');
 assert.equal(taskTestEvidence({...pair,status:'rejected'},links,[passed]).manualEvidence,false);
 assert.equal(taskTestEvidence(pair,links,[{...passed,result:'failed'}]).state,'manual_fail_record');
 assert.equal(taskTestEvidence(pair,links,[{...passed,result:'blocked'}]).manualEvidence,false);
});
