import test from 'node:test';
import assert from 'node:assert/strict';
import {recordingKit as kit} from '../demo/recording-kit-v1.mjs';
import {validateRecordingKit,digest} from './recording-import-core.mjs';

test('reviewed kit retains both complete versions, eight clauses and explicit REVIEW_PLACEHOLDER_575a8dfc08a84f40bc3b provenance',()=>{
  const result=validateRecordingKit(kit);assert.equal(result.requirementHash,digest(kit.briefV1));
  for(const brief of [kit.briefV1,kit.briefV2]){
    for(let i=1;i<=8;i++)assert.equal((brief.match(new RegExp(`R0${i}｜`,'g'))??[]).length,1);
    assert.match(brief,/不是.*实际制度/);assert.match(brief,/未执行校园借用程序/);
  }
  assert.match(kit.briefV1,/允许 1 至 7 日/);assert.match(kit.briefV2,/允许 1 至 3 日/);
  assert.ok(kit.documents.find(d=>d.type==='requirements').content.includes(kit.briefV1));
  assert.ok(kit.documents.find(d=>d.type==='design').content.includes(kit.briefV2));
  assert.equal(kit.cases.length,10);assert.equal(kit.documents.length,6);
});
test('import rejects execution claims, duplicate test keys, absent documents and mutated provenance',()=>{
  const copy=()=>structuredClone(kit);
  let bad=copy();bad.cases[0].result='passed';assert.throws(()=>validateRecordingKit(bad),/unexpected_case_state/);
  bad=copy();bad.cases[1].key=bad.cases[0].key;assert.throws(()=>validateRecordingKit(bad),/invalid_cases/);
  bad=copy();bad.documents.pop();assert.throws(()=>validateRecordingKit(bad),/invalid_documents/);
  bad=copy();bad.source='real-model';assert.throws(()=>validateRecordingKit(bad),/invalid_kit/);
});
