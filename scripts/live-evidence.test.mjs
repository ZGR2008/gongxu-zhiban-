import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {prepareLive, digest} from '../evaluation/live-policy.mjs';
import {bindLiveEvidence} from '../evaluation/live-evidence.mjs';
import {buildEvaluationReport} from '../evaluation/report.mjs';
const template = JSON.parse(await readFile(new URL('../evaluation/record-template.json', import.meta.url), 'utf8'));
const dataset = {version: '1.0.0', cases: [{id: 'normal', acceptance: ['必须回滚']} ]};
function fixture() {
  const frame = {caseId: 'normal', pipeline: 'current_workflow', commit: 'a'.repeat(40),
    status: 'prepared_not_executed', messages: [{role: 'user', content: '合成：必须回滚'}],
    inputHash: digest('input'), knowledgeHash: digest([])};
  const manifest = {datasetVersion: '1.0.0', paidCalls: 0, externalCalls: 0,
    scope: 'production_route_prompt_capture_with_fixed_synthetic_retrieval', frames: [frame]};
  const prepared = prepareLive(manifest), output = '合成响应，仅用于离线测试。';
  const record = {...prepared.calls[0], model: prepared.policy.model, modelVersion: prepared.policy.model,
    settings: {temperature: .3, maxOutputTokens: 4096, thinking: 'disabled'},
    status: 'executed', httpStatus: 200, finishReason: 'stop', output, outputHash: digest(output),
    usage: {inputTokens: 10, outputTokens: 5, totalTokens: 15}, elapsedMs: 100, costEstimateUSD: .000009};
  const live = {policy: prepared.policy, manifestHash: prepared.manifestHash, actualModelCalls: 1,
    startedAt: '2026-11-01T07:19:18Z', finishedAt: '2026-11-01T07:19:19Z', records: [record]};
  return {manifest, live};
}
test('saved outputs remain unjudged; estimates and computed totals never become provider billing', () => {
  const {manifest, live} = fixture();
  const bound = bindLiveEvidence(manifest, live, template, dataset), row = bound.records[0];
  assert.equal(bound.paidCalls, 0); assert.equal(row.status, 'completed');
  assert.equal(row.providerUsage.totalTokens, null); assert.equal(row.providerUsage.cost, null);
  assert.equal(row.derivedUsage.summedTokens, 15); assert.deepEqual(row.reviewers, []);
  assert.equal(row.conditionJudgments[0].judgment, 'unjudged');
  const report = buildEvaluationReport(bound.records, dataset);
  assert.equal(report.evaluated[0].coverage.omissionRate, null);
  assert.equal(report.comparisons[0].status, 'not_comparable');
});
test('changed inputs, outputs, settings, count and duplicate responses cannot bind to approved evidence', () => {
  for (const mutate of [x => x.live.manifestHash = '0'.repeat(64), x => x.live.records[0].output += 'changed',
    x => x.live.records[0].promptHash = '0'.repeat(64), x => x.live.records[0].inputHash = '0'.repeat(64),
    x => x.live.records[0].settings.temperature = .9, x => x.live.actualModelCalls = 0,
    x => {x.live.records.push(x.live.records[0]); x.live.actualModelCalls++;},
    x => x.live.records[0].finishReason = 'length']) {
    const data = fixture(); mutate(data);
    assert.throws(() => bindLiveEvidence(data.manifest, data.live, template, dataset));
  }
});
test('policy block, unattempted calls and incomplete output stay distinct; no synthetic success', () => {
  const {manifest, live} = fixture();
  manifest.frames.push({...manifest.frames[0], pipeline: 'pre_optimization', messages: null,
    status: 'model_not_invoked_by_policy', policy: 'no_source_no_answer'});
  manifest.frames.push({...manifest.frames[0], pipeline: 'plain_chat'});
  live.manifestHash = prepareLive(manifest).manifestHash;
  live.records[0].status = 'incomplete'; live.records[0].finishReason = 'length';
  const rows = bindLiveEvidence(manifest, live, template, dataset).records;
  assert.deepEqual(rows.map(r => r.status), ['failed', 'policy_blocked', 'not_executed']);
});
