// Only this checked-in, non-sensitive original curriculum can be published. No arbitrary input path.
import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';import {mkdir,writeFile} from 'node:fs/promises';import {randomUUID,createHash} from 'node:crypto';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';import assert from 'node:assert/strict';
import {curriculum} from '../knowledge/teaching-v6/catalog.mjs';import {teachingQuestions} from '../evaluation/teaching-questions-v6.mjs';
import {savePublicLesson,publicLesson} from '../apps/api/dist/rag/public.js';import {loadEmbeddingConfig,indexDocument,modelId,retrieveKnowledge} from '../apps/api/dist/rag/service.js';
const args=process.argv.slice(2);if(args.some(a=>!['--isolated','--apply-approved-public-curriculum','--skip-index'].includes(a))||!args.includes('--isolated')&&!args.includes('--apply-approved-public-curriculum'))throw Error('Choose --isolated or --apply-approved-public-curriculum; only the checked-in authorized curriculum is accepted');
const require=createRequire(new URL('../apps/api/package.json',import.meta.url));require('dotenv').config({path:fileURLToPath(new URL('../apps/api/.env',import.meta.url)),quiet:true});
const local=url=>['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname);
if(!process.env.DATABASE_URL||!local(process.env.DATABASE_URL))throw Error('Local database required');
const embedding=loadEmbeddingConfig();if(!args.includes('--skip-index')&&(!embedding||!local(embedding.baseUrl)))throw Error('Local embedding service required; no external transfer allowed');
const originalFetch=globalThis.fetch;globalThis.fetch=(url,opts)=>{if(!local(url instanceof Request?url.url:String(url)))throw Error('External network forbidden');return originalFetch(url,opts);};
const {Pool}=require('pg'),admin=new Pool({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:3000});
const out=new URL(`../.runtime/public-curriculum-v6-${randomUUID()}/`,import.meta.url);await mkdir(out,{recursive:true});
const materialOut=new URL('../output/teaching-v6/',import.meta.url);await mkdir(materialOut,{recursive:true});
const report={startedAt:new Date().toISOString(),scope:args.includes('--isolated')?'isolated_public_curriculum_real_local_embedding':'authorized_local_public_curriculum_real_local_embedding',paidModelCalls:0,documents:[],retrieval:[],humanReview:'not_performed',independentAnswerQuality:'not_evaluated',data:'original_non_sensitive_teaching_examples'};
let pool,stop=false;const controller=new AbortController();process.once('SIGINT',()=>{stop=true;controller.abort();});
try{
 let target=process.env.DATABASE_URL;
 if(args.includes('--isolated')){const name='gx_curriculum_v6_'+randomUUID().replaceAll('-','');assert.match(name,/^gx_curriculum_v6_[a-f0-9]{32}$/);await admin.query(`CREATE DATABASE ${name} TEMPLATE template0`);const url=new URL(target);url.pathname='/'+name;target=url.href;report.retainedSyntheticDatabase=name;
  await promisify(execFile)(process.execPath,[fileURLToPath(new URL('../apps/api/dist/migrate.js',import.meta.url))],{cwd:fileURLToPath(new URL('../apps/api/',import.meta.url)),env:{...process.env,DATABASE_URL:target},windowsHide:true,timeout:30000,maxBuffer:128000});
 }
 pool=new Pool({connectionString:target,max:3,connectionTimeoutMillis:3000,statement_timeout:15000});
 // Never infer that a fixed UUID is unused; reject before any content retrieval if it belongs to an account.
 const publicReader='00000000-0000-4000-8000-000000000000';
 assert.equal((await pool.query('SELECT 1 FROM users WHERE id=$1',[publicReader])).rowCount,0,'Public-only verification identity collision');
 const before=(await pool.query("SELECT visibility,count(*)::int AS documents FROM knowledge_documents GROUP BY visibility ORDER BY visibility")).rows;report.beforeCounts=before;
 for(const lesson of curriculum){if(stop)break;publicLesson.parse(lesson);const hash=createHash('sha256').update(lesson.text).digest('hex');
  await writeFile(new URL(lesson.lessonId+'.md',materialOut),lesson.text); // Public synthetic artifacts, never credentials or business rows.
  const saved=await savePublicLesson(pool,lesson),entry={lessonId:lesson.lessonId,version:lesson.version,id:saved.id,hash,reused:saved.reused,status:'saved',chunks:null};report.documents.push(entry);
  try{
   if(!args.includes('--skip-index')){
    const check=(await pool.query('SELECT count(*)::int AS total,count(*) FILTER(WHERE embedding IS NOT NULL AND embedding_model=$2)::int AS current FROM knowledge_chunks WHERE document_id=$1',[saved.id,modelId(embedding)])).rows[0];
    if(check.current===check.total&&check.total>0){entry.status='already_indexed';entry.chunks=check.total;}
    else{const indexed=await indexDocument(pool,null,saved.id,embedding,{signal:controller.signal});entry.status=indexed?'indexed':'not_found';entry.chunks=indexed?.chunks??null;}
   }
   await pool.query('UPDATE public_knowledge_imports SET status=$2,error_code=NULL,updated_at=now() WHERE content_hash=$1',[hash,entry.status]);
  }catch(error){entry.status=stop?'cancelled':'index_failed';entry.error=typeof error?.code==='string'?error.code:'local_index_error';await pool.query('UPDATE public_knowledge_imports SET status=$2,error_code=$3,updated_at=now() WHERE content_hash=$1',[hash,entry.status,entry.error]);}
  await writeFile(new URL('report.json',out),JSON.stringify(report,null,2));console.log(`${lesson.lessonId} ${entry.status}`);
 }
 if(!stop&&!args.includes('--skip-index'))for(const q of teachingQuestions){
  try{const hits=await retrieveKnowledge(pool,publicReader,q.query,embedding,{signal:controller.signal});
   assert.ok(hits.every(h=>h.scope==='platform_public'),'Private scope must never enter curriculum evidence');
   const ids=hits.map(h=>report.documents.find(d=>d.id===h.document_id)?.lessonId).filter(Boolean);
   const expected=q.expectedLessonIds.length>0;
   report.retrieval.push({id:q.id,kind:q.kind,query:q.query,expectedLessonIds:q.expectedLessonIds,retrievedLessonIds:ids,scopePublicOnly:hits.every(h=>h.scope==='platform_public'),expectedSourceFound:expected?ids.some(id=>q.expectedLessonIds.includes(id)):null,sources:hits.map(h=>({id:h.id,documentId:h.document_id,content:h.content,distance:h.distance})),answerJudgment:'not_run_no_chat_call'});
  }catch(error){report.retrieval.push({id:q.id,status:'failed',code:typeof error?.code==='string'?error.code:'local_retrieval_error'});}
 }
 report.afterCounts=(await pool.query('SELECT visibility,count(*)::int AS documents FROM knowledge_documents GROUP BY visibility ORDER BY visibility')).rows;
 assert.equal(report.beforeCounts.find(r=>r.visibility==='personal')?.documents??0,report.afterCounts.find(r=>r.visibility==='personal')?.documents??0);
 report.status=stop?'cancelled':report.documents.length===51&&report.documents.every(d=>['indexed','already_indexed'].includes(d.status))?'indexed':'partial';
 await writeFile(new URL('catalogue.json',materialOut),JSON.stringify({scope:'original_public_teaching_examples',version:'1.0.0',lessons:curriculum.map(({text,...d})=>({...d,contentHash:createHash('sha256').update(text).digest('hex'),file:d.lessonId+'.md'})),review:'AI-assisted engineering/source check; independent teacher review pending'},null,2));
 if(report.status!=='indexed')process.exitCode=1;
}catch(error){report.status='failed';report.error=typeof error?.code==='string'?error.code:'local_import_error';process.exitCode=1;console.log('Import failed; configuration values suppressed.');}
finally{await pool?.end();await admin.end();globalThis.fetch=originalFetch;report.finishedAt=new Date().toISOString();await writeFile(new URL('report.json',out),JSON.stringify(report,null,2));console.log('Report: '+fileURLToPath(new URL('report.json',out)));}
