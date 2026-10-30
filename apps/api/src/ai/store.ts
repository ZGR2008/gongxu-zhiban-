import type { Pool } from 'pg';
import type { Requirement } from '../project-store.js';

export interface AiGenerationStore {
  createRequirementAnalysis(userId: string, projectId: string, content: string, model: string, inputSummary: string): Promise<Requirement | null>;
  listGenerations(userId: string, projectId: string): Promise<AiGeneration[]>;
}
export type AiGeneration = { id: string; requirementVersionId: string; purpose: string; model: string; inputSummary: string; createdAt: Date };

export class PgAiGenerationStore implements AiGenerationStore {
  constructor(private readonly pool: Pool) {}
  async listGenerations(userId: string, projectId: string): Promise<AiGeneration[]> {
    const result = await this.pool.query(`SELECT id, requirement_version_id AS "requirementVersionId", purpose,
      model_name AS model, input_summary AS "inputSummary", created_at AS "createdAt"
      FROM ai_generations WHERE user_id=$1 AND project_id=$2 ORDER BY created_at DESC`, [userId, projectId]);
    return result.rows;
  }
  async createRequirementAnalysis(userId: string, projectId: string, content: string, model: string, inputSummary: string): Promise<Requirement | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const owned = await client.query('SELECT id FROM projects WHERE id=$1 AND owner_id=$2 FOR UPDATE', [projectId, userId]);
      if (!owned.rowCount) { await client.query('ROLLBACK'); return null; }
      const result = await client.query(`INSERT INTO requirement_versions(project_id,version,content)
        SELECT $1,COALESCE(MAX(version),0)+1,to_jsonb($2::text) FROM requirement_versions WHERE project_id=$1
        RETURNING id,project_id AS "projectId",version,content #>> '{}' AS content,status,created_at AS "createdAt",confirmed_at AS "confirmedAt"`, [projectId, content]);
      const requirement = result.rows[0] as Requirement;
      await client.query(`INSERT INTO ai_generations(user_id,project_id,requirement_version_id,purpose,model_name,input_summary)
        VALUES($1,$2,$3,'requirement_analysis',$4,$5)`, [userId, projectId, requirement.id, model, inputSummary]);
      await client.query('COMMIT');
      return requirement;
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
}
