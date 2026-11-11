// Synthetic identities in teaching-local's isolated database; provider/embedding are explicit local protocol fixtures.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {createApp} from '../apps/api/dist/app.js';
import {PgProjectStore} from '../apps/api/dist/project-store.js';
import {savePublicLesson} from '../apps/api/dist/rag/public.js';
import {transaction} from '../apps/api/dist/teaching/store.js';
const require=createRequire(new URL('../apps/api/package.json',import.meta.url));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
export async function teachingFaults({pool,student,teacher,teacherB,adminUser,classId,check}){
 const provider=require('fastify')();let mode='ok',gate,entered,chatCalls=0;
 provider.post('/chat/completions',async(_req,reply)=>{chatCalls++;if(mode==='hold'){entered.resolve();await gate.promise;}if(mode==='fail')return reply.code(503).send({error:'REVIEW_PLACEHOLDER_575a8dfc08a84f40bc3b'});return{choices:[{finish_reason:'stop',message:{content:'协议测试替身：缺少自审批被拒绝的执行证据，请教师核对后修改。'}}],usage:{prompt_tokens:20,completion_tokens:10,total_tokens:30}};});
 provider.post('/embeddings',async req=>{if(mode==='hold-index'){entered.resolve();await gate.promise;}return{data:req.body.input.map((_,index)=>({index,embedding:[1,0]}))};});
 const origin=await provider.listen({host:'127.0.0.1',port:0});
 const app=await createApp({pool,projectStore:new PgProjectStore(pool),aiConfig:{baseUrl:origin,model:'REVIEW_PLACEHOLDER_575a8dfc08a84f40bc3b-local-protocol',apiKey:'fixture-not-a-credential',timeoutMs:2000},embeddingConfig:{baseUrl:origin,model:'REVIEW_PLACEHOLDER_575a8dfc08a84f40bc3b-local-protocol',apiKey:''},corsOrigin:'http://127.0.0.1:5173'});
 async function req(method,url,payload,who=student){const r=await app.inject({method,url,payload,headers:{authorization:'Bearer '+who.token}});return{status:r.statusCode,body:r.json()};}
 const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.body));return r.body;};
 let submission;
 try{
  const a=ok(await req('POST',`/teaching/classes/${classId}/assignments`,{title:'AI 点评授权与并发协议',brief:'本任务为合成协议验证，禁止申请人自行审批，执行证据不得凭空生成。',rubric:'先核对原文、再核对实际观察，教师确认后才发布点评。'},teacher)).assignment;
  ok(await req('POST',`/teaching/assignments/${a.id}/publish`,{expectedRevision:1,confirmed:true},teacher));
  const claim=ok(await req('POST',`/teaching/assignments/${a.id}/claim`,{})).claim;
  const d=ok(await req('GET',`/projects/${claim.project_id}`));
  ok(await req('POST',`/projects/${claim.project_id}/requirements/${d.requirements[0].id}/confirm`,{expectedContent:d.requirements[0].content}));
  const p=ok(await req('GET',`/teaching/claims/${claim.id}/preview`));
  submission=ok(await req('POST',`/teaching/claims/${claim.id}/submit`,{expectedRevision:1,fingerprint:p.fingerprint,requestKey:randomUUID(),note:'只授权本次合成快照给本地替身，不是真实模型质量评测。',shareSnapshot:true,allowAiReview:true})).submission;
  await check('ai_draft_requires_teacher_edit_review_and_remains_private',async()=>{
   const privateConsent=(await pool.query('SELECT id FROM teaching_submissions WHERE allow_ai_review=false LIMIT 1')).rows[0];
   assert.equal((await req('POST',`/teaching/submissions/${privateConsent.id}/feedback-ai`,{requestKey:randomUUID(),acknowledgeExternalCall:true},teacher)).body.error,'student_ai_consent_required');assert.equal(chatCalls,0);
   ok(await req('PATCH',`/teaching/admin/accounts/${teacher.user.id}`,{disabled:false,monthlyCallLimit:1,expectedRevision:1,reason:'合成配额协议检查'},adminUser));
   const key=randomUUID(),draft=ok(await req('POST',`/teaching/submissions/${submission.id}/feedback-ai`,{requestKey:key,acknowledgeExternalCall:true},teacher)).feedback;
   assert.equal(chatCalls,1);assert.equal(ok(await req('GET',`/teaching/submissions/${submission.id}`)).feedback.length,0);
   assert.equal(ok(await req('POST',`/teaching/submissions/${submission.id}/feedback-ai`,{requestKey:key,acknowledgeExternalCall:true},teacher)).reused,true);assert.equal(chatCalls,1);
   assert.equal((await req('POST',`/teaching/submissions/${submission.id}/feedback-ai`,{requestKey:randomUUID(),acknowledgeExternalCall:true},teacher)).body.error,'ai_call_quota_exhausted');assert.equal(chatCalls,1);
   assert.equal((await pool.query('SELECT attempts FROM ai_call_budget WHERE user_id=$1',[teacher.user.id])).rows[0].attempts,1);
   const receipt=(await pool.query('SELECT status,usage FROM ai_call_receipts WHERE user_id=$1',[teacher.user.id])).rows[0];assert.equal(receipt.status,'response_received');assert.equal(receipt.usage.totalTokens,30);
   assert.equal((await req('PATCH',`/teaching/feedback/${draft.id}`,{expectedRevision:2,content:'学生不能修改教师草稿。'})).status,403);
   ok(await req('PATCH',`/teaching/feedback/${draft.id}`,{expectedRevision:2,content:'教师修订：请执行自审批被拒绝的用例，附实际观察。'},teacher));
   assert.equal((await req('PATCH',`/teaching/feedback/${draft.id}`,{expectedRevision:2,content:'迟到窗口不得覆盖修订。'},teacher)).status,409);
   assert.equal((await req('POST',`/teaching/feedback/${draft.id}/publish`,{expectedRevision:3,content:'缺少明确确认'},teacher)).status,400);
   ok(await req('POST',`/teaching/feedback/${draft.id}/publish`,{expectedRevision:3,content:'教师修订：请执行自审批被拒绝的用例，附实际观察。',teacherConfirmed:true},teacher));
   const visible=ok(await req('GET',`/teaching/submissions/${submission.id}`)).feedback;assert.equal(visible.length,1);assert.equal(visible[0].origin,'ai_assisted');assert.match(visible[0].content,/教师修订/);
   assert.match((await pool.query('SELECT raw_ai_draft FROM teaching_feedback WHERE id=$1',[draft.id])).rows[0].raw_ai_draft,/协议测试替身/);
  });
  await check('ai_failure_and_inflight_role_revocation_never_publish_or_automatically_retry',async()=>{
   ok(await req('PATCH',`/teaching/admin/accounts/${teacher.user.id}`,{disabled:false,monthlyCallLimit:20,expectedRevision:2,reason:'允许有限本地替身验证'},adminUser));
   mode='fail';const key=randomUUID();const failed=await req('POST',`/teaching/submissions/${submission.id}/feedback-ai`,{requestKey:key,acknowledgeExternalCall:true},teacher);assert.equal(failed.status,502);const count=chatCalls;
   const again=ok(await req('POST',`/teaching/submissions/${submission.id}/feedback-ai`,{requestKey:key,acknowledgeExternalCall:true},teacher));assert.equal(again.feedback.generation_state,'failed_or_uncertain');assert.equal(chatCalls,count);
   mode='hold';gate=deferred();entered=deferred();const inflight=req('POST',`/teaching/submissions/${submission.id}/feedback-ai`,{requestKey:randomUUID(),acknowledgeExternalCall:true},teacher);await entered.promise;
   ok(await req('PUT',`/teaching/admin/accounts/${teacher.user.id}/roles`,{role:'teacher',active:false,expectedRevision:3,reason:'等待模型期间撤权'},adminUser));gate.resolve();assert.equal((await inflight).status,403);
   assert.equal(ok(await req('GET',`/teaching/submissions/${submission.id}`)).feedback.length,1);
   ok(await req('PUT',`/teaching/admin/accounts/${teacher.user.id}/roles`,{role:'teacher',active:true,expectedRevision:4,reason:'恢复合成教师角色'},adminUser));mode='ok';
  });
  await check('public_version_is_append_only_and_publication_rolls_back_with_audit_transaction',async()=>{
   const lesson={lessonId:'GX-PROTOCOL-02',version:'1.0.0',title:'事务回滚合成协议',category:'安全权限',sources:[],text:'公共发布与审计应为同一事务；这只是协议夹具。\n'.repeat(24)};
   await assert.rejects(transaction(pool,adminUser.user.id,'admin',async db=>{await savePublicLesson(pool,lesson,db);throw Error('REVIEW_PLACEHOLDER_575a8dfc08a84f40bc3b_audit_failure');}),/REVIEW_PLACEHOLDER_575a8dfc08a84f40bc3b_audit_failure/);
   assert.equal((await pool.query("SELECT count(*)::int AS n FROM knowledge_documents WHERE source_metadata->>'lessonId'=$1",[lesson.lessonId])).rows[0].n,0);
   ok(await req('POST','/knowledge/public',lesson,adminUser));assert.equal((await req('POST','/knowledge/public',{...lesson,text:lesson.text+'内容修改必须换版本。'},adminUser)).body.error,'public_version_already_exists');
  });
  await check('public_index_rechecks_revoked_maintainer_after_inference_before_commit',async()=>{
   ok(await req('PUT',`/teaching/admin/accounts/${teacherB.user.id}/roles`,{role:'admin',active:true,expectedRevision:0,reason:'合成公共索引维护测试'},adminUser));
   const doc=ok(await req('POST','/knowledge/public',{lessonId:'GX-PROTOCOL-03',version:'1.0.0',title:'索引撤权合成协议',category:'安全权限',sources:[],text:'耗时计算结束后必须重新检查授权，撤权后不得写入。\n'.repeat(22)},teacherB));
   mode='hold-index';gate=deferred();entered=deferred();const indexing=req('POST',`/knowledge/public/${doc.id}/index`,{},teacherB);await entered.promise;
   ok(await req('PUT',`/teaching/admin/accounts/${teacherB.user.id}/roles`,{role:'admin',active:false,expectedRevision:1,reason:'索引等待期间撤权'},adminUser));gate.resolve();assert.equal((await indexing).status,403);
   assert.equal((await pool.query('SELECT count(embedding)::int AS n FROM knowledge_chunks WHERE document_id=$1',[doc.id])).rows[0].n,0);mode='ok';
   ok(await req('POST',`/knowledge/public/${doc.id}/index`,{},adminUser));assert.ok((await pool.query('SELECT count(embedding)::int AS n FROM knowledge_chunks WHERE document_id=$1',[doc.id])).rows[0].n>0);
  });
 }finally{gate?.resolve();await app.close();await provider.close();}
}
