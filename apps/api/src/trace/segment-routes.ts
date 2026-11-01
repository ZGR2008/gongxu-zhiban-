import type {FastifyInstance,FastifyRequest,FastifyReply} from 'fastify';
import type {Pool} from 'pg';import {z} from 'zod';
import type {ProjectStore} from '../project-store.js';import {authorizeRequest} from '../project-routes.js';
import {segmentPack} from './segments.js';
const params=z.object({projectId:z.string().uuid(),versionId:z.string().uuid()}).strict();
const input=z.object({segmentKey:z.string().regex(/^SEG-[a-f0-9]{20}$/),sourceHash:z.string().regex(/^[a-f0-9]{64}$/),decision:z.enum(['accepted','needs_changes']),note:z.string().trim().min(3).max(2000),expectedRevision:z.number().int().nonnegative()}).strict();
const fields='segment_key AS "segmentKey",source_hash AS "sourceHash",decision,note,revision,reviewed_at AS "reviewedAt"';
export async function registerSegmentRoutes(app:FastifyInstance,store?:ProjectStore,pool?:Pool){
 async function access(req:FastifyRequest,reply:FastifyReply){
  if(!store||!pool){reply.code(503).send({error:'database_not_configured'});return null;}
  const user=await authorizeRequest(req,store);if(!user){reply.code(401).send({error:'unauthorized'});return null;}
  const p=params.safeParse(req.params);if(!p.success){reply.code(400).send({error:'invalid_input'});return null;}
  if(!await store.getProject(user.id,p.data.projectId)){reply.code(404).send({error:'not_found'});return null;}
  return {...p.data,user};
 }
 app.get('/projects/:projectId/requirements/:versionId/segments',async(req,reply)=>{
  const a=await access(req,reply);if(!a)return;
  const versions=(await store!.listRequirements(a.user.id,a.projectId)??[]).filter(v=>v.status==='confirmed').sort((a,b)=>b.version-a.version);
  const version=versions.find(v=>v.id===a.versionId);if(!version)return reply.code(404).send({error:'not_found'});
  const pack=segmentPack(a.projectId,a.versionId,version.content);
  const reviews=(await pool!.query(`SELECT ${fields} FROM requirement_segment_reviews WHERE project_id=$1 AND requirement_version_id=$2`,[a.projectId,a.versionId])).rows;
  return {...pack,versionNumber:version.version,current:versions[0]?.id===a.versionId,reviews,generationEnabled:false,scope:'完整分段与人工边界审阅；不会调用模型，不会放宽20000字符生成限制。原文不修改，审核不等于语义验证。'};
 });
 app.post('/projects/:projectId/requirements/:versionId/segments/reviews',async(req,reply)=>{
  const a=await access(req,reply);if(!a)return;const parsed=input.safeParse(req.body);if(!parsed.success)return reply.code(400).send({error:'invalid_input'});
  const b=parsed.data,client=await pool!.connect();
  try{
   await client.query('BEGIN');await client.query('SELECT id FROM projects WHERE id=$1 AND owner_id=$2 FOR UPDATE',[a.projectId,a.user.id]);
   const row=(await client.query<{id:string;content:string}>("SELECT id,content FROM requirement_versions WHERE project_id=$1 AND status='confirmed' ORDER BY version DESC LIMIT 1",[a.projectId])).rows[0];
   if(row?.id!==a.versionId){await client.query('ROLLBACK');return reply.code(409).send({error:'trace_version_outdated'});}
   const segment=segmentPack(a.projectId,a.versionId,row.content).segments.find(s=>s.key===b.segmentKey);
   if(!segment||segment.sourceHash!==b.sourceHash){await client.query('ROLLBACK');return reply.code(409).send({error:'segment_source_changed'});}
   const values=[a.projectId,a.versionId,b.segmentKey,b.sourceHash,b.decision,b.note,a.user.id];
   const result=b.expectedRevision===0?await client.query(`INSERT INTO requirement_segment_reviews(project_id,requirement_version_id,segment_key,source_hash,decision,note,reviewed_by) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING ${fields}`,values):await client.query(`UPDATE requirement_segment_reviews SET source_hash=$4,decision=$5,note=$6,reviewed_by=$7,reviewed_at=now(),revision=revision+1 WHERE project_id=$1 AND requirement_version_id=$2 AND segment_key=$3 AND revision=$8 RETURNING ${fields}`,[...values,b.expectedRevision]);
   if(!result.rowCount){await client.query('ROLLBACK');return reply.code(409).send({error:'segment_review_changed'});}
   await client.query('COMMIT');return {review:result.rows[0],generationEnabled:false};
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
 });
}
