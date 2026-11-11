import {createRequire} from 'node:module';
import {createHash,randomUUID,randomBytes} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {PgProjectStore} from '../apps/api/dist/project-store.js';
import {registerProjectRoutes} from '../apps/api/dist/project-routes.js';
import {loadConfig} from '../apps/api/dist/config.js';
import {loadEmbeddingConfig,savePages,indexDocument,retrieveKnowledge} from '../apps/api/dist/rag/service.js';
import {validateRetrievalDataset,summarizeRetrieval,summarizeQueryStudy} from '../evaluation/retrieval.mjs';
import {sourceProvenance} from '../evaluation/source-provenance.mjs';

// Only the existing local services and new REVIEW_PLACEHOLDER_575a8dfc08a84f40bc3b accounts are used. Never
// print configuration, identities, credentials, API responses or existing data.
const compareInstruction=process.argv.slice(2).length===1&&process.argv[2]==='--compare-query-instruction';
if(process.argv.length>2&&!compareInstruction)throw Error('Only the fixed local query-instruction comparison is supported');
const require=createRequire(new URL('../apps/api/package.json',import.meta.url));
require('dotenv').config({path:fileURLToPath(new URL('../apps/api/.env',import.meta.url))});
const local=value=>['127.0.0.1','localhost','[::1]'].includes(new URL(value).hostname);
const config=loadConfig(),embedding=loadEmbeddingConfig();
if(!config.DATABASE_URL||!local(config.DATABASE_URL)||!embedding||!local(embedding.baseUrl))throw Error('Existing local DB and local embedding service required');
const send=globalThis.fetch;
globalThis.fetch=(input,init)=>{
 if(!local(input instanceof Request?input.url:String(input)))throw Error('External request prohibited');
 return send(input,{...init,redirect:'error'});
};
const hash=value=>createHash('sha256').update(value).digest('hex');
const datasetBytes=await readFile(new URL('../evaluation/retrieval.v1.json',import.meta.url));
const originalDataset=validateRetrievalDataset(JSON.parse(datasetBytes));
const studyBytes=compareInstruction?await readFile(new URL('../evaluation/retrieval-query-study.v1.json',import.meta.url)):undefined;
const study=studyBytes?JSON.parse(studyBytes):undefined;
const dataset=study?validateRetrievalDataset({...originalDataset,queries:[...originalDataset.queries,...study.additionalQueries]}):originalDataset;
const variants=study?study.variants:[{id:'plain',queryPrefix:''}];
if(study){assert.deepEqual(variants.map(row=>row.id),['plain','bge_instruction']);assert.equal(variants[0].queryPrefix,'');assert.equal(study.controls.maximumCosineDistance,.5);assert.equal(study.controls.returnedChunks,5);assert.equal(study.controls.automaticProductionChange,false);}
const expectedManifest=JSON.parse(await readFile(new URL('../apps/embedding/model-manifest.json',import.meta.url)));
const directory=new URL(`../.runtime/retrieval-local-${randomUUID()}/`,import.meta.url);await mkdir(directory,{recursive:true});
const report={scope:'real_local_pgvector_and_embedding_original_REVIEW_PLACEHOLDER_575a8dfc08a84f40bc3b_corpus',datasetVersion:dataset.version,
 datasetSha256:hash(datasetBytes),startedAt:new Date().toISOString(),status:'running',paidChatCalls:0,externalTransfers:0,
 source:{},limits:{returnedChunks:5,maximumCosineDistance:.5,queryTimeoutMs:45000,totalTimeoutMs:600000},
 sources:dataset.documents.map(d=>({id:d.id,title:d.title,page:d.page,sha256:hash(d.text)})),
 queries:[],checks:[],indexing:[],limitations:[
 'Small developer-authored REVIEW_PLACEHOLDER_575a8dfc08a84f40bc3b set; no teacher labels or student trial.',
 'Source page numbers are REVIEW_PLACEHOLDER_575a8dfc08a84f40bc3b fixtures; this runner does not test PDF parsing.',
 'Retrieval distance and valid references do not prove semantic support.',
 compareInstruction?'Query transformation comparison only; no chat calls, generated-answer quality or full-workflow improvement claim.':'No chat calls, generated answers, prompt-injection resistance claim or baseline improvement comparison.',
 'Local timing includes actual service wait and is not a throughput benchmark.'
 ]};
if(study)report.queryStudy={version:study.version,sha256:hash(studyBytes),source:study.source,variants,controls:study.controls,additionalQueries:study.additionalQueries.map(q=>({id:q.id,sha256:hash(q.question)})),results:[],limitations:study.limitations};
const provenance=sourceProvenance(new URL('../',import.meta.url));
Object.assign(report.source,{commit:provenance.commit,modified:provenance.workingTreeClean===null?null:!provenance.workingTreeClean,gitStatus:provenance.gitStatus});
for(const name of ['apps/api/src/rag/service.ts','apps/api/src/rag/search.ts','apps/api/src/rag/embeddings.ts','apps/embedding/model-manifest.json','scripts/evaluate-retrieval-local.mjs','evaluation/retrieval.mjs'])
 report.source[name]=hash(await readFile(new URL('../'+name,import.meta.url)));
const {Pool}=require('pg'),Fastify=require('fastify');
const pool=new Pool({connectionString:config.DATABASE_URL,connectionTimeoutMillis:3000,statement_timeout:15000,query_timeout:18000});
const app=Fastify({logger:false});await registerProjectRoutes(app,new PgProjectStore(pool));
const total=AbortSignal.timeout(600000);let stage='setup';const accounts=[],idToDocument=new Map(),documentToId=new Map();
const options=()=>({signal:total,onState:state=>{if(state.state==='retrying')report.retries=(report.retries??0)+1;}});
async function account(){
 const response=await app.inject({method:'POST',url:'/auth/register',payload:{name:'检索评测 · 合成',email:`retrieval-${randomUUID()}@example.test`,password:randomBytes(24).toString('base64url')}});
 assert.equal(response.statusCode,201);const data=response.json();const value={id:data.user.id,token:data.token};accounts.push(value);return value;
}
async function check(name,run){stage=name;await run();report.checks.push({name,status:'passed'});console.log(`PASS ${name}`);}
try{
 const ready=await fetch(new URL('/ready',embedding.baseUrl),{signal:AbortSignal.timeout(5000)});assert.equal(ready.status,200);
 const identity=await ready.json();assert.equal(identity.model,expectedManifest.id);assert.equal(identity.dimensions,expectedManifest.dimensions);assert.equal(embedding.model,expectedManifest.id);
 if(study)assert.equal(identity.model,study.requiredModel);
 report.model={id:identity.model,dimensions:identity.dimensions,revision:expectedManifest.revision,pooling:expectedManifest.pooling,normalize:expectedManifest.normalize,windowCharacters:expectedManifest.windowCharacters};
 const owner=await account(),foreign=await account(),empty=await account();
 stage='index_REVIEW_PLACEHOLDER_575a8dfc08a84f40bc3b_corpus';
 for(const document of dataset.documents){
  total.throwIfAborted();const start=performance.now();
  const saved=await savePages(pool,owner.id,document.title,'text/plain',[{page:document.page,text:document.text}]);
  await indexDocument(pool,owner.id,saved.id,embedding,options());
  documentToId.set(document.id,saved.id);idToDocument.set(saved.id,document);
  report.indexing.push({documentId:document.id,chunks:saved.chunks,durationMs:Math.round(performance.now()-start)});
 }
 const foreignDoc=await savePages(pool,foreign.id,'外账号同文资料 · 合成','text/plain',[{page:1,text:dataset.documents[0].text}]);
 await indexDocument(pool,foreign.id,foreignDoc.id,embedding,options());
 for(const [queryIndex,query] of dataset.queries.entries())for(const variant of queryIndex%2?[...variants].reverse():variants){
  stage=query.id+'_'+variant.id;total.throwIfAborted();const start=performance.now();
  const transformed=variant.queryPrefix+query.question;
  const result={id:query.id,status:'completed',questionSha256:hash(query.question),encodedInputSha256:hash(transformed),durationMs:0,hits:[]};
  try{
   const hits=await retrieveKnowledge(pool,owner.id,transformed,embedding,options());assert.ok(hits.length<=5);
   for(const hit of hits){
    const source=idToDocument.get(hit.document_id);assert.ok(source,'Foreign or unknown source');
    assert.equal(hit.document_name,source.title);assert.equal(hit.page,source.page);assert.equal(hit.content,source.text);
    assert.ok(Number.isFinite(hit.distance)&&hit.distance>=0&&hit.distance<=.5);
    const stored=await pool.query('SELECT position,page,content FROM knowledge_chunks WHERE id=$1 AND document_id=$2',[hit.id,hit.document_id]);
    assert.equal(stored.rowCount,1);assert.equal(stored.rows[0].content,hit.content);assert.equal(stored.rows[0].page,hit.page);
    result.hits.push({documentId:source.id,page:hit.page,chunkPosition:stored.rows[0].position,contentSha256:hash(hit.content),distance:hit.distance});
   }
  }catch(error){
   // Provider outages count as failures. A violated isolation/source invariant
   // aborts the run instead of being hidden among normal retrieval misses.
   if(error instanceof assert.AssertionError)throw error;
   result.status='failed';result.errorType=error.constructor.name;result.hits=[];
  }
  result.durationMs=Math.round(performance.now()-start);(variant.id==='plain'?report.queries:report.queryStudy.results).push(result);console.log(`${result.status==='completed'?'MEASURED':'FAILED'} ${query.id} ${variant.id}`);
 }
 await check('other_account_receives_only_its_identical_source',async()=>{
  const hits=await retrieveKnowledge(pool,foreign.id,dataset.queries[0].question,embedding,options());assert.ok(hits.length>0);assert.ok(hits.every(hit=>hit.document_id===foreignDoc.id));
 });
 await check('account_without_knowledge_receives_no_sources',async()=>{
  assert.equal((await retrieveKnowledge(pool,empty.id,dataset.queries[0].question,embedding,options())).length,0);
 });
 await check('REVIEW_PLACEHOLDER_575a8dfc08a84f40bc3b_sources_remain_owned_ready_and_unchanged',async()=>{
  const rows=await pool.query('SELECT d.id,d.status,c.content,c.page,vector_dims(c.embedding) AS dimensions FROM knowledge_documents d JOIN knowledge_chunks c ON c.document_id=d.id WHERE d.owner_id=$1',[owner.id]);
  assert.equal(rows.rows.length,dataset.documents.length);
  for(const row of rows.rows){const source=idToDocument.get(row.id);assert.ok(source);assert.equal(row.status,'ready');assert.equal(row.content,source.text);assert.equal(row.page,source.page);assert.equal(row.dimensions,expectedManifest.dimensions);}
 });
 report.summary=summarizeRetrieval(dataset,report.queries);report.status=report.queries.some(row=>row.status==='failed')?'completed_with_service_failures':'measured';
 if(study){report.queryStudy.comparison=summarizeQueryStudy(dataset,report.queries,report.queryStudy.results,study.additionalQueries.map(q=>q.id));if(report.queryStudy.results.some(row=>row.status==='failed'))report.status='completed_with_service_failures';}
 console.log(`MEASURED answerable=${report.summary.answerable.cases} top1=${report.summary.answerable.hitAt1} top3=${report.summary.answerable.hitAt3}; semantic support not evaluated`);
 if(report.status==='completed_with_service_failures')process.exitCode=1;
}catch(error){report.status='failed';report.failedStage=stage;report.errorType=error.constructor.name;process.exitCode=1;console.log(`FAILED ${stage} (${error.constructor.name})`);}
finally{
 for(const identity of accounts)await app.inject({method:'POST',url:'/auth/logout',headers:{authorization:`Bearer ${identity.token}`}}).catch(()=>{});
 await app.close();await pool.end();globalThis.fetch=send;report.finishedAt=new Date().toISOString();
 await writeFile(new URL('report.json',directory),JSON.stringify(report,null,2));console.log(`Report: ${fileURLToPath(new URL('report.json',directory))}`);
}
