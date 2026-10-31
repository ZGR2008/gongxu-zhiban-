import type {Pool} from 'pg';
import {z} from 'zod';
import {readEvidenceSnapshot} from '../documents/evidence.js';

export const caseFields=`id,project_id AS "projectId",requirement_version_id AS "requirementVersionId",revision,category,title,preconditions,steps,expected,model_name AS "modelName",result,execution_note AS "executionNote",executor_id AS "executorId",executed_at AS "executedAt",created_at AS "createdAt"`;
export const caseListQuery=z.object({
 requirementVersionId:z.string().uuid().optional(),
 limit:z.coerce.number().int().min(1).max(200).default(50),
 summaryOnly:z.enum(['true','false']).default('false'),
 cursor:z.string().min(1).max(700).regex(/^[A-Za-z0-9_-]+$/).optional(),
}).strict();
const cursorSchema=z.object({projectId:z.string().uuid(),requirementVersionId:z.string().uuid(),caseRevision:z.number().int().nonnegative(),afterId:z.string().uuid()}).strict();
export class CaseListError extends Error {
 constructor(readonly code:'invalid_input'|'not_found'|'test_list_changed',readonly status:number){super(code);}
}
/** A cursor is a read position, never authority. Ownership is checked before this
 * function; every query is also scoped to the resolved project and version.
 * Use the anchor's database timestamp to retain PostgreSQL microsecond precision. */
export async function listTestCases(pool:Pool,ownerId:string,projectId:string,query:z.infer<typeof caseListQuery>){
 let cursor:z.infer<typeof cursorSchema>|undefined;
 if(query.cursor){
  try{cursor=cursorSchema.parse(JSON.parse(Buffer.from(query.cursor,'base64url').toString('utf8')));}catch{throw new CaseListError('invalid_input',400);}
  if(cursor.projectId!==projectId||query.summaryOnly==='true')throw new CaseListError('invalid_input',400);
 }
 const db=await pool.connect();
 try{
  await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const source=await readEvidenceSnapshot(db,ownerId,projectId,query.requirementVersionId);
  if(!source&&query.requirementVersionId)throw new CaseListError('not_found',404);
  if(cursor&&(!source||cursor.requirementVersionId!==source.requirementVersionId||cursor.caseRevision!==source.caseRevision))throw new CaseListError('test_list_changed',409);
  const counts=source?(await db.query(`SELECT COUNT(*)::int AS total,
    COUNT(*) FILTER (WHERE result='passed')::int AS passed,COUNT(*) FILTER (WHERE result='failed')::int AS failed,
    COUNT(*) FILTER (WHERE result='blocked')::int AS blocked,COUNT(*) FILTER (WHERE result='not_run')::int AS "notRun"
    FROM practice_test_cases WHERE project_id=$1 AND requirement_version_id=$2`,[projectId,source.requirementVersionId])).rows[0]
   :{total:0,passed:0,failed:0,blocked:0,notRun:0};
  const summary={requirementVersionId:source?.requirementVersionId??null,requirementVersion:source?.requirementVersion??null,caseRevision:source?.caseRevision??0,capturedAt:source?.capturedAt??new Date().toISOString(),total:counts.total,passed:counts.passed,failed:counts.failed,blocked:counts.blocked,notRun:counts.notRun};
  let cases:Record<string,unknown>[]=[];
  if(source&&query.summaryOnly!=='true'){
   if(cursor){
    const anchor=await db.query('SELECT id FROM practice_test_cases WHERE project_id=$1 AND requirement_version_id=$2 AND id=$3',[projectId,source.requirementVersionId,cursor.afterId]);
    if(!anchor.rows.length)throw new CaseListError('test_list_changed',409);
   }
   cases=(await db.query(`SELECT ${caseFields} FROM practice_test_cases
    WHERE project_id=$1 AND requirement_version_id=$2 AND ($3::uuid IS NULL
      OR created_at<(SELECT created_at FROM practice_test_cases WHERE project_id=$1 AND requirement_version_id=$2 AND id=$3)
      OR (created_at=(SELECT created_at FROM practice_test_cases WHERE project_id=$1 AND requirement_version_id=$2 AND id=$3) AND id>$3))
    ORDER BY created_at DESC,id ASC LIMIT $4`,[projectId,source.requirementVersionId,cursor?.afterId??null,query.limit+1])).rows;
  }
  const hasMore=cases.length>query.limit;cases=cases.slice(0,query.limit);
  const nextCursor=hasMore?Buffer.from(JSON.stringify({projectId,requirementVersionId:source!.requirementVersionId,caseRevision:source!.caseRevision,afterId:cases.at(-1)!.id})).toString('base64url'):null;
  await db.query('COMMIT');return {cases,summary,page:{limit:query.limit,hasMore,nextCursor}};
 }catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
}
