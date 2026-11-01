import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assertTransition, snapshotDigest, teachingGaps} from './domain.js';

test('return then resubmit is explicit; accept is not a test execution',()=>{
 assert.doesNotThrow(()=>assertTransition('working','submit'));
 assert.doesNotThrow(()=>assertTransition('returned','submit'));
 assert.doesNotThrow(()=>assertTransition('submitted','return'));
 assert.doesNotThrow(()=>assertTransition('submitted','accept'));
 for(const state of ['submitted','accepted'])assert.throws(()=>assertTransition(state,'submit'));
 for(const state of ['working','returned','accepted'])assert.throws(()=>assertTransition(state,'accept'));
});
test('evidence snapshot fingerprint is deterministic and changes on execution revision',()=>{
 const before={cases:[{id:'case',result:'passed',execution_revision:1}]};
 assert.equal(snapshotDigest(before),snapshotDigest(structuredClone(before)));
 assert.notEqual(snapshotDigest(before),snapshotDigest({cases:[{id:'case',result:'passed',execution_revision:2}]}));
});
test('missing and unchecked evidence stays visible instead of counting links as validation',()=>{
 const gaps=teachingGaps({tasks:[],cases:[],documents:[],items:[{id:'a'}],links:[],chains:[]});
 assert.ok(gaps.some(x=>x.code==='no_tasks'));assert.ok(gaps.some(x=>x.code==='no_tests'));assert.ok(gaps.some(x=>x.code==='unverified_requirements'));
 const linked=teachingGaps({tasks:[{id:'t'}],cases:[{id:'c',revision:1,result:'passed',execution_note:'',execution_revision:1}],documents:[],items:[{id:'a'}],links:[{item_id:'a',case_id:'c',status:'confirmed',case_revision:1}],chains:[]});
 assert.ok(linked.some(x=>x.code==='unverified_requirements'));
});

test('a document from the same requirement can still have obsolete test evidence',()=>{
 const input={tasks:[],cases:[],items:[],links:[],chains:[],documents:[{source_snapshot:{requirementVersionId:'r',taskRevision:2,caseRevision:4,traceRevision:1}}],evidence:{requirementVersionId:'r',taskRevision:2,caseRevision:5,traceRevision:1}};
 assert.equal(teachingGaps(input).find(g=>g.code==='documents_need_review')?.count,1);
 assert.equal(teachingGaps({...input,documents:[{source_snapshot:null}]}).find(g=>g.code==='documents_need_review')?.count,1);
 assert.ok(!teachingGaps({...input,documents:[{source_snapshot:input.evidence}]}).some(g=>g.code==='documents_need_review'));
});
