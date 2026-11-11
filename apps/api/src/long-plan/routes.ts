import type {FastifyInstance,FastifyRequest,FastifyReply} from 'fastify';
import type {Pool} from 'pg';
import {z,ZodError} from 'zod';
import {authorizeRequest} from '../project-routes.js';
import type {ProjectStore} from '../project-store.js';
import type {AiConfig} from '../ai/model.js';
import type {EmbeddingConfig} from '../rag/embeddings.js';
import {schemeSchema,inspectScheme,inspectMerge,parseSegmentOutput,hash} from './domain.js';
import {LongPlanStore,PlanningError,event,transaction,lockProject,modelSnapshot,modelFingerprint,assertCompletedParts,type Job,type Part,type Attempt} from './store.js';
import {LongPlanWorker,type WorkerDeps} from './worker.js';
const uuid=z.string().uuid(),rev=z.number().int().positive(),note=z.string().trim().min(8).max(3000);
const scope=z.object({projectId:uuid,versionId:uuid.optional(),jobId:uuid.optional()}).strict();
const revision=z.object({expectedRevision:rev}).strict();
const resolutions=z.array(z.object({key:z.string().regex(/^CHK-[a-f0-9]{20}$/),decision:z.enum(['resolved','accepted_limitation']),note}).strict()).max(1000);
export async function registerLongPlanRoutes(app:FastifyInstance,projectStore?:ProjectStore,pool?:Pool,ai?:AiConfig,embedding?:EmbeddingConfig,deps:WorkerDeps={}){
 const store=pool?new LongPlanStore(pool):undefined,worker=store?new LongPlanWorker(store,ai,embedding,deps):undefined;
 // Recovery is lazy: unauthenticated startup/health reads need no migration or DB writes.
 async function recover(){await worker?.recover();}
 app.addHook('preClose',async()=>{await worker?.close();});
 function endpoint(work:(a:{owner:string;project:string;version?:string;job?:string},req:FastifyRequest,reply:FastifyReply)=>Promise<unknown>){return async(req:FastifyRequest,reply:FastifyReply)=>{
  if(!projectStore||!store||!pool)return reply.code(503).send({error:'database_not_configured'});
  const user=await authorizeRequest(req,projectStore);if(!user)return reply.code(401).send({error:'unauthorized'});
  const p=scope.safeParse(req.params);if(!p.success)return reply.code(400).send({error:'invalid_input'});
  if(!await projectStore.getProject(user.id,p.data.projectId))return reply.code(404).send({error:'not_found'});
  try{await recover();return await work({owner:user.id,project:p.data.projectId,version:p.data.versionId,job:p.data.jobId},req,reply);}
  catch(error){if(error instanceof PlanningError)return reply.code(error.status).send({error:error.code});if(error instanceof ZodError||error instanceof SyntaxError)return reply.code(400).send({error:'invalid_input'});throw error;}
 };}
 const scheme='/projects/:projectId/requirements/:versionId/planning-scheme',jobs='/projects/:projectId/long-plans',job=jobs+'/:jobId';
 app.get(scheme,endpoint(async a=>store!.scheme(a.owner,a.project,a.version!)));
 app.put(scheme,endpoint(async(a,req)=>{const b=z.object({expectedRevision:rev,scheme:schemeSchema}).strict().parse(req.body);await store!.saveScheme(a.owner,a.project,a.version!,b.expectedRevision,b.scheme);return store!.scheme(a.owner,a.project,a.version!);}));
 app.post(scheme+'/review',endpoint(async(a,req)=>{const b=z.object({expectedRevision:rev,note,acknowledged:z.literal(true)}).strict().parse(req.body);await store!.reviewScheme(a.owner,a.project,a.version!,b.expectedRevision,b.note);return store!.scheme(a.owner,a.project,a.version!);}));
 app.get(jobs,endpoint(async a=>({jobs:(await pool!.query('SELECT id,requirement_version_id,scheme_revision,status,revision,error_code,created_at FROM long_plan_jobs WHERE owner_id=$1 AND project_id=$2 ORDER BY created_at DESC LIMIT 100',[a.owner,a.project])).rows,limit:100,modelConfigured:!!ai,model:ai?.model??null})));
 app.post(jobs,endpoint(async(a,req,reply)=>{
  const b=z.object({versionId:uuid,schemeRevision:rev,requestKey:uuid,acknowledgeExternalCall:z.literal(true)}).strict().parse(req.body);
  if(!ai)throw new PlanningError('ai_not_configured',503);
  const result=await store!.createJob(a.owner,a.project,b.versionId,b.schemeRevision,b.requestKey,ai,worker!.dispatcher);if(result.created)worker!.kick();
  return reply.code(result.created?202:200).send(result);
 }));
 app.get(job,endpoint(async a=>store!.details(a.owner,a.project,a.job!)));
 app.post(job+'/cancel',endpoint(async(a,req)=>{
  const b=revision.parse(req.body);
  await store!.mutate(a.owner,a.project,a.job!,b.expectedRevision,async(db,j)=>{
   if(['adopted','awaiting_review','cancelled'].includes(j.status))throw new PlanningError('job_not_cancellable');
   await db.query("UPDATE long_plan_jobs SET status='cancelled',revision=revision+1,lease_token=NULL,lease_expires_at=NULL,error_code='user_cancelled',updated_at=now() WHERE id=$1",[j.id]);
   await db.query("UPDATE long_plan_parts SET status=CASE WHEN EXISTS(SELECT 1 FROM long_plan_attempts a WHERE a.job_id=$1 AND a.segment_key=long_plan_parts.segment_key AND a.status='dispatching') THEN 'uncertain' ELSE 'pending' END,error_code='user_cancelled' WHERE job_id=$1 AND status='running'",[j.id]);
   await db.query("UPDATE long_plan_attempts SET status='uncertain',error_code='user_cancelled',finished_at=now() WHERE job_id=$1 AND status='dispatching'",[j.id]);await event(db,j.id,'cancelled',a.owner,{possibleProviderCharge:true});
  },true);worker!.cancel(a.job!);return store!.details(a.owner,a.project,a.job!);
 }));
 app.post(job+'/resume',endpoint(async(a,req)=>{
  const b=z.object({expectedRevision:rev,acknowledgeExternalCall:z.literal(true)}).strict().parse(req.body);if(!ai)throw new PlanningError('ai_not_configured',503);
  await transaction(pool!,async db=>{
   await db.query('SELECT pg_advisory_xact_lock(71931,2)');await lockProject(db,a.owner,a.project);
   const j=(await db.query<Job>('SELECT * FROM long_plan_jobs WHERE id=$1 AND owner_id=$2 AND project_id=$3 FOR UPDATE',[a.job,a.owner,a.project])).rows[0];if(!j)throw new PlanningError('not_found',404);
   await lockProject(db,a.owner,a.project,j.requirement_version_id);
   if(j.revision!==b.expectedRevision)throw new PlanningError('job_revision_changed');
   if(!['paused','cancelled','needs_attention'].includes(j.status))throw new PlanningError('job_not_resumable');
   if((await db.query('SELECT revision FROM long_plan_schemes WHERE id=$1',[j.scheme_id])).rows[0].revision!==j.scheme_revision)throw new PlanningError('scheme_revision_changed');
   if(modelFingerprint(j.model_snapshot)!==modelFingerprint(modelSnapshot(ai)))throw new PlanningError('model_configuration_changed');
   const parts=(await db.query<Part>('SELECT * FROM long_plan_parts WHERE job_id=$1',[j.id])).rows;if(parts.some(p=>!['pending','succeeded'].includes(p.status)))throw new PlanningError('part_requires_review');
   assertCompletedParts(j,parts,(await db.query<Attempt>('SELECT * FROM long_plan_attempts WHERE job_id=$1',[j.id])).rows);
   if(parts.every(p=>p.status==='succeeded')){await store!.assemble(db,j);return;}
   const counts=(await db.query("SELECT count(*)::int AS total,count(*) FILTER(WHERE owner_id=$1)::int AS mine FROM long_plan_jobs WHERE status IN ('queued','running')",[a.owner])).rows[0];if(counts.total>=8||counts.mine>=2)throw new PlanningError('planning_queue_full',429);
   await db.query("UPDATE long_plan_jobs SET status='queued',dispatcher_id=$2,revision=revision+1,error_code=NULL,updated_at=now() WHERE id=$1",[j.id,worker!.dispatcher]);await event(db,j.id,'explicit_resume',a.owner,{acknowledgedExternalCall:true});
  });worker!.kick();return store!.details(a.owner,a.project,a.job!);
 }));
 app.post(job+'/retry-part',endpoint(async(a,req)=>{
  const b=z.object({expectedRevision:rev,segmentKey:z.string().max(100),acknowledgePossibleDuplicateCharge:z.literal(true),note}).strict().parse(req.body);
  await store!.mutate(a.owner,a.project,a.job!,b.expectedRevision,async(db,j)=>{
   if(!['paused','cancelled','needs_attention'].includes(j.status))throw new PlanningError('job_not_editable');
   const p=(await db.query<Part>('SELECT * FROM long_plan_parts WHERE job_id=$1 AND segment_key=$2',[j.id,b.segmentKey])).rows[0];if(!p||!['uncertain','needs_attention'].includes(p.status))throw new PlanningError('part_not_retryable');
   if(p.attempts>=3)throw new PlanningError('part_attempt_limit');
   const last=(await db.query<{cooldown:boolean}>("SELECT now()<started_at+(power(2,attempt_no)*interval '1 second') AS cooldown FROM long_plan_attempts WHERE job_id=$1 AND segment_key=$2 ORDER BY attempt_no DESC LIMIT 1",[j.id,b.segmentKey])).rows[0];if(last?.cooldown)throw new PlanningError('retry_cooldown',429);
   await db.query("UPDATE long_plan_parts SET status='pending',error_code=NULL WHERE job_id=$1 AND segment_key=$2",[j.id,b.segmentKey]);
   await db.query("UPDATE long_plan_jobs SET status='paused',merge_review=NULL,revision=revision+1,error_code=NULL,updated_at=now() WHERE id=$1",[j.id]);await event(db,j.id,'manual_retry_prepared',a.owner,{segmentKey:b.segmentKey,note:b.note,possibleDuplicateCharge:true});
  });return store!.details(a.owner,a.project,a.job!);
 }));
 app.post(job+'/correct-part',endpoint(async(a,req)=>{
  const b=z.object({expectedRevision:rev,segmentKey:z.string().max(100),output:z.string().max(45000),note}).strict().parse(req.body);
  await store!.mutate(a.owner,a.project,a.job!,b.expectedRevision,async(db,j)=>{
   if(['running','queued','adopted'].includes(j.status))throw new PlanningError('job_not_editable');
   const segment=inspectScheme(j.project_id,j.source_content,j.scheme_snapshot).segments.find(s=>s.key===b.segmentKey);if(!segment)throw new PlanningError('not_found',404);
   const attempts=(await db.query<Attempt>('SELECT * FROM long_plan_attempts WHERE job_id=$1 AND segment_key=$2',[j.id,b.segmentKey])).rows;
   let output;try{output=parseSegmentOutput(b.output,segment,j.scheme_snapshot,attempts.flatMap(r=>r.request_snapshot.sources.map(s=>s.id)));}catch{throw new PlanningError('invalid_segment_output',422);}
   const prior=(await db.query<Part>('SELECT * FROM long_plan_parts WHERE job_id=$1 AND segment_key=$2',[j.id,b.segmentKey])).rows[0];
   await db.query("UPDATE long_plan_parts SET status='succeeded',result=$3::jsonb,result_origin='human_correction',error_code=NULL WHERE job_id=$1 AND segment_key=$2",[j.id,b.segmentKey,JSON.stringify(output)]);
   await event(db,j.id,'human_corrected_part',a.owner,{segmentKey:b.segmentKey,previousResult:prior.result,result:output,note:b.note});
   const incomplete=(await db.query("SELECT 1 FROM long_plan_parts WHERE job_id=$1 AND status<>'succeeded'",[j.id])).rowCount;
   let remainingInvalid=false;
   if(!incomplete){
    try{await store!.assemble(db,j);}catch(error){
     // A valid human correction must survive another legacy part's failure.
     // Do not roll it back, change the remaining answer, or dispatch a request.
     if(!(error instanceof PlanningError)||error.code!=='part_result_invalid')throw error;
     remainingInvalid=true;await event(db,j.id,'merge_blocked_by_prior_part',a.owner,{correctedSegment:b.segmentKey,reason:'part_result_invalid'});
    }
   }
   if(incomplete||remainingInvalid)await db.query("UPDATE long_plan_jobs SET status='paused',merge_draft=NULL,merge_review=NULL,error_code=$2,revision=revision+1,updated_at=now() WHERE id=$1",[j.id,remainingInvalid?'part_result_invalid':null]);
  });return store!.details(a.owner,a.project,a.job!);
 }));
 app.put(job+'/merge',endpoint(async(a,req)=>{
  const b=z.object({expectedRevision:rev,draft:z.object({tasks:z.array(z.unknown()).max(160)}).strict(),note}).strict().parse(req.body);
  if(JSON.stringify(b.draft).length>300000)throw new PlanningError('merge_too_large',413);
  await store!.mutate(a.owner,a.project,a.job!,b.expectedRevision,async(db,j)=>{
   if(j.status!=='awaiting_review')throw new PlanningError('job_not_editable');
   await event(db,j.id,'merge_edited',a.owner,{previousDraft:j.merge_draft,draft:b.draft,note:b.note});
   await db.query('UPDATE long_plan_jobs SET merge_draft=$2::jsonb,merge_review=NULL,revision=revision+1,updated_at=now() WHERE id=$1',[j.id,JSON.stringify(b.draft)]);
  });return store!.details(a.owner,a.project,a.job!);
 }));
 app.post(job+'/review',endpoint(async(a,req)=>{
  const b=z.object({expectedRevision:rev,note,resolutions,acknowledged:z.literal(true)}).strict().parse(req.body);
  await store!.mutate(a.owner,a.project,a.job!,b.expectedRevision,async(db,j)=>{
   if(j.status!=='awaiting_review'||!j.merge_draft)throw new PlanningError('job_not_reviewable');
   const parts=(await db.query<Part>('SELECT * FROM long_plan_parts WHERE job_id=$1',[j.id])).rows,attempts=(await db.query<Attempt>('SELECT * FROM long_plan_attempts WHERE job_id=$1',[j.id])).rows;
   const audit=inspectMerge(j.scheme_snapshot,j.merge_draft,attempts.flatMap(t=>t.request_snapshot.sources.map(s=>s.id)),parts.flatMap(p=>p.result?.unresolved??[]));
   if(audit.errors.length||parts.some(p=>p.status!=='succeeded'))throw new PlanningError('merge_not_ready',422);
   if(new Set(b.resolutions.map(r=>r.key)).size!==b.resolutions.length||b.resolutions.length!==audit.warnings.length||audit.warnings.some(w=>!b.resolutions.some(r=>r.key===w.key)))throw new PlanningError('review_items_incomplete',422);
   const review={revision:j.revision+1,draftHash:hash(JSON.stringify(j.merge_draft)),resolutions:b.resolutions,note:b.note,reviewedAt:new Date().toISOString(),reviewedBy:a.owner,semanticCompleteness:'human_reviewed_not_proven'};
   await db.query('UPDATE long_plan_jobs SET merge_review=$2::jsonb,revision=revision+1,updated_at=now() WHERE id=$1',[j.id,JSON.stringify(review)]);await event(db,j.id,'merge_reviewed',a.owner,review);
  });return store!.details(a.owner,a.project,a.job!);
 }));
 app.post(job+'/adopt',endpoint(async(a,req)=>{const b=z.object({expectedRevision:rev,acknowledged:z.literal(true)}).strict().parse(req.body);return store!.adopt(a.owner,a.project,a.job!,b.expectedRevision);}));
 return worker;
}
