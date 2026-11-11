import {readFile, writeFile, mkdir, realpath, stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve, relative, join} from 'node:path';
import {createRequire} from 'node:module';
import {createHash, randomUUID} from 'node:crypto';
import {bindLiveEvidence} from '../evaluation/live-evidence.mjs';
import {digest} from '../evaluation/live-policy.mjs';
import {buildEvaluationReport} from '../evaluation/report.mjs';
import {validatePlan} from '../apps/api/dist/agent/validate.js';
import {requirementItems, assessPlan} from '../apps/api/dist/trace/domain.js';
import {registerKnowledgeRoutes} from '../apps/api/dist/rag/routes.js';

// Replays saved outputs through current validators. No dotenv, real storage,
// remote embedding, tools or new model execution. Raw outputs stay in .runtime.
globalThis.fetch = async () => { throw Error('Network prohibited during saved-output audit'); };
const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const names = ['prepared', 'report', 'current-prepared'];
if (args.length !== 3 || names.some(name => args.filter(a => a.startsWith('--' + name + '=')).length !== 1)) {
  throw Error('Use --prepared=<approved manifest> --report=<saved live report> --current-prepared=<fresh offline manifest>');
}
async function load(name, pattern) {
  const arg = args.find(a => a.startsWith('--' + name + '='));
  const file = await realpath(resolve(root, arg.slice(name.length + 3)));
  const rel = relative(root, file).replaceAll('\\', '/');
  if (!pattern.test(rel) || (await stat(file)).size > 2_000_000) throw Error('Only bounded local REVIEW_PLACEHOLDER_575a8dfc08a84f40bc3b reports accepted');
  const bytes = await readFile(file);
  return {data: JSON.parse(bytes.toString('utf8')), path: rel, sha256: createHash('sha256').update(bytes).digest('hex')};
}
const prepPattern = /^\.runtime\/evaluation-prepared-[a-f0-9-]+\/prepared-inputs\.json$/;
const prepared = await load('prepared', prepPattern);
const live = await load('report', /^\.runtime\/evaluation-live-v4-[a-f0-9-]+\/report\.json$/);
const current = await load('current-prepared', prepPattern);
const dataset = JSON.parse(await readFile(join(root, 'evaluation/cases.v1.json'), 'utf8'));
const template = JSON.parse(await readFile(join(root, 'evaluation/record-template.json'), 'utf8'));
const bound = bindLiveEvidence(prepared.data, live.data, template, dataset);
const accounting = buildEvaluationReport(bound.records, dataset);
const promptComparison = prepared.data.frames.filter(f => f.pipeline).map(frame => {
  const next = current.data.frames.find(f => f.caseId === frame.caseId && f.pipeline === frame.pipeline);
  return {caseId: frame.caseId, pipeline: frame.pipeline, sameMessages: Boolean(next) && digest(frame.messages ?? null) === digest(next.messages ?? null),
    samePolicy: Boolean(next) && (frame.policy ?? null) === (next.policy ?? null)};
});
const sourceComparison = Object.entries(prepared.data.sourceHashes).map(([path, before]) => ({path,
  approvedHash: before, currentHash: current.data.sourceHashes[path], unchanged: before === current.data.sourceHashes[path]}));
const require = createRequire(new URL('../apps/api/package.json', import.meta.url));
const Fastify = require('fastify');
const project = '11111111-1111-4111-8111-111111111111', version = '22222222-2222-4222-8222-222222222222';
const contractChecks = [];
for (const record of live.data.records) {
  if (record.status !== 'executed' || record.pipeline === 'plain_chat') continue;
  const sample = dataset.cases.find(s => s.id === record.caseId);
  const hits = (sample.documents ?? []).map((content, i) => ({id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
    document_id: version, document_name: `版本化合成资料${i + 1}`, page: 1, content, distance: .1}));
  const base = {caseId: record.caseId, pipeline: record.pipeline, scope: 'current_contract_offline_saved_output_replay', outputHash: record.outputHash};
  if (sample.kind === 'normal' || sample.kind === 'long_tail') {
    const result = validatePlan(record.output, hits.map(h => h.id));
    const original = sample.requirement ?? '需'.repeat(sample.repeat) + sample.tail;
    const items = requirementItems(project, version, original);
    const assessment = result.plan ? assessPlan(result.plan, items) : null;
    contractChecks.push({...base, kind: 'plan', structureAccepted: Boolean(result.plan), errors: result.errors,
      tasks: result.plan?.tasks.length ?? 0, itemCount: items.length,
      mappedItemCount: result.plan ? items.filter(i => result.plan.tasks.some(t => t.requirementIds?.includes(i.key))).length : 0,
      warnings: assessment?.warnings ?? [], semanticQuality: 'unjudged'});
  } else {
    const app = Fastify({logger: false}); let replays = 0;
    try {
      await registerKnowledgeRoutes(app, {userBySession: async () => ({id: project})}, {query: async () => ({rows: []})},
        {baseUrl: 'https://fixture.invalid', model: 'fixture'},
        {baseUrl: 'https://example.invalid', apiKey: 'fixture-only', model: 'saved-output', timeoutMs: 1000, maxOutputTokens: 4096},
        {retrieve: async () => hits, complete: async () => { replays++; return record.output; }});
      const response = await app.inject({method: 'POST', url: '/knowledge/answer', headers: {authorization: 'Bearer ' + 'e'.repeat(64)},
        payload: {query: sample.question}});
      const body = response.json();
      contractChecks.push({...base, kind: 'rag', httpStatus: response.statusCode, savedOutputReplays: replays,
        reason: body.reason ?? body.error ?? null, sourceIds: (body.sources ?? []).map(s => s.id),
        candidateCount: body.candidates?.length ?? 0, citationSupport: 'requires_semantic_review'});
    } finally { await app.close(); }
  }
}
const records = live.data.records, usageComplete = records.every(r => r.usage != null);
const report = {createdAt: new Date().toISOString(), scope: 'offline_saved_real_output_audit', externalCalls: 0, paidCalls: 0,
  source: {liveReport: {path: live.path, sha256: live.sha256}, prepared: {path: prepared.path, sha256: prepared.sha256, manifestHash: live.data.manifestHash},
    currentPrepared: {path: current.path, sha256: current.sha256}},
  liveExecution: {startedAt: live.data.startedAt, finishedAt: live.data.finishedAt, calls: records.length,
    completed: records.filter(r => r.status === 'executed').length, incomplete: records.filter(r => r.status === 'incomplete').length,
    failed: records.filter(r => r.status === 'failed').length, policyBlocked: accounting.totals.policy_blocked,
    model: live.data.policy.model, immutableModelVersion: null, inputTokens: usageComplete ? records.reduce((s, r) => s + r.usage.inputTokens, 0) : null,
    outputTokens: usageComplete ? records.reduce((s, r) => s + r.usage.outputTokens, 0) : null,
    summedRequestElapsedMs: records.reduce((s, r) => s + r.elapsedMs, 0),
    conservativeCostEstimateUSD: records.every(r => r.costEstimateUSD != null) ? records.reduce((s, r) => s + r.costEstimateUSD, 0) : null,
    actualBillUSD: null, reservedUSD: live.data.reservedUSD, capUSD: live.data.policy.maxCostUSD},
  promptComparison, sourceComparison, contractChecks,
  humanReview: {reviewers: [], reviewedComparableCases: accounting.comparisons.filter(c => c.status === 'comparable_reviewed_records').length,
    omissionRate: null, citationSupportRate: null, humanEdits: null, humanMinutes: null},
  limitations: ['Saved-output replay uses REVIEW_PLACEHOLDER_575a8dfc08a84f40bc3b storage/retrieval; it is not live database or live vector evaluation.',
    'The provider returned a model alias, not a verified immutable release.',
    'Input/output token counts were returned; cache breakdown, original total and actual charges were not retained.',
    'No aggregate model quality claim or improvement percentage is inferred.']};
const out = join(root, '.runtime', 'evaluation-audit-v4-' + randomUUID());
await mkdir(out, {recursive: true});
for (const [name, data] of [['report.json', report], ['run-records.json', bound], ['accounting.json', accounting]]) {
  await writeFile(join(out, name), JSON.stringify(data, null, 2) + '\n');
}
console.log(JSON.stringify({output: out, realCallsInSavedReport: records.length, additionalPaidCalls: 0,
  savedOutputContractChecks: contractChecks.length, reviewedComparableCases: report.humanReview.reviewedComparableCases,
  promptPolicyMatches: promptComparison.every(r => r.sameMessages && r.samePolicy)}));
