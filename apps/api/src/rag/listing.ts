import type {Pool} from 'pg';
import {z} from 'zod';
import {indexCompatibility} from './index-compatibility.js';
export const knowledgeListQuery=z.object({limit:z.coerce.number().int().min(1).max(50).default(20),cursor:z.string().min(1).max(700).regex(/^[A-Za-z0-9_-]+$/).optional()}).strict();
const cursorShape=z.object({ownerId:z.string().uuid(),total:z.number().int().nonnegative(),afterId:z.string().uuid()}).strict();
export class KnowledgeListError extends Error{constructor(readonly code:'invalid_input'|'not_found'|'knowledge_list_changed',readonly status:number){super(code);}}
export async function readKnowledgePage(pool:Pool,ownerId:string,model:string|null,query:z.infer<typeof knowledgeListQuery>){
 let cursor:z.infer<typeof cursorShape>|undefined;
 if(query.cursor){try{cursor=cursorShape.parse(JSON.parse(Buffer.from(query.cursor,'base64url').toString('utf8')));}catch{throw new KnowledgeListError('invalid_input',400);}if(cursor.ownerId!==ownerId)throw new KnowledgeListError('not_found',404);}
 const db=await pool.connect();
 try{
  await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const total=(await db.query('SELECT COUNT(*)::int AS total FROM knowledge_documents WHERE owner_id=$1',[ownerId])).rows[0].total;
  // The application only adds documents; indexing does not change membership
  // or created_at. This detects intervening uploads without invalidating a page
  // when an owned document is explicitly reindexed. No deletion API is offered.
  if(cursor&&cursor.total!==total)throw new KnowledgeListError('knowledge_list_changed',409);
  if(cursor){const anchor=await db.query('SELECT id FROM knowledge_documents WHERE owner_id=$1 AND id=$2',[ownerId,cursor.afterId]);if(!anchor.rows.length)throw new KnowledgeListError('knowledge_list_changed',409);}
  const result=await db.query(`WITH visible AS (
   SELECT id,name,media_type,status,created_at FROM knowledge_documents WHERE owner_id=$1 AND ($3::uuid IS NULL
    OR created_at<(SELECT created_at FROM knowledge_documents WHERE owner_id=$1 AND id=$3)
    OR (created_at=(SELECT created_at FROM knowledge_documents WHERE owner_id=$1 AND id=$3) AND id>$3))
   ORDER BY created_at DESC,id LIMIT $4)
   SELECT d.id,d.name,d.media_type AS "mediaType",d.status,d.created_at AS "createdAt",
    COUNT(c.id)::int AS "chunkCount",COUNT(c.embedding)::int AS "indexedChunks",
    COUNT(c.id) FILTER(WHERE c.embedding IS NOT NULL AND c.embedding_model=$2)::int AS "currentChunks"
   FROM visible d LEFT JOIN knowledge_chunks c ON c.document_id=d.id
   GROUP BY d.id,d.name,d.media_type,d.status,d.created_at ORDER BY d.created_at DESC,d.id`,[ownerId,model,cursor?.afterId??null,query.limit+1]);
  const hasMore=result.rows.length>query.limit,documents=result.rows.slice(0,query.limit).map(row=>({...row,indexCompatibility:indexCompatibility(row.status,Boolean(model),row.chunkCount,row.indexedChunks,row.currentChunks)}));
  const nextCursor=hasMore?Buffer.from(JSON.stringify({ownerId,total,afterId:documents.at(-1)!.id})).toString('base64url'):null;
  await db.query('COMMIT');return{documents,totalDocuments:total,listLimited:total>documents.length,scope:'owned_document_page',page:{total,limit:query.limit,hasMore,nextCursor}};
 }catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
}
