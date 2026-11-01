import {createHash} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import type {FastifyInstance,FastifyRequest,FastifyReply} from 'fastify';
import {z} from 'zod';
import {authorizeRequest} from '../project-routes.js';
import type {ProjectStore} from '../project-store.js';
import {roles,transaction,audit} from '../teaching/store.js';
import {TeachingError} from '../teaching/domain.js';
import {chunkPages} from './chunk.js';
import {indexDocument,modelId} from './service.js';
import {EmbeddingError,type EmbeddingConfig} from './embeddings.js';
import {indexCompatibility} from './index-compatibility.js';
export const publicLesson=z.object({lessonId:z.string().regex(/^GX-[A-Z]+-\d{2}$/),version:z.string().regex(/^\d+\.\d+\.\d+$/),title:z.string().trim().min(3).max(140),category:z.string().min(2).max(50),text:z.string().min(350).max(30000),sources:z.array(z.object({title:z.string().max(150),url:z.string().url().startsWith('https://'),version:z.string().max(100)}).strict()).max(10)}).strict();
export type PublicLesson=z.infer<typeof publicLesson>;
/** Explicitly scoped publisher used only by authorized admin routes or the user-approved local curriculum importer. */
export async function savePublicLesson(pool:Pool,input:PublicLesson,transactionClient?:PoolClient){
 const b=publicLesson.parse(input),hash=createHash('sha256').update(b.text).digest('hex'),db=transactionClient??await pool.connect();
 const ownTransaction=!transactionClient;
 try{
  if(ownTransaction)await db.query('BEGIN');
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',['public-lesson:'+b.lessonId+':'+b.version]);
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',['public-lesson:'+hash]);
  const existing=(await db.query("SELECT id FROM knowledge_documents WHERE content_hash=$1 AND visibility='platform_public'",[hash])).rows[0];
  if(existing){if(ownTransaction)await db.query('COMMIT');return {id:existing.id as string,hash,reused:true};}
  if((await db.query("SELECT id FROM knowledge_documents WHERE visibility='platform_public' AND source_metadata->>'lessonId'=$1 AND source_metadata->>'version'=$2",[b.lessonId,b.version])).rowCount)throw new TeachingError('public_version_already_exists');
  const chunks=chunkPages([{page:null,text:b.text}]);if(!chunks.length||chunks.length>250)throw new TeachingError('invalid_public_lesson',422);
  const d=(await db.query(`INSERT INTO knowledge_documents(owner_id,name,media_type,status,visibility,content_hash,source_metadata)
   VALUES(NULL,$1,'text/markdown','awaiting_embedding','platform_public',$2,$3) RETURNING id`,[b.title,hash,JSON.stringify({lessonId:b.lessonId,version:b.version,category:b.category,sources:b.sources,origin:'original_teaching_example',scope:'authenticated_platform',license:'项目原创教学示例；仅公开本批经授权资料，不代表学校制度或官方标准'})])).rows[0];
  for(let n=0;n<chunks.length;n++)await db.query('INSERT INTO knowledge_chunks(document_id,position,content) VALUES($1,$2,$3)',[d.id,n,chunks[n].content]);
  await db.query('INSERT INTO public_knowledge_imports(content_hash,document_id,lesson_id,version) VALUES($1,$2,$3,$4)',[hash,d.id,b.lessonId,b.version]);
  if(ownTransaction)await db.query('COMMIT');return {id:d.id as string,hash,reused:false};
 }catch(error){if(ownTransaction)await db.query('ROLLBACK');throw error;}finally{if(ownTransaction)db.release();}
}
export async function registerPublicKnowledgeRoutes(app:FastifyInstance,store?:ProjectStore,pool?:Pool,embedding?:EmbeddingConfig){
 async function access(req:FastifyRequest,reply:FastifyReply){if(!store||!pool){reply.code(503).send({error:'database_not_configured'});return null;}const user=await authorizeRequest(req,store);if(!user){reply.code(401).send({error:'unauthorized'});return null;}return user;}
 app.get('/knowledge/public',async(req,reply)=>{
  if(!await access(req,reply))return;
  const q=z.object({offset:z.coerce.number().int().min(0).max(100000).default(0)}).strict().safeParse(req.query);if(!q.success)return reply.code(400).send({error:'invalid_input'});
  const total=(await pool!.query("SELECT count(*)::int AS n FROM knowledge_documents WHERE visibility='platform_public'")).rows[0].n;
  const rows=(await pool!.query(`SELECT d.id,d.name,d.status,d.source_metadata,d.content_hash,d.created_at,COUNT(c.id)::int AS chunks,
   COUNT(c.embedding)::int AS indexed,COUNT(c.id) FILTER(WHERE c.embedding_model=$1 AND c.embedding IS NOT NULL)::int AS current
   FROM (SELECT * FROM knowledge_documents WHERE visibility='platform_public' ORDER BY source_metadata->>'lessonId',created_at DESC,id LIMIT 51 OFFSET $2) d
   LEFT JOIN knowledge_chunks c ON c.document_id=d.id GROUP BY d.id,d.name,d.status,d.source_metadata,d.content_hash,d.created_at ORDER BY d.source_metadata->>'lessonId',d.created_at DESC,d.id`,[embedding?modelId(embedding):null,q.data.offset])).rows;
  return {documents:rows.slice(0,50).map(r=>({...r,scope:'platform_public',indexCompatibility:indexCompatibility(r.status,!!embedding,r.chunks,r.indexed,r.current)})),total,hasMore:rows.length>50,offset:q.data.offset,readonly:true};
 });
 app.get('/knowledge/public/:id',async(req,reply)=>{
  if(!await access(req,reply))return;const p=z.object({id:z.string().uuid()}).safeParse(req.params);if(!p.success)return reply.code(400).send({error:'invalid_input'});
  const doc=(await pool!.query("SELECT id,name,source_metadata,content_hash FROM knowledge_documents WHERE id=$1 AND visibility='platform_public'",[p.data.id])).rows[0];
  if(!doc)return reply.code(404).send({error:'not_found'});
  return {document:doc,chunks:(await pool!.query('SELECT id,position,content FROM knowledge_chunks WHERE document_id=$1 ORDER BY position',[doc.id])).rows,scope:'platform_public'};
 });
 app.post('/knowledge/public',async(req,reply)=>{
  const user=await access(req,reply);if(!user)return;
  try{return await transaction(pool!,user.id,'admin',async db=>{
   const parsed=publicLesson.safeParse(req.body);if(!parsed.success)throw new TeachingError('invalid_input',400);
   const result=await savePublicLesson(pool!,parsed.data,db);await audit(db,user.id,'public_lesson_added',result.id,{lessonId:parsed.data.lessonId,version:parsed.data.version});return result;
  });}catch(error){if(error instanceof TeachingError)return reply.code(error.status).send({error:error.code});throw error;}
 });
 app.post('/knowledge/public/:id/index',async(req,reply)=>{
  const user=await access(req,reply);if(!user)return;
  try{if(!(await roles(pool!,user.id)).includes('admin'))throw new TeachingError('role_not_authorized',403);
   const p=z.object({id:z.string().uuid()}).safeParse(req.params);if(!p.success)throw new TeachingError('invalid_input',400);
   if(!embedding)throw new TeachingError('embedding_not_configured',503);
   const result=await indexDocument(pool!,null,p.data.id,embedding,{authorizeCommit:async db=>{
    await db.query("SELECT pg_advisory_xact_lock(hashtext('gongxu-teaching-access'))");
    if(!(await roles(db,user.id)).includes('admin'))throw new TeachingError('role_not_authorized',403);
    await audit(db,user.id,'public_lesson_indexed',p.data.id);
   }});if(!result)throw new TeachingError('not_found',404);return result;
  }catch(error){if(error instanceof TeachingError)return reply.code(error.status).send({error:error.code});if(error instanceof EmbeddingError)return reply.code(503).send({error:error.code});throw error;}
 });
}
