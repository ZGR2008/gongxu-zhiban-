import type { Pool, PoolClient } from 'pg';

export type EvidenceSnapshot = { requirementVersionId: string; requirementVersion: number; taskRevision: number; caseRevision: number; traceRevision: number; documentRevision: number; capturedAt: string };
/** One statement gives a coherent change-counter snapshot. Missing counters mean
 * no downstream writes since migration, not that requirements have been validated. */
export async function readEvidenceSnapshot(db: Pool | PoolClient, owner: string, project: string, requirement?: string): Promise<EvidenceSnapshot | null> {
  const result=await db.query(`SELECT r.id AS "requirementVersionId",r.version AS "requirementVersion",
    COALESCE(e.task_revision,0) AS "taskRevision",COALESCE(e.case_revision,0) AS "caseRevision",
    COALESCE(e.trace_revision,0) AS "traceRevision",COALESCE(e.document_revision,0) AS "documentRevision",
    statement_timestamp() AS "capturedAt"
    FROM requirement_versions r JOIN projects p ON p.id=r.project_id
    LEFT JOIN requirement_evidence_state e ON e.requirement_version_id=r.id AND e.project_id=p.id
    WHERE p.owner_id=$1 AND p.id=$2 AND r.status='confirmed' AND ($3::uuid IS NULL OR r.id=$3)
    ORDER BY r.version DESC LIMIT 1`,[owner,project,requirement??null]);
  return result.rows[0]??null;
}
