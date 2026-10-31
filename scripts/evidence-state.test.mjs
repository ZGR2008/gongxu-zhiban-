import {test} from 'node:test';
import assert from 'node:assert/strict';
import {documentEvidence,evidenceStamp,manualCheckFresh} from '../apps/web/src/components/evidence-state.ts';
import {readDelivery,blankDelivery} from '../apps/web/src/pages/workbench-data.ts';
const snapshot={requirementVersionId:'current',requirementVersion:2,taskRevision:3,caseRevision:7,traceRevision:4,documentRevision:1,capturedAt:'2026-11-01T00:00:00+08:00'};
test('missing evidence never infers document validity from creation time',()=>{
 assert.equal(documentEvidence({requirementVersionId:'current'},snapshot).status,'unknown');
 assert.equal(documentEvidence({requirementVersionId:'current',sourceSnapshot:snapshot},null).status,'unavailable');
 assert.equal(documentEvidence({requirementVersionId:'old',sourceSnapshot:snapshot},snapshot).status,'historical');
});
test('document freshness checks tasks, tests and human associations, not its own save counter',()=>{
 const doc={requirementVersionId:'current',sourceSnapshot:snapshot};
 assert.equal(documentEvidence(doc,{...snapshot,documentRevision:100}).status,'current');
 for(const field of ['taskRevision','caseRevision','traceRevision'])assert.equal(documentEvidence(doc,{...snapshot,[field]:snapshot[field]+1}).status,'changed');
 assert.equal(documentEvidence(doc,{...snapshot,caseRevision:6}).status,'changed');
});
test('manual checklist retains old notes but old evidence cannot count as current approval',()=>{
 const record=blankDelivery(),stamp=evidenceStamp(snapshot,'tests');
 record.items.tests={status:'checked',note:'先前已核对的真实备注',evidenceStamp:stamp};
 const loaded=readDelivery(JSON.stringify(record));assert.equal(loaded.items.tests.note,record.items.tests.note);
 assert.equal(manualCheckFresh('checked',loaded.items.tests.evidenceStamp,stamp),true);
 assert.equal(manualCheckFresh('checked',loaded.items.tests.evidenceStamp,evidenceStamp({...snapshot,caseRevision:8},'tests')),false);
 assert.equal(manualCheckFresh('checked',undefined,stamp),false);assert.equal(manualCheckFresh('checked',null,null),false);
});
test('unrelated changes do not invalidate requirement or test-only acknowledgements',()=>{
 assert.equal(evidenceStamp(snapshot,'tests'),evidenceStamp({...snapshot,documentRevision:12},'tests'));
 assert.equal(evidenceStamp(snapshot,'requirements'),evidenceStamp({...snapshot,taskRevision:100},'requirements'));
 assert.notEqual(evidenceStamp(snapshot,'documents'),evidenceStamp({...snapshot,documentRevision:12},'documents'));
 assert.notEqual(evidenceStamp(snapshot,'tests'),evidenceStamp({...snapshot,traceRevision:5},'tests'));
});
