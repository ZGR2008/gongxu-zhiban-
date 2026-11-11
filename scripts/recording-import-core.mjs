import {createHash, randomBytes, randomUUID} from 'node:crypto';

export const MATERIAL_SOURCE = 'demo-material-import-v1';
export const digest = text => createHash('sha256').update(text).digest('hex');
export class RecordingImportError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const fail = code => { throw new RecordingImportError(code); };
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;

/** Only a reviewed, original data kit can be imported. It carries no execution or approval fields. */
export function validateRecordingKit(kit) {
  if (kit?.schema !== 'recording-kit-v1' || kit.source !== MATERIAL_SOURCE || !/^[a-z0-9-]{1,100}$/.test(kit.key ?? '')) fail('invalid_kit');
  for (const field of ['className', 'assignmentTitle']) if (!text(kit[field], 120)) fail('invalid_kit');
  for (const field of ['briefV1', 'briefV2']) if (!text(kit[field], 50000)) fail('invalid_kit');
  if (!text(kit.rubric, 5000) || !text(kit.changeNote, 5000) || kit.changeNote.length < 10) fail('invalid_kit');
  if (!Array.isArray(kit.cases) || kit.cases.length < 1 || kit.cases.length > 50 || new Set(kit.cases.map(c => c.key)).size !== kit.cases.length) fail('invalid_cases');
  for (const c of kit.cases) {
    if (Object.keys(c).some(k => !['key','category','title','preconditions','steps','expected'].includes(k))) fail('unexpected_case_state');
    if (!['normal','boundary','exception'].includes(c.category) || !text(c.key, 100) || !text(c.title, 200)) fail('invalid_cases');
    // Reserve space for the immutable provenance stamp; match the production editor limits.
    if (!text(c.preconditions,1400) || !text(c.steps,4000) || !text(c.expected,3000)) fail('invalid_cases');
  }
  const kinds = ['readme','requirements','design','api','test_report','summary'];
  if (!Array.isArray(kit.documents) || kit.documents.length !== kinds.length || kinds.some(k => kit.documents.filter(d => d.type === k).length !== 1)) fail('invalid_documents');
  for (const d of kit.documents) {
    if (Object.keys(d).some(k => !['type','content'].includes(k)) || !text(d.content, 48000)) fail('invalid_documents');
  }
  return {kitHash:digest(JSON.stringify(kit)), requirementHash:digest(kit.briefV1)};
}

async function account(db, email, teacher) {
  const result = await db.query(`SELECT u.id, COALESCE(a.disabled,false) AS disabled,
    EXISTS(SELECT 1 FROM teaching_roles r WHERE r.user_id=u.id AND r.role='teacher' AND r.active) AS teacher
    FROM users u LEFT JOIN teaching_accounts a ON a.user_id=u.id WHERE lower(u.email)=lower($1)`, [email]);
  if (result.rowCount !== 1) fail(teacher ? 'teacher_not_unique' : 'student_not_unique');
  const row = result.rows[0];
  if (row.disabled) fail(teacher ? 'teacher_disabled' : 'student_disabled');
  if (teacher && !row.teacher) fail('teacher_role_required');
  return row.id;
}

/** Local, additive maintenance operation, explicitly authorized for these two identities.
 * Does not impersonate sessions, grant roles, confirm requirements, run AI, submit work or review it.
 * Published v1 and the initial claim are preparation performed by this import, recorded as such.
 */
export async function importRecordingMaterials(pool, {teacherEmail, studentEmail, kit, apply = false}) {
  const hashes = validateRecordingKit(kit);
  if (![teacherEmail,studentEmail].every(e => text(e,254) && /^[^\s@]+@[^\s@]+$/.test(e))) fail('invalid_identity');
  if (teacherEmail.toLowerCase() === studentEmail.toLowerCase()) fail('distinct_accounts_required');
  const db = await pool.connect();
  let locked = false;
  try {
    // Same gate as the production role/member revocation transaction, before opening its snapshot.
    await db.query("SELECT pg_advisory_lock(hashtext('gongxu-teaching-access'))"); locked = true;
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    const teacherId = await account(db, teacherEmail, true), studentId = await account(db, studentEmail, false);
    if (teacherId === studentId) fail('distinct_accounts_required');
    const prior = (await db.query(`SELECT metadata FROM teaching_audit WHERE actor_id=$1
      AND action='recording_materials_imported' AND metadata->>'kitKey'=$2 AND metadata->>'studentId'=$3`,
      [teacherId,kit.key,studentId])).rows;
    if (prior.length > 1) fail('duplicate_import_marker');
    if (prior.length === 1) {
      const m = prior[0].metadata;
      if (m.kitHash !== hashes.kitHash) fail('kit_changed_requires_new_review');
      const current = (await db.query(`SELECT r.content #>> '{}' AS content,r.status,c.state,
        (SELECT count(*)::int FROM practice_test_cases WHERE project_id=p.id) AS cases,
        (SELECT count(*)::int FROM project_documents WHERE project_id=p.id) AS documents
        FROM projects p JOIN requirement_versions r ON r.id=$2 AND r.project_id=p.id
        JOIN teaching_claims c ON c.id=$3 AND c.project_id=p.id AND c.student_id=p.owner_id
        JOIN teaching_assignments a ON a.id=c.assignment_id AND a.id=$4
        JOIN teaching_classes k ON k.id=a.class_id AND k.id=$5
        WHERE p.id=$1 AND p.owner_id=$6 AND k.teacher_id=$7`,
        [m.projectId,m.requirementId,m.claimId,m.assignmentId,m.classId,studentId,teacherId])).rows[0];
      if (!current) fail('prior_import_inconsistent_no_repair_attempted');
      await db.query('COMMIT');
      return {...m,reused:true,applied:false,current:{requirementStatus:current.status,claimState:current.state,cases:current.cases,documents:current.documents,originalRequirementChanged:digest(current.content)!==m.requirementHash}};
    }
    const expected = {classCount:1,assignmentCount:1,publishedVersions:1,draftVersions:1,privateProjects:1,cases:kit.cases.length,documents:kit.documents.length,requirementsConfirmed:0,formalAgentTasks:0,submissions:0,feedback:0,executions:0,modelCalls:0};
    if (!apply) { await db.query('ROLLBACK'); return {applied:false,reused:false,identitiesVerified:true,teacherAuthorized:true,kitKey:kit.key,...hashes,expected}; }

    const ids = Object.fromEntries(['classId','assignmentId','publishedVersionId','draftVersionId','projectId','requirementId','claimId'].map(k => [k,randomUUID()]));
    await db.query('INSERT INTO teaching_classes(id,teacher_id,name,join_code) VALUES($1,$2,$3,$4)', [ids.classId,teacherId,kit.className,randomBytes(12).toString('hex')]);
    await db.query('INSERT INTO teaching_members(class_id,student_id) VALUES($1,$2)', [ids.classId,studentId]);
    await db.query('INSERT INTO teaching_assignments(id,class_id,title,brief,rubric,create_request_key) VALUES($1,$2,$3,$4,$5,$6)', [ids.assignmentId,ids.classId,kit.assignmentTitle,kit.briefV1,kit.rubric,randomUUID()]);
    await db.query(`INSERT INTO teaching_assignment_versions(id,assignment_id,number,state,title,brief,rubric,created_by,published_at)
      VALUES($1,$2,1,'published',$3,$4,$5,$6,now())`, [ids.publishedVersionId,ids.assignmentId,kit.assignmentTitle,kit.briefV1,kit.rubric,teacherId]);
    // Only updates the assignment inserted in this transaction; no existing task is touched.
    await db.query("UPDATE teaching_assignments SET state='published',published_at=now(),published_version_id=$2,revision=2 WHERE id=$1", [ids.assignmentId,ids.publishedVersionId]);
    await db.query(`INSERT INTO teaching_assignment_versions(id,assignment_id,number,state,title,brief,rubric,parent_id,created_by,change_note,applicability)
      VALUES($1,$2,2,'draft',$3,$4,$5,$6,$7,$8,'offer_existing')`, [ids.draftVersionId,ids.assignmentId,kit.assignmentTitle,kit.briefV2,kit.rubric.replace('七日规则','对应版本的期限规则'),ids.publishedVersionId,teacherId,kit.changeNote]);
    await db.query('INSERT INTO projects(id,owner_id,name,description) VALUES($1,$2,$3,$4)', [ids.projectId,studentId,kit.assignmentTitle,'经账号持有人授权导入的合成教学设计；AI 辅助编写，未调用平台模型、未执行借用程序。提交前教师不可见私人正文。']);
    await db.query('INSERT INTO requirement_versions(id,project_id,version,content) VALUES($1,$2,1,to_jsonb($3::text))', [ids.requirementId,ids.projectId,kit.briefV1]);
    await db.query('INSERT INTO teaching_claims(id,assignment_id,student_id,project_id,assignment_version_id) VALUES($1,$2,$3,$4,$5)', [ids.claimId,ids.assignmentId,studentId,ids.projectId,ids.publishedVersionId]);
    const stamp = `演示资料导入 · AI 辅助编写 · 未调用平台模型 · 待人工审核。资料包 ${kit.key}；原需求 v1 SHA-256 ${hashes.requirementHash}。修改需求后须重新核对，不代表已执行或已验证。`;
    const caseIds = [], documentIds = [];
    for (const c of kit.cases) {
      const id = randomUUID(); caseIds.push(id);
      await db.query(`INSERT INTO practice_test_cases(id,project_id,requirement_version_id,category,title,preconditions,steps,expected,model_name)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [id,ids.projectId,ids.requirementId,c.category,c.title,`${stamp}\n${c.key}\n${c.preconditions}`,c.steps,c.expected,MATERIAL_SOURCE]);
    }
    for (const d of kit.documents) {
      const id = randomUUID(); documentIds.push(id);
      await db.query(`INSERT INTO project_documents(id,project_id,requirement_version_id,type,content,model_name,source_snapshot)
        VALUES($1,$2,$3,$4,$5,$6,NULL)`, [id,ids.projectId,ids.requirementId,d.type,`> ${stamp}\n\n${d.content}`,MATERIAL_SOURCE]);
    }
    const manifest = {schema:'recording-import-v1',kitKey:kit.key,...hashes,...ids,studentId,caseIds,documentIds,expected,
      preparation:'authorized_local_import_not_user_ui_actions',humanReview:false,paidModelCalls:0,createdAt:new Date().toISOString()};
    await db.query('INSERT INTO teaching_audit(actor_id,action,target_id,metadata) VALUES($1,$2,$3,$4)', [teacherId,'recording_materials_imported',ids.classId,JSON.stringify(manifest)]);
    await db.query('COMMIT');
    return {...manifest,applied:true,reused:false};
  } catch (error) {
    await db.query('ROLLBACK').catch(()=>{});
    throw error;
  } finally {
    try { if (locked) await db.query("SELECT pg_advisory_unlock(hashtext('gongxu-teaching-access'))"); }
    finally { db.release(); }
  }
}
