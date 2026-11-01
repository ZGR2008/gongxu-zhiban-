import type {Pool,PoolClient} from 'pg';
import {TeachingError, snapshotDigest, teachingGaps} from './domain.js';
import {requirementItems} from '../trace/domain.js';
import {readEvidenceSnapshot} from '../documents/evidence.js';
export type Role='student'|'teacher'|'admin';
export type Db=PoolClient;
export async function roles(db:Pick<Db,'query'>,userId:string):Promise<Role[]>{
 const account=(await db.query('SELECT disabled FROM teaching_accounts WHERE user_id=$1',[userId])).rows[0];
 if(account?.disabled)throw new TeachingError('account_disabled',403);
 return ['student',...(await db.query("SELECT role FROM teaching_roles WHERE user_id=$1 AND active ORDER BY role",[userId])).rows.map(r=>r.role)];
}
export async function transaction<T>(pool:Pool,userId:string,role:Role,run:(db:Db)=>Promise<T>):Promise<T>{
 const db=await pool.connect();
 try{
  // Short local transactions share this gate with role/member revocation. Never hold it during AI/network work.
  // Acquire BEFORE opening the MVCC snapshot: a waiter must observe a completed revocation.
  await db.query("SELECT pg_advisory_lock(hashtext('gongxu-teaching-access'))");
  await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
  if(!(await roles(db,userId)).includes(role))throw new TeachingError('role_not_authorized',403);
  const result=await run(db);await db.query('COMMIT');return result;
 }catch(error){await db.query('ROLLBACK');if((error as {code?:string}).code==='40001')throw new TeachingError('teaching_revision_changed');throw error;}finally{try{await db.query("SELECT pg_advisory_unlock(hashtext('gongxu-teaching-access'))");}finally{db.release();}}
}
export async function audit(db:Db,userId:string,action:string,target:string,metadata:Record<string,unknown>={}){
 await db.query('INSERT INTO teaching_audit(actor_id,action,target_id,metadata) VALUES($1,$2,$3,$4)',[userId,action,target,JSON.stringify(metadata)]);
}
export async function ownClass(db:Db,userId:string,id:string){
 const row=(await db.query('SELECT * FROM teaching_classes WHERE id=$1 AND teacher_id=$2',[id,userId])).rows[0];
 if(!row)throw new TeachingError('not_found',404);return row;
}
export async function ownClaim(db:Db,userId:string,id:string){
 const row=(await db.query(`SELECT c.*,a.class_id,a.title,a.brief,a.rubric,a.revision AS assignment_revision FROM teaching_claims c
 JOIN teaching_assignments a ON a.id=c.assignment_id JOIN teaching_members m ON m.class_id=a.class_id AND m.student_id=c.student_id AND m.active
 WHERE c.id=$1 AND c.student_id=$2 FOR UPDATE OF c`,[id,userId])).rows[0];
 if(!row)throw new TeachingError('not_found',404);return row;
}
export async function submitted(db:Db,userId:string,id:string,role:Role){
 const row=(await db.query(`SELECT s.*,c.student_id,c.revision AS claim_revision,c.state,c.id AS owned_claim_id,a.class_id,k.teacher_id,u.name AS student_name
 FROM teaching_submissions s JOIN teaching_claims c ON c.id=s.claim_id JOIN teaching_assignments a ON a.id=c.assignment_id
 JOIN teaching_classes k ON k.id=a.class_id JOIN teaching_members m ON m.class_id=k.id AND m.student_id=c.student_id AND m.active
 JOIN users u ON u.id=c.student_id WHERE s.id=$1 AND ${role==='teacher'?'k.teacher_id':'c.student_id'}=$2`,[id,userId])).rows[0];
 if(!row)throw new TeachingError('not_found',404);
 if(role==='teacher'&&row.student_id===userId)throw new TeachingError('self_review_forbidden',403);
 return row;
}
export function revision(actual:number,expected:number){if(actual!==expected)throw new TeachingError('teaching_revision_changed');}

/** Only explicitly submitted current-version data. No code drafts, uploaded knowledge, old projects or private generations. */
export async function makeSnapshot(db:Db,claim:Record<string,any>){
 const project=(await db.query('SELECT id,name,description FROM projects WHERE id=$1 AND owner_id=$2 FOR UPDATE',[claim.project_id,claim.student_id])).rows[0];
 if(!project)throw new TeachingError('not_found',404);
 const requirement=(await db.query("SELECT id,version,content #>> '{}' AS content,status FROM requirement_versions WHERE project_id=$1 ORDER BY version DESC LIMIT 1",[project.id])).rows[0];
 if(!requirement||requirement.status!=='confirmed')throw new TeachingError('confirmed_latest_requirement_required',422);
 const params=[project.id,requirement.id];
 const read=async(sql:string)=>{const rows=(await db.query(sql+' LIMIT 1001',params)).rows;if(rows.length>1000)throw new TeachingError('submission_snapshot_too_large',422);return rows;};
 const tasks=await read('SELECT id,title,stage,description,deliverable,status,agent_run_id FROM tasks WHERE project_id=$1 AND requirement_version_id=$2 ORDER BY id');
 const cases=await read('SELECT id,title,category,preconditions,steps,expected,result,execution_note,executed_at,revision,execution_revision,model_name FROM practice_test_cases WHERE project_id=$1 AND requirement_version_id=$2 ORDER BY id');
 const documents=await read('SELECT id,type,content,revision,source_snapshot FROM project_documents WHERE project_id=$1 AND requirement_version_id=$2 ORDER BY id');
 const links=await read('SELECT id,item_id,task_id,case_id,case_revision,status,origin,review_note FROM trace_links WHERE project_id=$1 AND requirement_version_id=$2 ORDER BY id');
 const chains=await read('SELECT id,item_id,task_id,case_id,case_revision,status,review_note,reviewed_at FROM task_test_links WHERE project_id=$1 AND requirement_version_id=$2 ORDER BY id');
 const items=requirementItems(project.id,requirement.id,requirement.content);
 const current=await readEvidenceSnapshot(db,claim.student_id,project.id,requirement.id);
 // A fresh read timestamp is not a source change; do not put it in the submission fingerprint.
 const evidence=current?{requirementVersionId:current.requirementVersionId,taskRevision:current.taskRevision,caseRevision:current.caseRevision,traceRevision:current.traceRevision}:null;
 const snapshot={schema:'teaching-submission-v1',assignment:{id:claim.assignment_id,title:claim.title,brief:claim.brief,rubric:claim.rubric,revision:claim.assignment_revision},project,requirement,tasks,cases,documents,items,links,chains,
  evidence,gaps:teachingGaps({tasks,cases,documents,items,links,chains,evidence}),evidenceKind:'人工登记，平台未执行学生代码；教师验收不改变测试结果'};
 if(Buffer.byteLength(JSON.stringify(snapshot))>1_000_000)throw new TeachingError('submission_snapshot_too_large',422);
 return {snapshot,fingerprint:snapshotDigest(snapshot)};
}
