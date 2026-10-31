import type { Pool } from 'pg';
import { readEvidenceSnapshot, type EvidenceSnapshot } from './evidence.js';
import {documentFields,readDocumentPage,type DocumentListQuery,type DocumentPage} from './listing.js';

export const documentTypes = ['readme', 'requirements', 'design', 'api', 'test_report', 'summary'] as const;
export type DocumentType = typeof documentTypes[number];
export type ProjectDocument = { id: string; projectId: string; requirementVersionId: string; type: DocumentType; content: string; modelName: string; revision: number; sourceSnapshot?:EvidenceSnapshot|null; createdAt: Date; updatedAt: Date };
export type DocumentRevision = { revision: number; content: string; savedAt: Date; recordedAt: Date };
export class DocumentConflictError extends Error {
  constructor(public currentRevision: number) { super('document_conflict'); }
}
export type DocumentContext = { snapshot?:EvidenceSnapshot|null; taskCount?:number;
  tasks: { id?:string; title:string; stage:string; status:string; description?:string; deliverable?:string }[];
  testCases: { id?:string; revision?:number; title:string; category:string; preconditions?:string; steps?:string; expected?:string; result:string; executionNote:string; executedAt:Date|null }[];
  testCounts: { total:number; notRun:number; passed:number; failed:number; blocked:number } };
export interface DocumentStore {
  getContext(userId: string, projectId: string, requirementId: string): Promise<DocumentContext>;
  list(userId: string, projectId: string): Promise<ProjectDocument[]>;
  page(userId:string,projectId:string,query:DocumentListQuery):Promise<DocumentPage>;
  get(userId: string, projectId: string, id: string): Promise<ProjectDocument | null>;
  create(userId: string, projectId: string, requirementId: string, type: DocumentType, content: string, model: string, snapshot?:EvidenceSnapshot|null): Promise<ProjectDocument | null>;
  update(userId: string, projectId: string, id: string, content: string, expectedRevision: number): Promise<ProjectDocument | null>;
  history(userId: string, projectId: string, id: string, beforeRevision?: number): Promise<DocumentRevision[]>;
  evidence(userId:string,projectId:string):Promise<EvidenceSnapshot|null>;
}
const fields = documentFields;
export class PgDocumentStore implements DocumentStore {
  constructor(private pool: Pool) {}
  async getContext(userId: string, projectId: string, requirementId: string): Promise<DocumentContext> {
    // Include only records tied to the confirmed requirement being documented.
    const client=await this.pool.connect();
    try {
      // Context and source counters share one database snapshot. The transaction
      // ends before the model call, so generation never holds database locks.
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const tasks=await client.query(`SELECT t.id,t.title,t.stage,t.status,t.description,t.deliverable,COUNT(*) OVER() AS total FROM tasks t JOIN projects p ON p.id=t.project_id JOIN agent_runs a ON a.id=t.agent_run_id AND a.project_id=p.id WHERE p.owner_id=$1 AND p.id=$2 AND t.requirement_version_id=$3 AND a.status='confirmed' ORDER BY t.created_at,t.id LIMIT 50`, [userId,projectId,requirementId]);
      const cases=await client.query(`SELECT c.id,c.revision,c.title,c.category,c.preconditions,c.steps,c.expected,c.result,c.execution_note AS "executionNote",c.executed_at AS "executedAt",COUNT(*) OVER() AS total,COUNT(*) FILTER (WHERE c.result='not_run') OVER() AS "notRun",COUNT(*) FILTER (WHERE c.result='passed') OVER() AS passed,COUNT(*) FILTER (WHERE c.result='failed') OVER() AS failed,COUNT(*) FILTER (WHERE c.result='blocked') OVER() AS blocked FROM practice_test_cases c JOIN projects p ON p.id=c.project_id WHERE p.owner_id=$1 AND p.id=$2 AND c.requirement_version_id=$3 ORDER BY c.created_at,c.id LIMIT 50`, [userId,projectId,requirementId]);
      const snapshot=await readEvidenceSnapshot(client,userId,projectId,requirementId);
      await client.query('COMMIT');
      const count=cases.rows[0];
      return {snapshot,taskCount:Number(tasks.rows[0]?.total??tasks.rows.length),tasks:tasks.rows.map(({id,title,stage,status,description,deliverable})=>({id,title,stage,status,description,deliverable})),testCases:cases.rows.map(({id,revision,title,category,preconditions,steps,expected,result,executionNote,executedAt})=>({id,revision,title,category,preconditions,steps,expected,result,executionNote,executedAt})),testCounts:{total:Number(count?.total??0),notRun:Number(count?.notRun??0),passed:Number(count?.passed??0),failed:Number(count?.failed??0),blocked:Number(count?.blocked??0)}};
    } catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
  evidence(userId:string,projectId:string){return readEvidenceSnapshot(this.pool,userId,projectId);}
  page(userId:string,projectId:string,query:DocumentListQuery){return readDocumentPage(this.pool,userId,projectId,query);}
  async list(userId: string, projectId: string) {
    const r = await this.pool.query(`SELECT ${fields} FROM project_documents d JOIN projects p ON p.id=d.project_id WHERE p.owner_id=$1 AND p.id=$2 ORDER BY d.created_at DESC LIMIT 100`, [userId,projectId]);
    return r.rows;
  }
  async get(userId: string, projectId: string, id: string) {
    const r = await this.pool.query(`SELECT ${fields} FROM project_documents d JOIN projects p ON p.id=d.project_id WHERE p.owner_id=$1 AND p.id=$2 AND d.id=$3`, [userId,projectId,id]);
    return r.rows[0] ?? null;
  }
  async create(userId: string, projectId: string, requirementId: string, type: DocumentType, content: string, model: string, snapshot?:EvidenceSnapshot|null) {
    const r = await this.pool.query(`INSERT INTO project_documents AS d(project_id,requirement_version_id,type,content,model_name,source_snapshot) SELECT p.id,r.id,$4,$5,$6,$7::jsonb FROM projects p JOIN requirement_versions r ON r.project_id=p.id WHERE p.owner_id=$1 AND p.id=$2 AND r.id=$3 AND r.status='confirmed' RETURNING ${fields}`, [userId,projectId,requirementId,type,content,model,snapshot?JSON.stringify(snapshot):null]);
    return r.rows[0] ?? null;
  }
  async update(userId: string, projectId: string, id: string, content: string, expectedRevision: number) {
    // The comparison and write are one statement; concurrent writers cannot both win.
    const r = await this.pool.query(`UPDATE project_documents d SET content=$4 FROM projects p WHERE d.project_id=p.id AND p.owner_id=$1 AND p.id=$2 AND d.id=$3 AND d.revision=$5 RETURNING ${fields}`, [userId,projectId,id,content,expectedRevision]);
    if (r.rows[0]) return r.rows[0];
    const current = await this.get(userId,projectId,id);
    if (current) throw new DocumentConflictError(current.revision);
    return null;
  }
  async history(userId: string, projectId: string, id: string, beforeRevision?: number) {
    const r = await this.pool.query(`SELECT h.revision,h.content,h.saved_at AS "savedAt",h.recorded_at AS "recordedAt" FROM project_document_history h JOIN project_documents d ON d.id=h.document_id JOIN projects p ON p.id=d.project_id WHERE p.owner_id=$1 AND p.id=$2 AND d.id=$3 AND ($4::integer IS NULL OR h.revision<$4) ORDER BY h.revision DESC LIMIT 21`,[userId,projectId,id,beforeRevision??null]);
    return r.rows;
  }
}
