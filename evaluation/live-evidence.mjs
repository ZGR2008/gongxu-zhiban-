import {digest, prepareLive} from './live-policy.mjs';

// Offline evidence binding only. Never loads credentials or calls a model.
export function bindLiveEvidence(manifest, live, template, dataset) {
  const prepared = prepareLive(manifest);
  if (live.manifestHash !== prepared.manifestHash) throw Error('Prepared manifest hash mismatch');
  if (digest(live.policy) !== digest(prepared.policy)) throw Error('Recorded policy differs from prepared policy');
  if (!Array.isArray(live.records) || live.records.length > prepared.calls.length
    || live.actualModelCalls !== live.records.length) throw Error('Inconsistent call count');
  const seen = new Map();
  for (const [index, result] of live.records.entries()) {
    const call = prepared.calls[index];
    const key = result.caseId + ':' + result.pipeline;
    if (seen.has(key) || key !== call.caseId + ':' + call.pipeline) throw Error('Duplicate, reordered or unknown result');
    for (const field of ['promptHash', 'inputHash', 'knowledgeHash']) {
      if (result[field] !== call[field]) throw Error('Input provenance mismatch: ' + field);
    }
    if (result.model !== prepared.policy.model
      || digest(result.settings) !== digest({temperature: prepared.policy.temperature,
        maxOutputTokens: prepared.policy.maxOutputTokens, thinking: prepared.policy.thinking})) throw Error('Model settings mismatch');
    if (typeof result.output === 'string' && result.outputHash !== digest(result.output)) throw Error('Output hash mismatch');
    if (result.status === 'executed' && (result.httpStatus !== 200 || result.finishReason !== 'stop'
      || typeof result.output !== 'string' || !result.output.trim())) throw Error('Incomplete output marked executed');
    if (!['executed', 'incomplete', 'failed'].includes(result.status)) throw Error('Unknown execution status');
    if (result.usage != null && !['inputTokens', 'outputTokens'].every(k => Number.isSafeInteger(result.usage[k]) && result.usage[k] >= 0)) throw Error('Invalid provider usage');
    seen.set(key, result);
  }
  const records = manifest.frames.filter(f => f.pipeline).map(frame => {
    const sample = dataset.cases.find(c => c.id === frame.caseId);
    if (!sample) throw Error('Unknown case');
    const result = seen.get(frame.caseId + ':' + frame.pipeline);
    const blocked = frame.status === 'model_not_invoked_by_policy';
    const row = {...structuredClone(template), caseId: frame.caseId, pipeline: frame.pipeline,
      datasetVersion: manifest.datasetVersion, commit: frame.commit ?? manifest.commit,
      status: result ? result.status === 'executed' ? 'completed' : 'failed' : blocked ? 'policy_blocked' : 'not_executed',
      reason: result ? result.reason ?? (result.status === 'executed' ? 'call_completed_quality_unjudged' : 'incomplete_output') : frame.policy ?? 'not_attempted',
      inputHash: frame.inputHash, knowledgeHash: frame.knowledgeHash,
      conditionJudgments: sample.acceptance.map((text, i) => ({id: `${sample.id}:${i + 1}`, text,
        judgment: 'unjudged', outputEvidence: null, note: null, reviewerCodes: []})),
      limitations: ['Human semantic review is not supplied.', 'Fixed REVIEW_PLACEHOLDER_575a8dfc08a84f40bc3b retrieval, not end-to-end retrieval evaluation.',
        'Historical prompt assembly only; full historical workflow is not reproduced.']};
    if (result) Object.assign(row, {provenance: 'real_model', model: result.model, modelVersion: result.modelVersion,
      modelVersionScope: 'provider_returned_alias_not_immutable_snapshot', outputHash: result.outputHash,
      promptHash: result.promptHash, executedAt: live.startedAt, executedAtScope: 'run_start_not_individual_request',
      executionWindow: {startedAt: live.startedAt, finishedAt: live.finishedAt},
      settings: {...result.settings, timeoutMs: live.policy.timeoutMs, maxRetries: live.policy.maxRetries},
      timingsMs: {...template.timingsMs, model: result.elapsedMs},
      // Legacy runner computed totalTokens and a price estimate. Neither is a
      // provider-returned total or an actual bill, so those fields remain null.
      providerUsage: {inputTokens: result.usage?.inputTokens ?? null, outputTokens: result.usage?.outputTokens ?? null,
        totalTokens: null, cost: null},
      derivedUsage: {summedTokens: result.usage ? result.usage.inputTokens + result.usage.outputTokens : null,
        conservativeCostEstimateUSD: result.costEstimateUSD ?? null, actualBillUSD: null}});
    return row;
  });
  return {schemaVersion: template.schemaVersion, records, scope: 'offline_binding_of_saved_real_outputs',
    externalCalls: 0, paidCalls: 0, sourceManifestHash: prepared.manifestHash};
}
