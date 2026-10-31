import assert from 'node:assert/strict';

/** These labels are authored synthetic cases, never model confidence or teacher scores. */
export function validateRetrievalDataset(data) {
  assert.match(data.version, /^\d+\.\d+\.\d+$/);
  assert.equal(data.scope, 'original_synthetic_software_engineering_retrieval_not_official_benchmark');
  assert.ok(data.documents.length > 1 && data.queries.length > 1);
  const documents = new Set(), queries = new Set();
  for (const document of data.documents) {
    assert.match(document.id, /^[a-z][a-z0-9-]*$/);
    assert.ok(!documents.has(document.id)); documents.add(document.id);
    assert.ok(document.title.includes('合成') && document.text.trim().length > 20);
    assert.ok(Number.isInteger(document.page) && document.page > 0);
  }
  for (const query of data.queries) {
    assert.ok(!queries.has(query.id)); queries.add(query.id);
    assert.ok(query.question.trim().length > 10);
    assert.ok(['answerable', 'conflicting', 'unanswerable', 'untrusted_source'].includes(query.kind));
    assert.ok(query.expectedDocuments.every(id => documents.has(id)));
    assert.equal(new Set(query.expectedDocuments).size, query.expectedDocuments.length);
    assert.equal(query.kind === 'unanswerable', query.expectedDocuments.length === 0);
    if (query.kind === 'answerable') assert.equal(query.expectedDocuments.length, 1);
    if (query.kind === 'conflicting') assert.ok(query.expectedDocuments.length > 1);
  }
  return data;
}

/** Rank distinct documents in the five returned chunks; duplicate chunks do not inflate hits. */
export function summarizeRetrieval(data, results) {
  validateRetrievalDataset(data);
  assert.equal(results.length, data.queries.length, 'Do not silently omit failed or empty cases');
  const rows = data.queries.map(query => {
    const matching = results.filter(result => result.id === query.id);
    assert.equal(matching.length, 1);
    const result = matching[0]; assert.ok(['completed', 'failed'].includes(result.status));
    const documentIds = [...new Set(result.hits.map(hit => hit.documentId))];
    assert.ok(documentIds.every(id => data.documents.some(document => document.id === id)), 'Foreign or unknown document');
    assert.ok(result.status === 'completed' || result.hits.length === 0);
    const foundAt = k => query.expectedDocuments.filter(id => documentIds.slice(0, k).includes(id)).length;
    return {id:query.id, kind:query.kind, status:result.status, returnedChunks:result.hits.length,
      rankedDocuments:documentIds, expectedDocuments:query.expectedDocuments,
      expectedFoundAt1:foundAt(1), expectedFoundAt3:foundAt(3), expectedFoundAt5:foundAt(5)};
  });
  const primary = rows.filter(row => row.kind === 'answerable');
  const failures = primary.filter(row => row.status !== 'completed').length;
  return {
    unit:'distinct_document_within_at_most_five_returned_chunks',
    answerable:{cases:primary.length, failures, hitAt1:primary.reduce((n,row)=>n+row.expectedFoundAt1,0),
      hitAt3:primary.reduce((n,row)=>n+row.expectedFoundAt3,0),
      denominatorIncludesFailedQueries:true},
    conflict:rows.filter(row=>row.kind==='conflicting'),
    noAnswerObservations:rows.filter(row=>row.kind==='unanswerable'),
    untrustedSourceObservations:rows.filter(row=>row.kind==='untrusted_source'),
    rows,
    semanticSupport:'not_evaluated', generatedAnswers:'not_requested', teacherReview:'not_executed'
  };
}
