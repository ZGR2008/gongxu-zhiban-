import type {Pool,PoolClient} from 'pg';
import {defaultScheme,hash,inspectScheme,inspectMerge,buildMerge,parseSegmentOutput,type Scheme,type Merge,type SegmentOutput,PROMPT_VERSION} from './domain.js';
import type {AiConfig} from '../ai/model.js';
import {requirementItems} from '../trace/domain.js';
export class PlanningError extends Error {constructor(public code:string,public status=409){super(code);}}
export const modelSnapshot=(ai:AiConfig)=>({providerBase:ai.baseUrl,model:ai.model,timeoutMs:ai.timeoutMs,maxOutputTokens:ai.maxOutputTokens??4096,temperature:0.3,reasoningEffort:ai.reasoningEffort??null});
export const modelFingerprint=(snapshot:ReturnType<typeof modelSnapshot>)=>hash(JSON.stringify(Object.entries(snapshot).sort(([a],[b])=>a.localeCompare(b))));
export type SchemeRow={id:string;owner_id:string;project_id:string;requirement_version_id:string;source_content:string;source_hash:string;revision:number;scheme:Scheme;review:unknown;reviewed_revision:number|null};
export type Job={id:string;owner_id:string;project_id:string;requirement_version_id:string;scheme_id:string;scheme_revision:number;scheme_snapshot:Scheme;source_content:string;source_hash:string;prompt_version:string;model_snapshot:ReturnType<typeof modelSnapshot>;status:string;revision:number;merge_draft:Merge|null;merge_review:unknown;adopted_run_id:string|null;lease_token:string|null;dispatcher_id:string;error_code:string|null};
export type Part={job_id:string;segment_key:string;position:number;start_offset:number;end_offset:number;source_hash:string;status:string;attempts:number;result:SegmentOutput|null;result_origin:string|null;error_code:string|null};
export type Attempt={id:string;segment_key:string;attempt_no:number;status:string;request_snapshot:{messages:unknown[];sources:Source[];retrieval:string};raw_output:string|null;usage:unknown;finish_reason:string|null;error_code:string|null};
export type Source={id:string;documentId:string;documentName:string;page:number|null;content:string};
/** Old persisted successes are data, not a waiver of the current validator.
 * Fail without changing them; correction must use the audited human endpoint. */
export function assertCompletedParts(job:Job,parts:Part[],attempts:Attempt[]){
 const segments=inspectScheme(job.project_id,job.source_content,job.scheme_snapshot).segments;
 for(const part of parts.filter(p=>p.status==='succeeded')){
  const segment=segments.find(s=>s.key===part.segment_key);
  try{
   if(!segment||!part.result)throw Error('missing_result');
   parseSegmentOutput(JSON.stringify(part.result),segment,job.scheme_snapshot,attempts.filter(a=>a.segment_key===part.segment_key).flatMap(a=>a.request_snapshot.sources.map(s=>s.id)));
  }catch{throw new PlanningError('part_result_invalid',422);}
 }
}
export async function transaction<T>(pool:Pool,work:(db:PoolClient)=>Promise<T>){const db=await pool.connect();try{await db.query('BEGIN');const result=await work(db);await db.query('COMMIT');return result;}catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}}
export async function lockProject(db:PoolClient,owner:string,project:string,version?:string){
 if(!(await db.query('SELECT id FROM projects WHERE id=$1 AND owner_id=$2 FOR UPDATE',[project,owner])).rowCount)throw new PlanningError('not_found',404);
 const current=(await db.query<{id:string;content:string}>("SELECT id,content FROM requirement_versions WHERE project_id=$1 AND status='confirmed' ORDER BY version DESC LIMIT 1",[project])).rows[0];
 if(version&&current?.id!==version)throw new PlanningError('requirement_version_outdated');return current;
}
export async function event(db:PoolClient,job:string,kind:string,actor:string|null,snapshot:unknown){await db.query('INSERT INTO long_plan_job_events(job_id,kind,actor_id,snapshot) VALUES($1,$2,$3,$4::jsonb)',[job,kind,actor,JSON.stringify(snapshot)]);}
export class LongPlanStore {
 constructor(readonly pool:Pool){}
 async scheme(owner:string,project:string,version:string){
  const current=(await this.pool.query<{id:string;content:string;current:boolean}>(`SELECT r.id,r.content,r.id=(SELECT id FROM requirement_versions WHERE project_id=$2 AND status='confirmed' ORDER BY version DESC LIMIT 1) AS current FROM requirement_versions r JOIN projects p ON p.id=r.project_id WHERE r.id=$3 AND r.project_id=$2 AND p.owner_id=$1 AND r.status='confirmed'`,[owner,project,version])).rows[0];
  if(!current)throw new PlanningError('not_found',404);
  await this.pool.query(`INSERT INTO long_plan_schemes(owner_id,project_id,requirement_version_id,source_content,source_hash,scheme) VALUES($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT(project_id,requirement_version_id) DO NOTHING`,[owner,project,version,current.content,hash(current.content),JSON.stringify(defaultScheme(project,current.content))]);
  const row=(await this.pool.query<SchemeRow>('SELECT * FROM long_plan_schemes WHERE owner_id=$1 AND project_id=$2 AND requirement_version_id=$3',[owner,project,version])).rows[0];
  return {...row,current:current.current,audit:inspectScheme(project,row.source_content,row.scheme)};
 }
 async saveScheme(owner:string,project:string,version:string,revision:number,scheme:Scheme){return transaction(this.pool,async db=>{
  await lockProject(db,owner,project,version);
  const row=(await db.query<SchemeRow>('SELECT * FROM long_plan_schemes WHERE project_id=$1 AND requirement_version_id=$2 FOR UPDATE',[project,version])).rows[0];
  if(!row||row.revision!==revision)throw new PlanningError('scheme_revision_changed');
  inspectScheme(project,row.source_content,scheme);
  return (await db.query<SchemeRow>('UPDATE long_plan_schemes SET scheme=$2::jsonb,revision=revision+1,review=NULL,reviewed_revision=NULL,updated_at=now() WHERE id=$1 RETURNING *',[row.id,JSON.stringify(scheme)])).rows[0];
 });}
 async reviewScheme(owner:string,project:string,version:string,revision:number,note:string){return transaction(this.pool,async db=>{
  await lockProject(db,owner,project,version);
  const row=(await db.query<SchemeRow>('SELECT * FROM long_plan_schemes WHERE project_id=$1 AND requirement_version_id=$2 FOR UPDATE',[project,version])).rows[0];
  if(!row||row.revision!==revision)throw new PlanningError('scheme_revision_changed');
  if(inspectScheme(project,row.source_content,row.scheme).errors.length)throw new PlanningError('scheme_not_ready',422);
  return (await db.query<SchemeRow>('UPDATE long_plan_schemes SET revision=revision+1,reviewed_revision=revision+1,review=$2::jsonb,updated_at=now() WHERE id=$1 RETURNING *',[row.id,JSON.stringify({actor:owner,note,at:new Date().toISOString(),scope:'human_split_review_not_semantic_proof'})])).rows[0];
 });}
 async createJob(owner:string,project:string,version:string,revision:number,key:string,ai:AiConfig,dispatcher:string){return transaction(this.pool,async db=>{
  // One queue admission lock bounds capacity across API processes. Distinct from
  // the worker's session lock; it is never held while waiting on a model.
  await db.query('SELECT pg_advisory_xact_lock(71931,2)');await lockProject(db,owner,project,version);
  const row=(await db.query<SchemeRow>('SELECT * FROM long_plan_schemes WHERE project_id=$1 AND requirement_version_id=$2 FOR UPDATE',[project,version])).rows[0];
  if(!row||row.revision!==revision||row.reviewed_revision!==revision)throw new PlanningError('scheme_review_required');
  const previous=(await db.query<Job>('SELECT * FROM long_plan_jobs WHERE (owner_id=$1 AND request_key=$2) OR (scheme_id=$3 AND scheme_revision=$4)',[owner,key,row.id,revision])).rows[0];
  if(previous){if(previous.scheme_id!==row.id||previous.scheme_revision!==revision)throw new PlanningError('request_key_conflict');return {job:previous,created:false};}
  const count=(await db.query<{total:number;mine:number}>("SELECT count(*)::int AS total,count(*) FILTER(WHERE owner_id=$1)::int AS mine FROM long_plan_jobs WHERE status IN ('queued','running')",[owner])).rows[0];
  if(count.total>=8||count.mine>=2)throw new PlanningError('planning_queue_full',429);
  const audit=inspectScheme(project,row.source_content,row.scheme);if(audit.errors.length)throw new PlanningError('scheme_not_ready',422);
  const job=(await db.query<Job>(`INSERT INTO long_plan_jobs(owner_id,project_id,requirement_version_id,scheme_id,scheme_revision,scheme_snapshot,source_content,source_hash,prompt_version,model_snapshot,request_key,dispatcher_id,status) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10::jsonb,$11,$12,'queued') RETURNING *`,[owner,project,version,row.id,revision,JSON.stringify(row.scheme),row.source_content,row.source_hash,PROMPT_VERSION,JSON.stringify(modelSnapshot(ai)),key,dispatcher])).rows[0];
  for(const s of audit.segments)await db.query("INSERT INTO long_plan_parts(job_id,segment_key,position,start_offset,end_offset,source_hash,status) VALUES($1,$2,$3,$4,$5,$6,'pending')",[job.id,s.key,s.part,s.start,s.end,s.sourceHash]);
  await event(db,job.id,'created',owner,{schemeRevision:revision,plannedSegments:audit.segments.length,acknowledgedExternalCall:true});return {job,created:true};
 });}
 async details(owner:string,project:string,id:string){
  const job=(await this.pool.query<Job>('SELECT * FROM long_plan_jobs WHERE id=$1 AND owner_id=$2 AND project_id=$3',[id,owner,project])).rows[0];if(!job)throw new PlanningError('not_found',404);
  const parts=(await this.pool.query<Part>('SELECT * FROM long_plan_parts WHERE job_id=$1 ORDER BY position',[id])).rows;
  const attempts=(await this.pool.query<Attempt>('SELECT * FROM long_plan_attempts WHERE job_id=$1 ORDER BY started_at,attempt_no',[id])).rows;
  const events=(await this.pool.query('SELECT id,kind,snapshot,created_at FROM long_plan_job_events WHERE job_id=$1 ORDER BY id',[id])).rows;
  const current=(await this.pool.query<{id:string}>("SELECT id FROM requirement_versions WHERE project_id=$1 AND status='confirmed' ORDER BY version DESC LIMIT 1",[project])).rows[0]?.id===job.requirement_version_id;
  const schemeCurrent=(await this.pool.query<{revision:number}>('SELECT revision FROM long_plan_schemes WHERE id=$1',[job.scheme_id])).rows[0]?.revision===job.scheme_revision;
  const sources=attempts.flatMap(a=>a.request_snapshot.sources??[]);const unresolved=parts.flatMap(p=>p.result?.unresolved??[]);
  return {job,parts,attempts,events,current,schemeCurrent,sources,audit:job.merge_draft?inspectMerge(job.scheme_snapshot,job.merge_draft,sources.map(s=>s.id),unresolved):null};
 }
 async mutate(owner:string,project:string,id:string,revision:number,work:(db:PoolClient,job:Job)=>Promise<unknown>,allowOutdated=false){return transaction(this.pool,async db=>{
  const current=await lockProject(db,owner,project);
  const job=(await db.query<Job>('SELECT * FROM long_plan_jobs WHERE id=$1 AND project_id=$2 AND owner_id=$3 FOR UPDATE',[id,project,owner])).rows[0];if(!job)throw new PlanningError('not_found',404);
  if(!allowOutdated&&current?.id!==job.requirement_version_id)throw new PlanningError('requirement_version_outdated');
  if(!allowOutdated&&(await db.query<{revision:number}>('SELECT revision FROM long_plan_schemes WHERE id=$1',[job.scheme_id])).rows[0]?.revision!==job.scheme_revision)throw new PlanningError('scheme_revision_changed');
  if(job.revision!==revision)throw new PlanningError('job_revision_changed');return work(db,job);
 });}
 async assemble(db:PoolClient,job:Job){
  const parts=(await db.query<Part>('SELECT * FROM long_plan_parts WHERE job_id=$1 ORDER BY position',[job.id])).rows;
  if(parts.some(p=>p.status!=='succeeded'||!p.result))throw new PlanningError('parts_not_complete');
  assertCompletedParts(job,parts,(await db.query<Attempt>('SELECT * FROM long_plan_attempts WHERE job_id=$1',[job.id])).rows);
  const merge=buildMerge(parts.map(p=>({segmentKey:p.segment_key,output:p.result!})));
  await db.query("UPDATE long_plan_jobs SET status='awaiting_review',merge_draft=$2::jsonb,merge_review=NULL,revision=revision+1,error_code=NULL,lease_token=NULL,lease_expires_at=NULL,updated_at=now() WHERE id=$1",[job.id,JSON.stringify(merge)]);
  await event(db,job.id,'merge_assembled',null,{draft:merge,scope:'candidate_only_not_semantic_verification'});
 }
 async adopt(owner:string,project:string,id:string,revision:number){return transaction(this.pool,async db=>{
  const current=await lockProject(db,owner,project);
  // Project lock serializes scheme edits, version confirmation and adoption.
  const job=(await db.query<Job>('SELECT * FROM long_plan_jobs WHERE id=$1 AND project_id=$2 AND owner_id=$3 FOR UPDATE',[id,project,owner])).rows[0];if(!job)throw new PlanningError('not_found',404);
  if(current?.id!==job.requirement_version_id)throw new PlanningError('requirement_version_outdated');
  if(job.adopted_run_id)return {runId:job.adopted_run_id,alreadyAdopted:true};
  if(job.revision!==revision)throw new PlanningError('job_revision_changed');
  if((await db.query<{revision:number}>('SELECT revision FROM long_plan_schemes WHERE id=$1',[job.scheme_id])).rows[0]?.revision!==job.scheme_revision)throw new PlanningError('scheme_revision_changed');
  const review=job.merge_review as {revision?:number;draftHash?:string;resolutions?:{key:string;decision:string;note:string}[];reviewedAt?:string;note?:string}|null;
  if(job.status!=='awaiting_review'||!job.merge_draft||review?.revision!==revision||review.draftHash!==hash(JSON.stringify(job.merge_draft)))throw new PlanningError('merge_review_required');
  const parts=(await db.query<Part>('SELECT * FROM long_plan_parts WHERE job_id=$1 ORDER BY position',[id])).rows;
  const attempts=(await db.query<Attempt>('SELECT * FROM long_plan_attempts WHERE job_id=$1',[id])).rows;
  assertCompletedParts(job,parts,attempts);
  const audit=inspectMerge(job.scheme_snapshot,job.merge_draft,attempts.flatMap(a=>a.request_snapshot.sources.map(s=>s.id)),parts.flatMap(p=>p.result?.unresolved??[]));
  if(!parts.length||parts.some(p=>p.status!=='succeeded')||audit.errors.length||audit.warnings.some(w=>!review.resolutions?.some(r=>r.key===w.key&&r.note.trim().length>=8)))throw new PlanningError('merge_review_required');
  const itemList=requirementItems(project,job.requirement_version_id,job.source_content),byCondition=new Map(job.scheme_snapshot.conditions.map(c=>[c.key,c]));
  const tasks=job.merge_draft.tasks.map(t=>({...t,requirementIds:itemList.filter(i=>t.conditionIds.some(k=>{const c=byCondition.get(k)!;return i.start<c.end&&i.end>c.start;})).map(i=>i.key)}));
  const plan={tasks,requirementItems:itemList,longPlanJobId:job.id,review:{warnings:[],scope:'human_reviewed_plan_not_test_execution'}};
  const run=(await db.query<{id:string}>("INSERT INTO agent_runs(project_id,requirement_version_id,model_name,status,plan,finished_at,confirmed_at,human_review) VALUES($1,$2,$3,'confirmed',$4::jsonb,now(),now(),$5::jsonb) RETURNING id",[project,job.requirement_version_id,job.model_snapshot.model,JSON.stringify(plan),JSON.stringify({...review,reviewedBy:owner,warningCount:audit.warnings.length,warningCodes:audit.warnings.map(w=>w.code),policy:'long-plan-adoption-v1',scope:'human_plan_adoption_not_execution_verification',requirementVersionId:job.requirement_version_id})])).rows[0];
  const ids=new Map<string,string>();
  for(const task of tasks){const t=(await db.query<{id:string}>(`INSERT INTO tasks(project_id,requirement_version_id,agent_run_id,plan_key,title,stage,description,deliverable,suggested_requirement_keys) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,[project,job.requirement_version_id,run.id,task.key,task.title,task.stage,task.description,task.deliverable,task.requirementIds])).rows[0];ids.set(task.key,t.id);for(const key of new Set(task.conditionIds))await db.query("INSERT INTO long_plan_task_conditions(task_id,job_id,condition_key,origin) VALUES($1,$2,$3,'suggested')",[t.id,job.id,key]);}
  for(const task of tasks)for(const dep of task.dependsOn)await db.query('INSERT INTO task_dependencies(task_id,depends_on_task_id) VALUES($1,$2)',[ids.get(task.key),ids.get(dep)]);
  await db.query("UPDATE long_plan_jobs SET status='adopted',adopted_run_id=$2,revision=revision+1,updated_at=now() WHERE id=$1",[job.id,run.id]);await event(db,job.id,'adopted',owner,{runId:run.id,review});
  return {runId:run.id,alreadyAdopted:false};
 });}
}
