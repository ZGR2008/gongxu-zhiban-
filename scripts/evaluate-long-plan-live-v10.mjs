// One expressly approved batch. Separate from offline verify and every old lock.
// Requests contain fixed REVIEW_PLACEHOLDER_575a8dfc08a84f40bc3b material only. No retries, adoption or publication.
import {createRequire} from 'node:module';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import assert from 'node:assert/strict';
import {longPlanPolicyV10 as policy,reserveLongPlanV10,assertApprovedMessagesV10} from '../evaluation/long-plan-budget-v10.mjs';
import {longBusinessCase} from '../evaluation/long-business-cases.mjs';
import {createApp} from '../apps/api/dist/app.js';
import {PgProjectStore} from '../apps/api/dist/project-store.js';
import {defaultScheme,inspectScheme,parseSegmentOutput,inspectMerge,PROMPT_VERSION} from '../apps/api/dist/long-plan/domain.js';
import {fragmentMessages} from '../apps/api/dist/long-plan/worker.js';

const args=process.argv.slice(2),continuation=args.length===1&&args[0]==='--continue-v10-zero-dispatch-preflight',approved=args.length===1&&(args[0]==='--approved-v10-13-calls-usd-0.50'||continuation);
if(args.length&&!approved&&args[0]!=='--preflight')throw Error('Unknown evaluation option');
const root=new URL('../',import.meta.url),digest=s=>createHash('sha256').update(s).digest('hex');
const saved=JSON.parse(await readFile(new URL('evaluation/fixtures/long-plan-v7-saved-responses.json',root),'utf8'));
const sample=longBusinessCase();assert.equal(sample.source,saved.source);assert.equal(sample.source.length,49781);assert.equal(PROMPT_VERSION,'long-plan-fragment-v2');
const prepare=project=>{const scheme=defaultScheme(project,sample.source);scheme.conditions.forEach(c=>{c.kind='acceptance';c.crossNote='原文含版本、权限与异常要求，跨章节含义和未决冲突必须在合并时再审。';});return scheme;};
const audit=inspectScheme('preflight',sample.source,prepare('preflight'));assert.equal(audit.errors.length,0);assert.equal(audit.segments.length,13);
const reservations=[];for(const segment of audit.segments)reservations.push(reserveLongPlanV10(reservations,fragmentMessages(sample.source,prepare('preflight'),segment,[])));
const preflight={policy,sourceHash:digest(sample.source),sourceUtf16Length:sample.source.length,segments:audit.segments.length,conditions:prepare('preflight').conditions.length,promptVersion:PROMPT_VERSION,reservedIfAllSegmentsUSD:reservations.reduce((n,r)=>n+r.reserveUSD,0),scope:'fixed_REVIEW_PLACEHOLDER_575a8dfc08a84f40bc3b_source_and_conditions_no_sources_no_real_RAG_no_tools',approvalConsumed:false};
console.log(JSON.stringify({preflight},null,2));
if(!approved)process.exit(0);

let previousLocalPreflight=null;
if(continuation){
 const previousPath=new URL('.runtime/quality-live-v10-cb81d9b8-5760-41bf-b821-92ac0a85e5d1/report.json',root),previousBytes=await readFile(previousPath),previous=JSON.parse(previousBytes);
 assert.equal(digest(previousBytes),'8fcc514e56334a93dd97a46e3970cbf859f412431f4bfa6429c36fd87b94fedc');
 assert.equal(previous.paidCallsAttempted,0);assert.deepEqual(previous.records,[]);assert.equal(previous.reservedUSD,0);assert.equal(previous.preflight.sourceHash,digest(sample.source));
 const priorLock=JSON.parse(await readFile(new URL('.runtime/quality-v10-approval-consumed.json',root),'utf8'));
 assert.equal(priorLock.report,fileURLToPath(previousPath));assert.deepEqual(priorLock.policy,policy);assert.equal(priorLock.authorization,previous.authorization);
 previousLocalPreflight={report:fileURLToPath(previousPath),sha256:digest(previousBytes),externalCalls:0,reason:'JSONB_key_order_preflight_rejected_before_external_dispatch',newAllowance:false};
}

const require=createRequire(new URL('../apps/api/package.json',import.meta.url));
require('dotenv').config({path:fileURLToPath(new URL('../apps/api/.env',import.meta.url)),quiet:true});
if(!process.env.AI_API_KEY)throw Error('local_model_credential_unavailable');
const local=s=>['localhost','127.0.0.1','[::1]'].includes(new URL(s).hostname);
if(!process.env.DATABASE_URL||!local(process.env.DATABASE_URL))throw Error('local_database_required');
const {Pool}=require('pg'),Fastify=require('fastify'),admin=new Pool({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:3000});
const database='gx_quality_v10_'+randomUUID().replaceAll('-',''),target=new URL(process.env.DATABASE_URL);target.pathname='/'+database;
const out=new URL(`.runtime/quality-live-v10-${randomUUID()}/`,root);await mkdir(out,{recursive:true});
const report={authorization:'explicit_new_user_approval_13_serial_calls_max_USD_0.50_v10',policy,preflight,previousLocalPreflight,startedAt:new Date().toISOString(),records:[],long:null,longSource:sample,paidCallsAttempted:0,automaticRetries:0,plansAdopted:0,independentHumanReviews:0,historicalCallsSeparate:{v4:12,v7Long:9,v7Teacher:4},retainedSyntheticDatabase:database,status:'preparing'};
const persist=()=>writeFile(new URL('report.json',out),JSON.stringify(report,null,2)+'\n');
let app,proxy,pool,origin,user,proxyBusy=false,expectedMessages=null,sourceScheme=null;
async function call(method,path,body,identity=user){
 const result=await fetch(origin+path,{method,redirect:'error',headers:{...(identity?{authorization:'Bearer '+identity.token}:{}),...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(130000)});
 const value=await result.json();if(!result.ok)throw Error('local_api_'+result.status+'_'+String(value.error));return value;
}
try{
 await admin.query(`CREATE DATABASE ${database} TEMPLATE template0`);
 await promisify(execFile)(process.execPath,[fileURLToPath(new URL('../apps/api/dist/migrate.js',import.meta.url))],{cwd:fileURLToPath(new URL('../apps/api/',import.meta.url)),env:{...process.env,DATABASE_URL:target.href},windowsHide:true,timeout:30000,maxBuffer:128000});
 pool=new Pool({connectionString:target.href,max:8,connectionTimeoutMillis:3000});
 proxy=Fastify();proxy.post('/chat/completions',async(req,reply)=>{
  // Validate the complete message payload against locally built approved content,
  // not merely a substring that could hide unrelated user data or source code.
  assert.equal(proxyBusy,false);assert.equal(req.body.model,policy.model);assert.equal(req.body.max_tokens,policy.maxOutputTokens);
  const messages=req.body.messages,payload=JSON.parse(messages[1].content),expected=expectedMessages?.get(payload.segment.key);
  assertApprovedMessagesV10(messages,expected);assert.deepEqual(payload.sources,[]);assert.equal(req.body.tools,undefined);
  assert.equal(report.records.some(r=>r.segmentKey===payload.segment.key),false,'duplicate_segment_dispatch_forbidden');
  const row={...reserveLongPlanV10(report.records,messages),segmentKey:payload.segment.key,part:payload.segment.part,messages,promptHash:digest(JSON.stringify(messages)),startedAt:new Date().toISOString(),output:null,usage:null,semanticReview:'pending'};
  report.records.push(row);await persist();proxyBusy=true;const started=Date.now();
  try{
   report.paidCallsAttempted++;row.status='dispatched';await persist();
   const result=await fetch('https://api.deepseek.com/chat/completions',{method:'POST',redirect:'error',headers:{'content-type':'application/json',authorization:'Bearer '+process.env.AI_API_KEY},body:JSON.stringify({model:policy.model,messages,temperature:policy.temperature,max_tokens:policy.maxOutputTokens,thinking:{type:'disabled'}}),signal:AbortSignal.timeout(115000)});
   row.httpStatus=result.status;
   if(!result.ok){row.status='provider_rejected_or_uncertain';await result.body?.cancel();return reply.code(result.status).send({error:'provider_request_failed'});}
   const data=await result.json(),choice=data.choices?.[0];assert.equal(typeof choice?.message?.content,'string');
   row.output=choice.message.content;row.outputHash=digest(row.output);row.finishReason=choice.finish_reason;row.usage=data.usage??null;row.providerModel=data.model??null;row.providerFingerprint=data.system_fingerprint??null;row.status='response_received';
   return {choices:[{message:{content:row.output},finish_reason:row.finishReason}],usage:row.usage};
  }catch{row.status='failed_or_uncertain';return reply.code(502).send({error:'provider_result_uncertain_no_retry'});}
  finally{row.durationMs=Date.now()-started;proxyBusy=false;await persist();console.log('Recorded part '+row.part+' '+row.status);}
 });
 const proxyUrl=await proxy.listen({host:'127.0.0.1',port:0});
 app=await createApp({pool,projectStore:new PgProjectStore(pool),database:{query:s=>pool.query(s),end:async()=>{}},corsOrigin:'http://127.0.0.1:5173',aiConfig:{baseUrl:proxyUrl,apiKey:'REVIEW_PLACEHOLDER_575a8dfc08a84f40bc3b-local-gateway',model:policy.model,timeoutMs:120000,maxOutputTokens:policy.maxOutputTokens}});
 origin=await app.listen({host:'127.0.0.1',port:0});
 user=await call('POST','/auth/register',{name:'长规划质量合成账号',email:`quality-${randomUUID()}@example.test`,password:randomBytes(24).toString('base64url')},null);
 const project=(await call('POST','/projects',{name:'合成校园设备与实训长需求补验',description:'单批批准范围；只产生候选，不自动采纳'})).project;
 const version=(await call('POST',`/projects/${project.id}/requirements`,{content:sample.source})).requirement;
 await call('POST',`/projects/${project.id}/requirements/${version.id}/confirm`,{expectedContent:sample.source});
 const path=`/projects/${project.id}/requirements/${version.id}/planning-scheme`;let scheme=await call('GET',path);
 sourceScheme=prepare(project.id);scheme=await call('PUT',path,{expectedRevision:scheme.revision,scheme:sourceScheme});
 scheme=await call('POST',path+'/review',{expectedRevision:scheme.revision,note:'合成补验准备：AI工程核对原文范围和条件，非独立教师审核；语义质量仍待审核。',acknowledged:true});
 sourceScheme=scheme.scheme;
 const sourceAudit=inspectScheme(project.id,sample.source,sourceScheme);assert.equal(sourceAudit.errors.length,0);
 expectedMessages=new Map(sourceAudit.segments.map(segment=>[segment.key,fragmentMessages(sample.source,sourceScheme,segment,[])]));
 const exactReservations=[];for(const messages of expectedMessages.values())exactReservations.push(reserveLongPlanV10(exactReservations,messages));
 report.preflight.exactReservationUSD=exactReservations.reduce((n,r)=>n+r.reserveUSD,0);report.preflight.conditionsRegeneratedForIsolatedProject=true;
 // Atomically consume this new authorization only after all local scope/setup
 // checks. Existing v7/v4 sentinels are never read for permission or removed.
 await writeFile(new URL(continuation?'.runtime/quality-v10-local-preflight-continuation-consumed.json':'.runtime/quality-v10-approval-consumed.json',root),JSON.stringify({authorization:report.authorization,policy,previousLocalPreflight,report:fileURLToPath(new URL('report.json',out)),date:new Date().toISOString()}),{flag:'wx'});
 report.preflight.approvalConsumed=true;await persist();
 const job=(await call('POST',`/projects/${project.id}/long-plans`,{versionId:version.id,schemeRevision:scheme.revision,requestKey:randomUUID(),acknowledgeExternalCall:true})).job;
 let detail;
 for(let i=0;i<1800;i++){detail=await call('GET',`/projects/${project.id}/long-plans/${job.id}`);if(!['queued','running'].includes(detail.job.status))break;await new Promise(resolve=>setTimeout(resolve,1000));}
 assert.ok(detail&&!['queued','running'].includes(detail.job.status));report.long=detail;
 report.segmentChecks=sourceAudit.segments.map(segment=>{
  const row=report.records.find(r=>r.segmentKey===segment.key);let structure='not_called',error=null;
  if(row?.output){try{if(row.finishReason!=='stop')throw Error('incomplete_output');parseSegmentOutput(row.output,segment,sourceScheme,[]);structure='accepted_not_semantic_proof';}catch(e){structure='rejected';error=e.message;}}
  return {part:segment.part,start:segment.start,end:segment.end,sourceHash:segment.sourceHash,called:!!row,structure,error,conditionIds:segment.conditionIds};
 });
 report.globalReview=detail.job.merge_draft?inspectMerge(sourceScheme,detail.job.merge_draft,[],detail.parts.flatMap(p=>p.result?.unresolved??[])):null;
 report.completeSourceDispatched=report.records.length===13&&report.records.map(r=>JSON.parse(r.messages[1].content).segment.content).join('')===sample.source;
 report.tailDispatched=report.records.some(r=>JSON.parse(r.messages[1].content).segment.end===sample.source.length);
 report.status=detail.job.status==='awaiting_review'?'all_segments_received_candidate_awaiting_human_review':'stopped_at_production_guard_no_retry';
}catch(error){report.status='interrupted_no_automatic_retry';report.safeReason=error.code==='EEXIST'?'new_batch_authorization_already_consumed':error.name==='AssertionError'?'preflight_or_protocol_assertion_failed':/^(local_api_|local_|call_limit|reserved_budget|input_scope)/.test(error.message)?error.message:'setup_or_transport_failure_details_suppressed';process.exitCode=1;}
finally{
 await app?.close();await proxy?.close();await pool?.end();await admin.end();
 report.reservedUSD=report.records.reduce((n,r)=>n+r.reserveUSD,0);
 report.estimatedPeakUSDFromUsage=report.records.filter(r=>r.usage).reduce((n,r)=>n+((r.usage.prompt_tokens??0)*policy.inputUSDPerMillion+(r.usage.completion_tokens??0)*policy.outputUSDPerMillion)/1e6,0);
 report.costNote='Per-dispatch conservative reservation controls the approved ceiling; usage-derived peak estimate is not an invoice. Unknown outcomes retain their full reservation.';
 report.finishedAt=new Date().toISOString();await persist();console.log(JSON.stringify({status:report.status,calls:report.paidCallsAttempted,reservedUSD:report.reservedUSD,report:fileURLToPath(new URL('report.json',out))}));
}
