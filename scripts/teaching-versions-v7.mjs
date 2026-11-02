// Isolated real HTTP/SQL regression. No primary account or real model is used.
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
export async function teachingVersions({pool,call,ok,check}){
 const identities=[];for(let i=0;i<5;i++)identities.push(ok(await call('POST','/auth/register',{name:'版本回归合成身份'+i,email:`versions-${randomUUID()}@example.test`,password:randomBytes(24).toString('base64url')},null),201));
 const [student,peer,teacher,teacherB,adminUser]=identities;
 await pool.query("INSERT INTO teaching_roles(user_id,role) VALUES($1,'teacher'),($2,'teacher'),($3,'admin')",[teacher.user.id,teacherB.user.id,adminUser.user.id]);
 const c=ok(await call('POST','/teaching/classes',{name:'版本回归合成班'},teacher)).class;
 for(const who of [student,peer])ok(await call('POST','/teaching/join',{code:c.joinCode},who));
 const initial={title:'校园借用七日',brief:'借用最多七日；禁止申请人自行审批；保留归还与验收记录。',rubric:'核对期限和禁止自批的测试证据。'};
 let a=ok(await call('POST',`/teaching/classes/${c.id}/assignments`,initial,teacher)).assignment;
 await check('v7_existing_draft_updates_same_assignment_and_detects_stale_windows',async()=>{
  const edited={...initial,title:'校园借用七日 · 修订草稿',expectedRevision:a.revision};
  const r=ok(await call('PATCH',`/teaching/assignments/${a.id}`,edited,teacher));a=r.assignment;
  assert.equal(a.revision,2);assert.equal((await pool.query('SELECT count(*)::int AS n FROM teaching_assignments WHERE class_id=$1',[c.id])).rows[0].n,1);
  assert.equal((await call('PATCH',`/teaching/assignments/${a.id}`,edited,teacher)).status,409);
  assert.equal((await call('PATCH',`/teaching/assignments/${a.id}`,{...edited,expectedRevision:a.revision},student)).status,403);
  assert.equal((await call('PATCH',`/teaching/assignments/${a.id}`,{...edited,expectedRevision:a.revision},teacherB)).status,404);
  const rs=await Promise.all(['窗口A','窗口B'].map(title=>call('PATCH',`/teaching/assignments/${a.id}`,{...initial,title,expectedRevision:a.revision},teacher)));
  assert.deepEqual(rs.map(r=>r.status).sort(),[200,409]);a=rs.find(r=>r.status===200).body.assignment;
 });
 await check('v7_repeated_initial_save_key_creates_one_draft',async()=>{
  const input={...initial,title:'幂等草稿',requestKey:randomUUID()};
  const rs=await Promise.all([call('POST',`/teaching/classes/${c.id}/assignments`,input,teacher),call('POST',`/teaching/classes/${c.id}/assignments`,input,teacher)]);rs.forEach(r=>ok(r));assert.equal(rs[0].body.assignment.id,rs[1].body.assignment.id);
 });
 let claim,priorClaim,submitted;
 await check('v7_claim_and_submission_pin_immutable_assignment_version',async()=>{
  ok(await call('POST',`/teaching/assignments/${a.id}/publish`,{expectedRevision:a.revision,confirmed:true},teacher));
  claim=ok(await call('POST',`/teaching/assignments/${a.id}/claim`,{},student)).claim;
  priorClaim=ok(await call('POST',`/teaching/assignments/${a.id}/claim`,{},peer)).claim;
  for(const [who,cl] of [[student,claim],[peer,priorClaim]]){
   const d=ok(await call('GET',`/projects/${cl.project_id}`,undefined,who)),r=d.requirements[0];ok(await call('POST',`/projects/${cl.project_id}/requirements/${r.id}/confirm`,{expectedContent:r.content},who));
  }
  const p=ok(await call('GET',`/teaching/claims/${priorClaim.id}/preview`,undefined,peer));
  submitted=ok(await call('POST',`/teaching/claims/${priorClaim.id}/submit`,{expectedRevision:p.claimRevision,fingerprint:p.fingerprint,requestKey:randomUUID(),note:'已提交旧版，请保留原要求',shareSnapshot:true},peer)).submission;
  assert.equal(p.snapshot.assignment.version,1);assert.equal(p.snapshot.assignment.versionId,priorClaim.assignment_version_id);
 });
 let latest;
 await check('v7_publication_revision_is_traceable_and_never_rewrites_claimed_projects',async()=>{
  const before=(await pool.query('SELECT content FROM requirement_versions WHERE project_id=$1 ORDER BY version',[claim.project_id])).rows;
  a=ok(await call('GET',`/teaching/assignments/${a.id}`,undefined,teacher)).assignment;
  assert.equal((await call('PATCH',`/teaching/assignments/${a.id}`,{...initial,expectedRevision:a.revision},teacher)).status,409);
  a=ok(await call('POST',`/teaching/assignments/${a.id}/revisions`,{expectedRevision:a.revision},teacher)).assignment;
  const changed={...initial,title:'校园借用三日',brief:initial.brief.replace('七日','三日'),changeNote:'借用期限由七日改为三日，请检查边界测试和文档。',applicability:'offer_existing',expectedRevision:a.revision};
  a=ok(await call('PATCH',`/teaching/assignments/${a.id}`,changed,teacher)).assignment;
  const hidden=ok(await call('GET',`/teaching/assignments/${a.id}`,undefined,student));assert.equal(hidden.versions.length,1);assert.equal(hidden.draft,null);
  ok(await call('POST',`/teaching/assignments/${a.id}/publish`,{expectedRevision:a.revision,confirmed:true},teacher));
  latest=ok(await call('GET',`/teaching/assignments/${a.id}`,undefined,teacher)).versions.find(v=>v.number===2);
  assert.equal(latest.applicability,'offer_existing');assert.match(latest.change_note,/七日改为三日/);
  assert.deepEqual((await pool.query('SELECT content FROM requirement_versions WHERE project_id=$1 ORDER BY version',[claim.project_id])).rows,before);
  const mine=ok(await call('GET','/teaching/assignments',undefined,student)).assignments.find(x=>x.id===a.id);
  assert.equal(mine.assignment_version,1);assert.equal(mine.update_available,true);assert.match(mine.brief,/七日/);assert.match(mine.latest_brief,/三日/);
  const old=ok(await call('GET',`/teaching/submissions/${submitted.id}?role=teacher`,undefined,teacher));assert.equal(old.submission.snapshot.assignment.version,1);assert.match(old.submission.snapshot.assignment.brief,/七日/);
  assert.equal((await call('POST',`/teaching/claims/${priorClaim.id}/assignment-update`,{expectedRevision:2,versionId:latest.id,decision:'adopt',reason:'确认新的期限要求，并计划手动修订自己的需求与测试。',requirementsReviewed:true},peer)).status,409);
 });
 await check('v7_student_explicitly_reviews_changes_and_old_window_cannot_adopt_twice',async()=>{
  const p=ok(await call('GET',`/teaching/claims/${claim.id}/preview`,undefined,student));
  assert.equal((await call('POST',`/teaching/claims/${claim.id}/submit`,{expectedRevision:p.claimRevision,fingerprint:p.fingerprint,requestKey:randomUUID(),note:'尚未核对变更',shareSnapshot:true},student)).status,409);
  const input={expectedRevision:claim.revision,versionId:latest.id,decision:'adopt',reason:'核对三日期限，接下来手动修订项目需求和测试。',requirementsReviewed:true};
  ok(await call('POST',`/teaching/claims/${claim.id}/assignment-update`,input,student));
  assert.equal((await call('POST',`/teaching/claims/${claim.id}/assignment-update`,input,student)).status,409);
  const d=ok(await call('GET',`/projects/${claim.project_id}`,undefined,student));assert.match(d.requirements[0].content,/七日/);
  const newPreview=ok(await call('GET',`/teaching/claims/${claim.id}/preview`,undefined,student));assert.equal(newPreview.snapshot.assignment.version,2);
 });
 await check('v7_progress_and_review_exceptions_do_not_read_or_mark_private_tests_passed',async()=>{
  const progress=ok(await call('GET',`/teaching/classes/${c.id}/progress`,undefined,teacher));
  assert.equal(progress.members,2);const row=progress.assignments.find(x=>x.id===a.id);assert.equal(row.working,1);assert.equal(row.submitted,1);
  assert.equal((await call('GET',`/teaching/classes/${c.id}/progress`,undefined,teacherB)).status,404);
  assert.equal((await call('GET',`/teaching/classes/${c.id}/progress`,undefined,adminUser)).status,403);
  const decision={expectedRevision:2,decision:'accept',note:'演示检查，没有执行学生代码',reviewedEvidence:true,reviewChecks:{requirements:true,tests:true,versions:true}};
  assert.equal((await call('POST',`/teaching/submissions/${submitted.id}/decision`,decision,teacher)).status,422);
  ok(await call('POST',`/teaching/submissions/${submitted.id}/decision`,{...decision,exceptionReason:'此次为阶段性需求验收，缺失的执行证据须后续补齐；不宣称所有测试通过。'},teacher));
  const saved=ok(await call('GET',`/teaching/submissions/${submitted.id}?role=teacher`,undefined,teacher));assert.match(saved.decision.exception_reason,/阶段性/);assert.ok(saved.submission.snapshot.gaps.length>0);
 });
 await check('v7_published_rows_immutable_new_claim_scope_and_explicit_keep',async()=>{
  await assert.rejects(()=>pool.query("UPDATE teaching_assignment_versions SET title='invalid overwrite' WHERE id=$1",[latest.id]));
  const publishNext=async(applicability)=>{let d=ok(await call('GET',`/teaching/assignments/${a.id}`,undefined,teacher));let row=ok(await call('POST',`/teaching/assignments/${a.id}/revisions`,{expectedRevision:d.assignment.revision},teacher)).assignment;row=ok(await call('PATCH',`/teaching/assignments/${a.id}`,{...initial,changeNote:'增加核对归还记录的要求，学生按明确版本处理。',applicability,expectedRevision:row.revision},teacher)).assignment;ok(await call('POST',`/teaching/assignments/${a.id}/publish`,{expectedRevision:row.revision,confirmed:true},teacher));return ok(await call('GET',`/teaching/assignments/${a.id}`,undefined,teacher)).versions[0];};
  const v3=await publishNext('new_claims_only');assert.equal(v3.number,3);let mine=ok(await call('GET','/teaching/assignments',undefined,student)).assignments.find(x=>x.id===a.id);assert.equal(mine.update_available,false);assert.equal(mine.assignment_version,2);
  const newcomer=ok(await call('POST','/auth/register',{name:'新领取合成学生',email:`new-claim-${randomUUID()}@example.test`,password:randomBytes(24).toString('base64url')},null),201);ok(await call('POST','/teaching/join',{code:c.joinCode},newcomer));const nc=ok(await call('POST',`/teaching/assignments/${a.id}/claim`,{},newcomer)).claim;assert.equal(nc.assignment_version_id,v3.id);
  const v4=await publishNext('offer_existing');mine=ok(await call('GET','/teaching/assignments',undefined,student)).assignments.find(x=>x.id===a.id);ok(await call('POST',`/teaching/claims/${claim.id}/assignment-update`,{expectedRevision:mine.claim_revision,versionId:v4.id,decision:'keep',reason:'保留本次已领取的第二版任务，补充内容放在后续阶段复核。',requirementsReviewed:true},student));mine=ok(await call('GET','/teaching/assignments',undefined,student)).assignments.find(x=>x.id===a.id);assert.equal(mine.update_available,false);assert.equal(mine.assignment_version,2);assert.equal((await pool.query("SELECT count(*)::int AS n FROM teaching_assignment_change_reviews WHERE claim_id=$1 AND decision='keep'",[claim.id])).rows[0].n,1);
 });
 await check('v7_student_exit_revokes_existing_session_access_without_deleting_history',async()=>{
  const member=ok(await call('GET','/teaching/classes',undefined,student)).classes.find(x=>x.id===c.id);
  ok(await call('POST',`/teaching/classes/${c.id}/leave`,{expectedRevision:member.membership_revision,confirmed:true},student));
  assert.equal((await call('GET',`/teaching/claims/${claim.id}/preview`,undefined,student)).status,404);
  assert.equal((await call('GET',`/teaching/assignments/${a.id}`,undefined,student)).status,404);
  assert.equal((await call('GET',`/projects/${claim.project_id}`,undefined,student)).status,200);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM teaching_submissions WHERE id=$1',[submitted.id])).rows[0].n,1);
 });
}
