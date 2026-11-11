import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validateRetrievalDataset,summarizeRetrieval,summarizeQueryStudy} from '../evaluation/retrieval.mjs';
const data=JSON.parse(await readFile(new URL('../evaluation/retrieval.v1.json',import.meta.url),'utf8'));
const results=()=>data.queries.map(q=>({id:q.id,status:'completed',hits:q.expectedDocuments.map(documentId=>({documentId}))}));
const study=JSON.parse(await readFile(new URL('../evaluation/retrieval-query-study.v1.json',import.meta.url),'utf8'));
test('frozen REVIEW_PLACEHOLDER_575a8dfc08a84f40bc3b dataset covers normal conflict no-answer and untrusted sources',()=>{
 validateRetrievalDataset(data); assert.equal(data.documents.length,15);assert.equal(data.queries.length,16);
 assert.deepEqual([...new Set(data.queries.map(q=>q.kind))],['answerable','conflicting','unanswerable','untrusted_source']);
});
test('complete REVIEW_PLACEHOLDER_575a8dfc08a84f40bc3b labels have a denominator of twelve, not all observation cases',()=>{
 const score=summarizeRetrieval(data,results());assert.equal(score.answerable.cases,12);assert.equal(score.answerable.hitAt1,12);
 assert.equal(score.conflict[0].expectedFoundAt5,2);assert.equal(score.noAnswerObservations.length,2);assert.equal(score.semanticSupport,'not_evaluated');
});
test('failure and no hit remain in denominator instead of silently disappearing',()=>{
 const rows=results();rows[0]={id:'q01',status:'failed',hits:[]};rows[1].hits=[];
 const score=summarizeRetrieval(data,rows);assert.equal(score.answerable.failures,1);assert.equal(score.answerable.hitAt1,10);assert.equal(score.answerable.cases,12);
 assert.throws(()=>summarizeRetrieval(data,rows.slice(1)));
});
test('multiple chunks from the same document cannot inflate rank hits',()=>{
 const rows=results();rows[0].hits=[{documentId:'revision'},{documentId:'revision'},{documentId:'transaction'}];
 const score=summarizeRetrieval(data,rows);assert.equal(score.rows[0].expectedFoundAt1,0);assert.equal(score.rows[0].expectedFoundAt3,1);assert.equal(score.rows[0].rankedDocuments.length,2);
});
test('unknown source or duplicate/missing query is rejected',()=>{
 const rows=results();rows[0].hits=[{documentId:'foreign-secret'}];assert.throws(()=>summarizeRetrieval(data,rows));
 const duplicate=results();duplicate[0]=duplicate[1];assert.throws(()=>summarizeRetrieval(data,duplicate));
});
test('an unknown expected source or invented answerable label is rejected',()=>{
 const invalid=structuredClone(data);invalid.queries[0].expectedDocuments=['missing'];assert.throws(()=>validateRetrievalDataset(invalid));
 invalid.queries[0].expectedDocuments=[];assert.throws(()=>validateRetrievalDataset(invalid));
});

test('query study keeps original and frozen additional questions separate with unchanged controls',()=>{
 const expanded=validateRetrievalDataset({...data,queries:[...data.queries,...study.additionalQueries]});
 assert.equal(study.controls.automaticProductionChange,false);assert.equal(study.controls.maximumCosineDistance,.5);assert.equal(study.controls.returnedChunks,5);
 assert.deepEqual(study.variants.map(row=>row.id),['plain','bge_instruction']);assert.equal(study.variants[0].queryPrefix,'');
 const plain=expanded.queries.map(q=>({id:q.id,status:'completed',hits:q.expectedDocuments.map(documentId=>({documentId}))})),instructed=structuredClone(plain);
 instructed.find(row=>row.id==='q01').hits=[];instructed.find(row=>row.id==='h01').status='failed';instructed.find(row=>row.id==='h01').hits=[];
 const compared=summarizeQueryStudy(expanded,plain,instructed,study.additionalQueries.map(q=>q.id));
 assert.equal(compared.original.plain.answerable.cases,12);assert.equal(compared.additional.plain.answerable.cases,12);
 assert.equal(compared.original.instructed.answerable.hitAt3,11);assert.equal(compared.additional.instructed.answerable.failures,1);
 assert.equal(compared.changes.find(row=>row.id==='q01').top3Delta,-1);assert.equal(compared.productionChange,'not_applied');
 assert.throws(()=>summarizeQueryStudy(expanded,plain,instructed.slice(1),study.additionalQueries.map(q=>q.id)));
});
