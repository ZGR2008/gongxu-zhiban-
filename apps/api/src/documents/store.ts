import type { Pool } from 'pg';

export const documentTypes = ['readme', 'requirements', 'design', 'api', 'test_report', 'summary'] as const;
export type DocumentType = typeof documentTypes[number];
export type ProjectDocument = { id: string; projectId: string; requirementVersionId: string; type: DocumentType; content: string; modelName: string; createdAt: Date; updatedAt: Date };
export type DocumentContext = { tasks: { title: string; stage: string; status: string }[]; testCases: { title: string; category: string; result: string; executionNote: string; executedAt: Date | null }[]; testCounts: { total: number; notRun: number; passed: number; failed: number; blocked: number } };
export interface DocumentStore {
  getContext(userId: string, projectId: string, requirementId: string): Promise<DocumentContext>;
  list(userId: string, projectId: string): Promise<ProjectDocument[]>;
  get(userId: string, projectId: string, id: string): Promise<ProjectDocument | null>;
  create(userId: string, projectId: string, requirementId: string, type: DocumentType, content: string, model: string): Promise<ProjectDocument | null>;
  update(userId: string, projectId: string, id: string, content: string): Promise<ProjectDocument | null>;
}
const fields = `d.id,d.project_id AS "projectId",d.requirement_version_id AS "requirementVersionId",d.type,d.content,d.model_name AS "modelName",d.created_at AS "createdAt",d.updated_at AS "updatedAt"`;
export class PgDocumentStore implements DocumentStore {
  constructor(private pool: Pool) {}
  async getContext(userId: string, projectId: string, requirementId: string): Promise<DocumentContext> {
    // Include only records tied to the confirmed requirement being documented.
    const [tasks, cases] = await Promise.all([
      this.pool.query(`SELECT t.title,t.stage,t.status FROM tasks t JOIN projects p ON p.id=t.project_id JOIN agent_runs a ON a.id=t.agent_run_id AND a.project_id=p.id WHERE p.owner_id=$1 AND p.id=$2 AND t.requirement_version_id=$3 AND a.status='confirmed' ORDER BY t.created_at,t.id LIMIT 50`, [userId,projectId,requirementId]),
      this.pool.query(`SELECT c.title,c.category,c.result,c.execution_note AS "executionNote",c.executed_at AS "executedAt",COUNT(*) OVER() AS total,COUNT(*) FILTER (WHERE c.result='not_run') OVER() AS "notRun",COUNT(*) FILTER (WHERE c.result='passed') OVER() AS passed,COUNT(*) FILTER (WHERE c.result='failed') OVER() AS failed,COUNT(*) FILTER (WHERE c.result='blocked') OVER() AS blocked FROM practice_test_cases c JOIN projects p ON p.id=c.project_id WHERE p.owner_id=$1 AND p.id=$2 AND c.requirement_version_id=$3 ORDER BY c.created_at,c.id LIMIT 50`, [userId,projectId,requirementId]),
    ]);
    const count = cases.rows[0];
    return { tasks:tasks.rows, testCases:cases.rows.map(({title,category,result,executionNote,executedAt}) => ({title,category,result,executionNote,executedAt})), testCounts:{ total:Number(count?.total ?? 0), notRun:Number(count?.notRun ?? 0), passed:Number(count?.passed ?? 0), failed:Number(count?.failed ?? 0), blocked:Number(count?.blocked ?? 0) } };
  }
  async list(userId: string, projectId: string) {
    const r = await this.pool.query(`SELECT ${fields} FROM project_documents d JOIN projects p ON p.id=d.project_id WHERE p.owner_id=$1 AND p.id=$2 ORDER BY d.created_at DESC LIMIT 100`, [userId,projectId]);
    return r.rows;
  }
  async get(userId: string, projectId: string, id: string) {
    const r = await this.pool.query(`SELECT ${fields} FROM project_documents d JOIN projects p ON p.id=d.project_id WHERE p.owner_id=$1 AND p.id=$2 AND d.id=$3`, [userId,projectId,id]);
    return r.rows[0] ?? null;
  }
  async create(userId: string, projectId: string, requirementId: string, type: DocumentType, content: string, model: string) {
    const r = await this.pool.query(`INSERT INTO project_documents AS d(project_id,requirement_version_id,type,content,model_name) SELECT p.id,r.id,$4,$5,$6 FROM projects p JOIN requirement_versions r ON r.project_id=p.id WHERE p.owner_id=$1 AND p.id=$2 AND r.id=$3 AND r.status='confirmed' RETURNING ${fields}`, [userId,projectId,requirementId,type,content,model]);
    return r.rows[0] ?? null;
  }
  async update(userId: string, projectId: string, id: string, content: string) {
    const r = await this.pool.query(`UPDATE project_documents d SET content=$4,updated_at=now() FROM projects p WHERE d.project_id=p.id AND p.owner_id=$1 AND p.id=$2 AND d.id=$3 RETURNING ${fields}`, [userId,projectId,id,content]);
    return r.rows[0] ?? null;
  }
}
