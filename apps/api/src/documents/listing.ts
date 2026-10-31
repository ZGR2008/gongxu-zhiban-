import type {Pool} from 'pg';
import {z} from 'zod';
import {readEvidenceSnapshot,type EvidenceSnapshot} from './evidence.js';
import type {ProjectDocument} from './store.js';
const headerFields=`d.id,d.project_id AS "projectId",d.requirement_version_id AS "requirementVersionId",d.type,d.model_name AS "modelName",d.revision,d.source_snapshot AS "sourceSnapshot",d.created_at AS "createdAt",d.updated_at AS "updatedAt"`;
export const documentFields=headerFields+',d.content';
export const documentListQuery=z.object({limit:z.coerce.number().int().min(1).max(50).default(20),summaryOnly:z.enum(['true','false']).default('false'),cursor:z.string().min(1).max(700).regex(/^[A-Za-z0-9_-]+$/).optional()}).strict();
const cursorShape=z.object({projectId:z.string().uuid(),catalogRevision:z.number().int().nonnegative(),afterId:z.string().uuid()}).strict();
export type DocumentListQuery=z.infer<typeof documentListQuery>;
export type DocumentPage={documents:Omit<ProjectDocument,'content'>[];evidence:EvidenceSnapshot|null;summaryComplete:boolean;scope:string;page:{total:number;limit:number;hasMore:boolean;nextCursor:string|null}};
export class DocumentListError extends Error{constructor(readonly code:'invalid_input'|'not_found'|'document_list_changed',readonly status:number){super(code);}}

export async function readDocumentPage(pool:Pool,ownerId:string,projectId:string,query:DocumentListQuery):Promise<DocumentPage>{
 let cursor:z.infer<typeof cursorShape>|undefined;
 if(query.cursor){try{cursor=cursorShape.parse(JSON.parse(Buffer.from(query.cursor,'base64url').toString('utf8')));}catch{throw new DocumentListError('invalid_input',400);}if(cursor.projectId!==projectId||query.summaryOnly==='true')throw new DocumentListError('invalid_input',400);}
 const db=await pool.connect();
 try{
  await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  // This counter spans all versions, because the editable library does too.
  const stats=(await db.query(`SELECT
    (SELECT COUNT(*)::int FROM project_documents d WHERE d.project_id=p.id) AS total,
    (SELECT COALESCE(SUM(e.document_revision),0) FROM requirement_evidence_state e WHERE e.project_id=p.id) AS "catalogRevision"
    FROM projects p WHERE p.id=$2 AND p.owner_id=$1`,[ownerId,projectId])).rows[0];
  if(!stats)throw new DocumentListError('not_found',404);
  const revision=Number(stats.catalogRevision);if(!Number.isSafeInteger(revision))throw new Error('Invalid catalogue revision');
  if(cursor&&cursor.catalogRevision!==revision)throw new DocumentListError('document_list_changed',409);
  const evidence=await readEvidenceSnapshot(db,ownerId,projectId);
  let documents:Omit<ProjectDocument,'content'>[]=[],hasMore=false,nextCursor:string|null=null;
  if(query.summaryOnly==='true'){
   // At most six headers; no body text. DISTINCT is over the entire version,
   // so 100 newer READMEs cannot hide an older API specification.
   if(evidence)documents=(await db.query(`SELECT DISTINCT ON(d.type) ${headerFields} FROM project_documents d
    JOIN projects p ON p.id=d.project_id WHERE p.owner_id=$1 AND p.id=$2 AND d.requirement_version_id=$3
    ORDER BY d.type,d.created_at DESC,d.id ASC`,[ownerId,projectId,evidence.requirementVersionId])).rows;
  }else{
   if(cursor){const anchor=await db.query('SELECT id FROM project_documents WHERE project_id=$1 AND id=$2',[projectId,cursor.afterId]);if(!anchor.rows.length)throw new DocumentListError('document_list_changed',409);}
   documents=(await db.query(`SELECT ${documentFields} FROM project_documents d JOIN projects p ON p.id=d.project_id
    WHERE p.owner_id=$1 AND p.id=$2 AND ($3::uuid IS NULL
      OR d.created_at<(SELECT created_at FROM project_documents WHERE project_id=$2 AND id=$3)
      OR (d.created_at=(SELECT created_at FROM project_documents WHERE project_id=$2 AND id=$3) AND d.id>$3))
    ORDER BY d.created_at DESC,d.id ASC LIMIT $4`,[ownerId,projectId,cursor?.afterId??null,query.limit+1])).rows;
   hasMore=documents.length>query.limit;documents=documents.slice(0,query.limit);
   if(hasMore)nextCursor=Buffer.from(JSON.stringify({projectId,catalogRevision:revision,afterId:documents.at(-1)!.id})).toString('base64url');
  }
  await db.query('COMMIT');return{documents,evidence,summaryComplete:query.summaryOnly==='true',scope:query.summaryOnly==='true'?'latest_of_each_type_in_current_confirmed_requirement':'project_document_page',page:{total:stats.total,limit:query.limit,hasMore,nextCursor}};
 }catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
}
