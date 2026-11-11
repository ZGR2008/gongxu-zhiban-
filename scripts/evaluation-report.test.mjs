import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildEvaluationReport} from '../evaluation/report.mjs';
const dataset = JSON.parse(await readFile(new URL('../evaluation/cases.v1.json', import.meta.url), 'utf8'));
const template = JSON.parse(await readFile(new URL('../evaluation/record-template.json', import.meta.url), 'utf8'));
// Synthetic records ONLY, created to test accounting rules, not model performance.
function fixture(pipeline = 'plain_chat') {
  return {...structuredClone(template), caseId: 'normal', pipeline, status: 'completed', provenance: 'real_model',
    commit: 'a'.repeat(40), model: 'REVIEW_PLACEHOLDER_575a8dfc08a84f40bc3b-test-model', modelVersion: 'fixture-1', inputHash: 'a'.repeat(64), knowledgeHash: 'b'.repeat(64), outputHash: 'c'.repeat(64),
    executedAt: '2026-11-01T00:00:00Z', settings: {temperature: .3, maxOutputTokens: 4096, timeoutMs: 60000, maxRetries: 1},
    reviewers: ['reviewer_A', 'reviewer_B'], citedClaimCount: 0,
    conditionJudgments: dataset.cases[0].acceptance.map((text, i) => ({id: `normal:${i + 1}`, text, judgment: 'covered', outputEvidence: 'REVIEW_PLACEHOLDER_575a8dfc08a84f40bc3b output excerpt', note: 'REVIEW_PLACEHOLDER_575a8dfc08a84f40bc3b review note', reviewerCodes: ['reviewer_A', 'reviewer_B']}))};
}
const triple = () => ['plain_chat', 'pre_optimization', 'current_workflow'].map(fixture);
const normal = report => report.comparisons.find(row => row.caseId === 'normal');

test('pending input has no fabricated coverage, timing, usage or improvements', () => {
  const report = buildEvaluationReport([template], dataset);
  assert.equal(report.totals.not_executed, 1);
  assert.equal(report.evaluated[0].coverage, null);
  assert.equal(report.evaluated[0].measures.providerUsage.totalTokens, null);
  assert.ok(report.comparisons.every(row => row.status === 'not_comparable' && row.metrics === null));
});
test('reviewed records calculate omissions with undecidable conditions separate', () => {
  const records = triple();
  records[2].conditionJudgments[0].judgment = 'omitted';
  records[2].conditionJudgments[1].judgment = 'undecidable';
  const row = normal(buildEvaluationReport(records, dataset));
  assert.equal(row.status, 'comparable_reviewed_records');
  assert.equal(row.metrics[2].coverage.omissionRate, 1);
  assert.equal(row.metrics[2].coverage.counts.undecidable, 1);
  records[2].conditionJudgments[0].judgment = 'undecidable';
  assert.equal(normal(buildEvaluationReport(records, dataset)).metrics[2].coverage.omissionRate, null);
});
test('missing judgments, quotes, two reviewers and contradictory totals block comparison', () => {
  for (const modify of [r => r.conditionJudgments.pop(), r => r.conditionJudgments[0].outputEvidence = '', r => r.conditionJudgments[0].reviewerCodes = ['reviewer_A'], r => r.omittedConditions = 2, r => r.conditionJudgments[1].id = 'normal:1']) {
    const records = triple(); modify(records[2]); const row = normal(buildEvaluationReport(records, dataset));
    assert.equal(row.status, 'not_comparable'); assert.ok(row.reasons.includes('condition_review_incomplete'));
  }
});
test('different input, knowledge, model or settings cannot be compared', () => {
  for (const modify of [r => r.inputHash = 'f'.repeat(64), r => r.knowledgeHash = 'f'.repeat(64), r => r.model = 'different-fixture', r => r.modelVersion = null, r => r.settings.maxRetries = 2, r => r.datasetVersion = 'unknown']) {
    const records = triple(); modify(records[2]); assert.equal(normal(buildEvaluationReport(records, dataset)).status, 'not_comparable');
  }
});
test('failure and policy blocks keep actual elapsed time and are never scored as answers', () => {
  const records = triple(); records[0].status = 'failed'; records[0].timingsMs.total = 1234; records[1].status = 'policy_blocked';
  const report = buildEvaluationReport(records, dataset);
  assert.equal(report.totals.failed, 1); assert.equal(report.totals.policy_blocked, 1);
  assert.equal(report.evaluated[0].measures.timingsMs.total, 1234); assert.equal(report.evaluated[0].coverage, null);
  assert.equal(normal(report).metrics, null);
});
test('citation presence alone is insufficient; original claim and source judgment are required', () => {
  const records = triple(); records[2].citedClaimCount = 1; records[2].citationJudgments = [{id: 'source-1', judgment: 'supported'}];
  assert.equal(normal(buildEvaluationReport(records, dataset)).status, 'not_comparable');
  Object.assign(records[2].citationJudgments[0], {claim: 'REVIEW_PLACEHOLDER_575a8dfc08a84f40bc3b claim', sourceExcerpt: 'REVIEW_PLACEHOLDER_575a8dfc08a84f40bc3b source', note: 'REVIEW_PLACEHOLDER_575a8dfc08a84f40bc3b rationale', reviewerCodes: ['reviewer_A', 'reviewer_B']});
  assert.equal(normal(buildEvaluationReport(records, dataset)).metrics[2].citations.counts.supported, 1);
});
test('duplicates and fixture provenance cannot masquerade as comparable real model runs', () => {
  const records = triple(); records[2].provenance = 'controlled_fixture';
  assert.equal(normal(buildEvaluationReport(records, dataset)).status, 'not_comparable');
  const duplicate = triple(); duplicate.push(fixture());
  assert.ok(normal(buildEvaluationReport(duplicate, dataset)).reasons.includes('duplicate_plain_chat'));
});
test('invalid usage stays unknown and raw content is absent from the aggregate report', () => {
  const record = fixture(); record.providerUsage = {inputTokens: -1, outputTokens: 2.5}; record.timingsMs.model = '100';
  record.conditionJudgments[0].outputEvidence = 'PRIVATE_SYNTHETIC_SENTINEL';
  const report = buildEvaluationReport([record], dataset);
  assert.equal(report.evaluated[0].measures.providerUsage.inputTokens, null);
  assert.equal(report.evaluated[0].measures.providerUsage.outputTokens, null);
  assert.equal(report.evaluated[0].measures.timingsMs.model, null);
  assert.ok(!JSON.stringify(report).includes('PRIVATE_SYNTHETIC_SENTINEL'));
});
