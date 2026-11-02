import type {FastifyInstance,FastifyReply,FastifyRequest} from 'fastify';
import {z} from 'zod';
import {TeachingError} from './domain.js';
import {audit,ownClass,ownClaim,revision,roles,type Db,type Role} from './store.js';

type Run=(role:Role,fn:(db:Db,userId:string,req:FastifyRequest)=>Promise<unknown>)=>(req:FastifyRequest,reply:FastifyReply)=>Promise<unknown>;
const id=z.string().uuid(),rev=z.number().int().positive();
const fields=z.object({title:z.string().trim().min(1).max(120),brief:z.string().trim().min(10).max(50000),rubric:z.string().trim().min(3).max(5000)});
const parse=<S extends z.ZodTypeAny>(schema:S,value:unknown):z.output<S>=>{const p=schema.safeParse(value);if(!p.success)throw new TeachingError('invalid_input',400);return p.data;};
const parameter=(req:FastifyRequest)=>parse(z.object({id}),req.params).id;

async function owned(db:Db,userId:string,assignmentId:string){
 const row=(await db.query('SELECT a.* FROM teaching_assignments a JOIN teaching_classes k ON k.id=a.class_id WHERE a.id=$1 AND k.teacher_id=$2',[assignmentId,userId])).rows[0];
 if(!row)throw new TeachingError('not_found',404);return row;
}
async function draft(db:Db,assignmentId:string){return (await db.query("SELECT * FROM teaching_assignment_versions WHERE assignment_id=$1 AND state='draft'",[assignmentId])).rows[0]??null;}

export function registerAssignmentRoutes(app:FastifyInstance,run:Run){
 app.get('/teaching/assignments',run('student',async(db,userId)=>({assignments:(await db.query(`SELECT a.*,k.name AS class_name,k.teacher_id=$1 AS "isTeacher",
  COALESCE(cv.title,a.title) AS title,COALESCE(cv.brief,a.brief) AS brief,COALESCE(cv.rubric,a.rubric) AS rubric,
  c.id AS claim_id,c.project_id,c.state AS claim_state,c.revision AS claim_revision,c.assignment_version_id,cv.number AS assignment_version,
  pv.id AS latest_version_id,pv.number AS latest_version,pv.brief AS latest_brief,pv.rubric AS latest_rubric,pv.change_note,pv.applicability,
  (c.id IS NOT NULL AND c.assignment_version_id<>pv.id AND pv.applicability='offer_existing' AND c.acknowledged_version_id IS DISTINCT FROM pv.id) AS update_available,
  (SELECT v.number FROM teaching_assignment_versions v WHERE v.assignment_id=a.id AND v.state='draft') AS draft_version
  FROM teaching_assignments a JOIN teaching_classes k ON k.id=a.class_id
  LEFT JOIN teaching_claims c ON c.assignment_id=a.id AND c.student_id=$1
  LEFT JOIN teaching_assignment_versions cv ON cv.id=c.assignment_version_id
  LEFT JOIN teaching_assignment_versions pv ON pv.id=a.published_version_id
  WHERE (k.teacher_id=$1 AND EXISTS(SELECT 1 FROM teaching_roles WHERE user_id=$1 AND role='teacher' AND active))
   OR (a.state='published' AND EXISTS(SELECT 1 FROM teaching_members m WHERE m.class_id=k.id AND m.student_id=$1 AND m.active)) ORDER BY a.created_at DESC`,[userId])).rows})));

 app.get('/teaching/assignments/:id',run('student',async(db,userId,req)=>{
  const a=(await db.query('SELECT a.*,k.teacher_id FROM teaching_assignments a JOIN teaching_classes k ON k.id=a.class_id WHERE a.id=$1',[parameter(req)])).rows[0];
  if(!a)throw new TeachingError('not_found',404);
  const isTeacher=a.teacher_id===userId&&(await roles(db,userId)).includes('teacher');
  if(!isTeacher&&!(await db.query("SELECT 1 FROM teaching_members WHERE class_id=$1 AND student_id=$2 AND active AND $3='published'",[a.class_id,userId,a.state])).rowCount)throw new TeachingError('not_found',404);
  const versions=(await db.query("SELECT * FROM teaching_assignment_versions WHERE assignment_id=$1 AND state='published' ORDER BY number DESC",[a.id])).rows;
  return {assignment:a,versions,draft:isTeacher?await draft(db,a.id):null};
 }));

 app.post('/teaching/classes/:id/assignments',run('teacher',async(db,userId,req)=>{
  const classId=parameter(req);await ownClass(db,userId,classId);
  const b=parse(fields.extend({requestKey:id.optional()}).strict(),req.body);
  if(b.requestKey){const previous=(await db.query('SELECT * FROM teaching_assignments WHERE class_id=$1 AND create_request_key=$2',[classId,b.requestKey])).rows[0];if(previous)return {assignment:previous,reused:true};}
  const a=(await db.query('INSERT INTO teaching_assignments(class_id,title,brief,rubric,create_request_key) VALUES($1,$2,$3,$4,$5) RETURNING *',[classId,b.title,b.brief,b.rubric,b.requestKey??null])).rows[0];
  await db.query("INSERT INTO teaching_assignment_versions(assignment_id,number,state,title,brief,rubric,created_by) VALUES($1,1,'draft',$2,$3,$4,$5)",[a.id,b.title,b.brief,b.rubric,userId]);
  await audit(db,userId,'assignment_draft_created',a.id);return {assignment:a,reused:false};
 }));

 app.patch('/teaching/assignments/:id',run('teacher',async(db,userId,req)=>{
  const a=await owned(db,userId,parameter(req));
  const b=parse(fields.extend({expectedRevision:rev,changeNote:z.string().trim().max(5000).default(''),applicability:z.enum(['new_claims_only','offer_existing']).default('new_claims_only')}).strict(),req.body);
  revision(a.revision,b.expectedRevision);const d=await draft(db,a.id);if(!d)throw new TeachingError('assignment_revision_draft_required');
  await db.query('UPDATE teaching_assignment_versions SET title=$2,brief=$3,rubric=$4,change_note=$5,applicability=$6 WHERE id=$1',[d.id,b.title,b.brief,b.rubric,b.changeNote,b.applicability]);
  const updated=(await db.query("UPDATE teaching_assignments SET revision=revision+1,title=CASE WHEN state='draft' THEN $2 ELSE title END,brief=CASE WHEN state='draft' THEN $3 ELSE brief END,rubric=CASE WHEN state='draft' THEN $4 ELSE rubric END WHERE id=$1 RETURNING *",[a.id,b.title,b.brief,b.rubric])).rows[0];
  await audit(db,userId,'assignment_draft_edited',a.id,{version:d.number,previousRevision:a.revision});return {assignment:updated};
 }));

 app.post('/teaching/assignments/:id/revisions',run('teacher',async(db,userId,req)=>{
  const a=await owned(db,userId,parameter(req)),b=parse(z.object({expectedRevision:rev}).strict(),req.body);revision(a.revision,b.expectedRevision);
  if(a.state!=='published'||await draft(db,a.id))throw new TeachingError('assignment_draft_already_exists');
  await db.query(`INSERT INTO teaching_assignment_versions(assignment_id,number,state,title,brief,rubric,parent_id,created_by)
   SELECT assignment_id,number+1,'draft',title,brief,rubric,id,$2 FROM teaching_assignment_versions WHERE id=$1`,[a.published_version_id,userId]);
  const updated=(await db.query('UPDATE teaching_assignments SET revision=revision+1 WHERE id=$1 RETURNING *',[a.id])).rows[0];
  await audit(db,userId,'assignment_revision_started',a.id,{baseVersionId:a.published_version_id});return {assignment:updated};
 }));

 app.post('/teaching/assignments/:id/publish',run('teacher',async(db,userId,req)=>{
  const a=await owned(db,userId,parameter(req)),b=parse(z.object({expectedRevision:rev,confirmed:z.literal(true)}).strict(),req.body);revision(a.revision,b.expectedRevision);
  const d=await draft(db,a.id);if(!d)throw new TeachingError('teaching_state_changed');if(d.number>1&&d.change_note.length<10)throw new TeachingError('assignment_change_note_required',422);
  await db.query("UPDATE teaching_assignment_versions SET state='published',published_at=now() WHERE id=$1",[d.id]);
  await db.query("UPDATE teaching_assignments SET state='published',published_version_id=$2,title=$3,brief=$4,rubric=$5,revision=revision+1,published_at=now() WHERE id=$1",[a.id,d.id,d.title,d.brief,d.rubric]);
  await audit(db,userId,'assignment_published',a.id,{version:d.number,applicability:d.applicability});return {ok:true,version:d.number};
 }));

 app.post('/teaching/assignments/:id/claim',run('student',async(db,userId,req)=>{
  const a=(await db.query(`SELECT a.* FROM teaching_assignments a JOIN teaching_members m ON m.class_id=a.class_id AND m.student_id=$2 AND m.active WHERE a.id=$1 AND a.state='published'`,[parameter(req),userId])).rows[0];
  if(!a)throw new TeachingError('not_found',404);const existing=(await db.query('SELECT * FROM teaching_claims WHERE assignment_id=$1 AND student_id=$2',[a.id,userId])).rows[0];if(existing)return {claim:existing,reused:true};
  const p=(await db.query('INSERT INTO projects(owner_id,name,description) VALUES($1,$2,$3) RETURNING id',[userId,a.title,'领取班级实训任务创建的私有项目；提交前教师不可见正文。'])).rows[0];
  await db.query('INSERT INTO requirement_versions(project_id,version,content) VALUES($1,1,to_jsonb($2::text))',[p.id,a.brief]);
  const c=(await db.query('INSERT INTO teaching_claims(assignment_id,student_id,project_id,assignment_version_id) VALUES($1,$2,$3,$4) RETURNING *',[a.id,userId,p.id,a.published_version_id])).rows[0];
  await audit(db,userId,'assignment_claimed',c.id,{versionId:a.published_version_id});return {claim:c,reused:false};
 }));

 app.post('/teaching/claims/:id/assignment-update',run('student',async(db,userId,req)=>{
  const c=await ownClaim(db,userId,parameter(req)),b=parse(z.object({expectedRevision:rev,versionId:id,decision:z.enum(['adopt','keep']),reason:z.string().trim().min(10).max(5000),requirementsReviewed:z.literal(true)}).strict(),req.body);
  revision(c.revision,b.expectedRevision);if(!['working','returned'].includes(c.state))throw new TeachingError('assignment_change_requires_return');
  if(c.latest_version_id!==b.versionId||c.applicability!=='offer_existing'||c.assignment_version_id===b.versionId||c.acknowledged_version_id===b.versionId)throw new TeachingError('assignment_change_outdated');
  await db.query('INSERT INTO teaching_assignment_change_reviews(claim_id,student_id,from_version_id,to_version_id,decision,reason) VALUES($1,$2,$3,$4,$5,$6)',[c.id,userId,c.assignment_version_id,b.versionId,b.decision,b.reason]);
  await db.query("UPDATE teaching_claims SET acknowledged_version_id=$2,assignment_version_id=CASE WHEN $3='adopt' THEN $2 ELSE assignment_version_id END,revision=revision+1 WHERE id=$1",[c.id,b.versionId,b.decision]);
  await audit(db,userId,'assignment_change_reviewed',c.id,{decision:b.decision,versionId:b.versionId});return {ok:true,projectUnchanged:true};
 }));

 app.get('/teaching/classes/:id/progress',run('teacher',async(db,userId,req)=>{
  const classId=parameter(req);await ownClass(db,userId,classId);
  const members=(await db.query('SELECT count(*)::int AS n FROM teaching_members WHERE class_id=$1 AND active',[classId])).rows[0].n;
  const assignments=(await db.query(`SELECT a.id,a.title,a.published_version_id,
   count(*) FILTER(WHERE c.id IS NULL AND m.student_id IS NOT NULL)::int AS unclaimed,
   count(*) FILTER(WHERE c.state='working')::int AS working,count(*) FILTER(WHERE c.state='submitted')::int AS submitted,
   count(*) FILTER(WHERE c.state='returned')::int AS returned,count(*) FILTER(WHERE c.state='accepted')::int AS accepted
   FROM teaching_assignments a LEFT JOIN teaching_members m ON m.class_id=a.class_id AND m.active
   LEFT JOIN teaching_claims c ON c.assignment_id=a.id AND c.student_id=m.student_id
   WHERE a.class_id=$1 AND a.state='published' GROUP BY a.id ORDER BY a.created_at`,[classId])).rows;
  return {members,assignments,scope:'active_class_members_state_counts_no_private_content'};
 }));

 app.post('/teaching/classes/:id/leave',run('student',async(db,userId,req)=>{
  const classId=parameter(req),b=parse(z.object({expectedRevision:rev,confirmed:z.literal(true)}).strict(),req.body);
  const result=await db.query('UPDATE teaching_members SET active=false,revision=revision+1 WHERE class_id=$1 AND student_id=$2 AND active AND revision=$3 RETURNING revision',[classId,userId,b.expectedRevision]);
  if(!result.rowCount)throw new TeachingError('teaching_revision_changed');await audit(db,userId,'class_left',classId);return {ok:true,historyPreserved:true};
 }));
}
