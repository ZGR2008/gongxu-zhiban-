// Offline accounting of explicitly supplied review records. This cannot verify
// that a model was called or that a human's semantic judgment is correct.
const pipelines = ['plain_chat', 'pre_optimization', 'current_workflow'];
const statuses = ['not_executed', 'failed', 'policy_blocked', 'completed'];
const sha256 = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const nonnegative = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const integer = value => nonnegative(value) && Number.isSafeInteger(value);
const text = value => typeof value === 'string' && value.trim().length > 0;
const canonical = value => JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))));

function reviewersValid(row, record) {
  const reviewers = row?.reviewerCodes;
  return Array.isArray(reviewers) && new Set(reviewers).size >= 2
    && Array.isArray(record.reviewers)
    && reviewers.every(code => typeof code === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(code) && record.reviewers.includes(code));
}

function coverage(record, sample) {
  const rows = record.conditionJudgments;
  const counts = {covered: 0, omitted: 0, undecidable: 0};
  const reasons = [];
  if (!Array.isArray(rows) || rows.length !== sample.acceptance.length) reasons.push('all_conditions_must_be_reviewed');
  const ids = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    const index = sample.acceptance.findIndex((_, i) => row?.id === `${sample.id}:${i + 1}`);
    if (index < 0 || ids.has(row.id)) { reasons.push('unknown_or_duplicate_condition'); continue; }
    ids.add(row.id);
    if (row.text !== sample.acceptance[index]) reasons.push('condition_text_differs_from_dataset');
    if (!Object.hasOwn(counts, row.judgment)) { reasons.push('condition_unjudged'); continue; }
    if (!reviewersValid(row, record)) reasons.push('two_named_reviewers_required');
    // An omitted condition has no output quote: require a review note explaining
    // the absence. Covered conditions additionally require the actual output excerpt.
    if (!text(row.note) || (row.judgment === 'covered' && !text(row.outputEvidence))) reasons.push('condition_evidence_missing');
    counts[row.judgment]++;
  }
  for (const [field, expected] of [['requiredConditions', sample.acceptance.length], ['omittedConditions', counts.omitted], ['undecidableConditions', counts.undecidable]]) {
    if (record[field] != null && record[field] !== expected) reasons.push('supplied_counts_disagree');
  }
  const unique = [...new Set(reasons)];
  if (unique.length) return {status: 'incomplete', reasons: unique, counts: null, omissionRate: null};
  const denominator = counts.covered + counts.omitted;
  return {status: 'reviewed', reasons: [], counts: {...counts, required: sample.acceptance.length, decidable: denominator}, omissionRate: denominator ? counts.omitted / denominator : null};
}

function citations(record) {
  const rows = record.citationJudgments;
  const reasons = [];
  const counts = {supported: 0, partial: 0, unsupported: 0, undecidable: 0};
  if (!integer(record.citedClaimCount) || !Array.isArray(rows) || rows.length !== record.citedClaimCount) reasons.push('citation_inventory_missing_or_incomplete');
  const ids = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!text(row?.id) || ids.has(row.id)) reasons.push('duplicate_or_missing_citation_id');
    ids.add(row?.id);
    if (!Object.hasOwn(counts, row?.judgment)) { reasons.push('citation_unjudged'); continue; }
    if (!text(row.claim) || !text(row.note) || (row.judgment !== 'undecidable' && !text(row.sourceExcerpt))) reasons.push('citation_original_evidence_missing');
    if (!reviewersValid(row, record)) reasons.push('two_named_reviewers_required');
    counts[row.judgment]++;
  }
  if (reasons.length) return {status: 'incomplete', reasons: [...new Set(reasons)], counts: null};
  return {status: record.citedClaimCount ? 'reviewed' : 'no_cited_claims', reasons: [], counts};
}

function measures(record) {
  const timing = {};
  const invalid = [];
  for (const key of ['queue', 'retrieval', 'model', 'validation', 'total']) {
    const value = record.timingsMs?.[key];
    timing[key] = nonnegative(value) ? value : null;
    if (value != null && timing[key] === null) invalid.push(`invalid_timing_${key}`);
  }
  const usage = {};
  for (const key of ['inputTokens', 'outputTokens', 'totalTokens']) {
    const value = record.providerUsage?.[key];
    usage[key] = integer(value) ? value : null;
    if (value != null && usage[key] === null) invalid.push(`invalid_usage_${key}`);
  }
  // Do not infer totals, costs or human effort from missing values or text length.
  return {timingsMs: timing, providerUsage: usage, humanEdits: integer(record.humanEdits) ? record.humanEdits : null,
    humanMinutes: nonnegative(record.humanMinutes) ? record.humanMinutes : null, warnings: invalid};
}

function provenanceProblems(record) {
  const reasons = [];
  if (record.provenance !== 'real_model') reasons.push('real_model_provenance_not_supplied');
  if (!sha256(record.inputHash) || !sha256(record.knowledgeHash) || !sha256(record.outputHash)) reasons.push('input_knowledge_or_output_hash_missing');
  if (!/^[a-f0-9]{40}$/.test(record.commit ?? '')) reasons.push('exact_source_commit_missing');
  if (!text(record.model) || !text(record.modelVersion)) reasons.push('model_or_version_missing');
  const settings = record.settings;
  if (!settings || !nonnegative(settings.temperature) || !integer(settings.maxOutputTokens) || settings.maxOutputTokens < 1
    || !integer(settings.timeoutMs) || settings.timeoutMs < 1 || !integer(settings.maxRetries)) reasons.push('comparable_settings_missing');
  if (!text(record.executedAt) || !Number.isFinite(Date.parse(record.executedAt))) reasons.push('execution_time_missing');
  return reasons;
}

export function buildEvaluationReport(records, dataset) {
  if (!Array.isArray(records) || records.length > 10000) throw new Error('Expected an array with at most 10000 evaluation records');
  const samples = new Map(dataset.cases.map(sample => [sample.id, sample]));
  const totals = Object.fromEntries(statuses.map(status => [status, 0]));
  totals.invalid = 0;
  const evaluated = records.map((record, index) => {
    if (!record || !statuses.includes(record.status)) { totals.invalid++; return {index, status: 'invalid', problems: ['unknown_status']}; }
    totals[record.status]++;
    const sample = samples.get(record.caseId);
    const row = {index, caseId: sample?.id ?? null, pipeline: pipelines.includes(record.pipeline) ? record.pipeline : null,
      status: record.status, problems: [], coverage: null, citations: null, measures: measures(record)};
    if (!sample || record.datasetVersion !== dataset.version) row.problems.push('case_or_dataset_version_unknown');
    if (!row.pipeline) row.problems.push('pipeline_missing');
    if (record.status !== 'completed') return row;
    row.problems.push(...provenanceProblems(record));
    if (sample && record.datasetVersion === dataset.version) {
      row.coverage = coverage(record, sample);
      row.citations = citations(record);
    }
    return row;
  });
  const comparisons = dataset.cases.map(sample => {
    const reasons = [];
    const entries = pipelines.map(pipeline => {
      const matched = evaluated.filter(row => row.caseId === sample.id && row.pipeline === pipeline);
      if (matched.length !== 1) reasons.push(matched.length ? `duplicate_${pipeline}` : `missing_${pipeline}`);
      return matched.length === 1 ? matched[0] : null;
    });
    if (['change', 'isolation', 'failure'].includes(sample.kind)) reasons.push('protocol_case_not_model_quality_score');
    for (const row of entries.filter(Boolean)) {
      if (row.status !== 'completed') reasons.push(`${row.pipeline}_${row.status}`);
      if (row.problems.length) reasons.push(...row.problems);
      if (row.coverage?.status !== 'reviewed') reasons.push('condition_review_incomplete');
      if (!['reviewed', 'no_cited_claims'].includes(row.citations?.status)) reasons.push('citation_review_incomplete');
    }
    const raw = entries.filter(Boolean).map(row => records[row.index]);
    if (raw.length === pipelines.length) {
      for (const field of ['datasetVersion', 'inputHash', 'knowledgeHash', 'model', 'modelVersion']) {
        if (new Set(raw.map(record => record[field])).size !== 1) reasons.push(`${field}_mismatch`);
      }
      if (new Set(raw.map(record => canonical(record.settings ?? {}))).size !== 1) reasons.push('settings_mismatch');
    }
    const ready = reasons.length === 0;
    return {caseId: sample.id, status: ready ? 'comparable_reviewed_records' : 'not_comparable', reasons: [...new Set(reasons)],
      metrics: ready ? entries.map(row => ({pipeline: row.pipeline, coverage: row.coverage, citations: row.citations, measures: row.measures})) : null};
  });
  return {schemaVersion: '1.1.0', datasetVersion: dataset.version, recordCount: records.length, totals,
    scope: 'offline_accounting_only', externalCalls: 0, paidCalls: 0, evaluated, comparisons,
    limitations: ['Record metadata and human judgments are supplied evidence, not independently authenticated by this tool.',
      'No aggregate improvement percentage is inferred from missing, blocked, failed, incomparable or protocol-only records.',
      'Raw prompts, model responses and reviewer notes are omitted from this summary. Keep original outputs for authorized local audit.']};
}
