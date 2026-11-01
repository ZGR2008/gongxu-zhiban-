export interface SearchDb { query: (sql: string, values: unknown[]) => Promise<{ rows: KnowledgeHit[] }> }
export interface KnowledgeHit { id: string; document_id: string; document_name: string; page: number | null; content: string; distance: number; scope?:'personal'|'platform_public' }

/** Compare vectors only within the same owner, model and dimensionality. */
export async function searchKnowledge(db: SearchDb, ownerId: string, model: string, vector: number[], limit = 5, maxDistance = 0.5): Promise<KnowledgeHit[]> {
  if (!ownerId || !model || !Array.isArray(vector) || vector.length < 1 || vector.length > 4096 ||
    vector.some((n) => !Number.isFinite(n)) || !vector.some((n) => n !== 0) ||
    !Number.isInteger(limit) || limit < 1 || limit > 20 || !Number.isFinite(maxDistance) || maxDistance < 0 || maxDistance > 2) {
    throw new Error('Invalid knowledge search parameters');
  }
  const result = await db.query(`SELECT c.id, d.id AS document_id, CASE WHEN d.visibility='platform_public' THEN '【平台公共教学示例】'||d.name ELSE d.name END AS document_name, d.visibility AS scope, c.page, c.content,
      (c.embedding <=> $4::vector)::float8 AS distance
    FROM knowledge_chunks c JOIN knowledge_documents d ON d.id = c.document_id
    WHERE (d.owner_id = $1 OR d.visibility='platform_public') AND d.status = 'ready' AND c.embedding_model = $2
      AND vector_dims(c.embedding) = $3 AND (c.embedding <=> $4::vector) <= $5
    ORDER BY c.embedding <=> $4::vector LIMIT $6`,
  [ownerId, model, vector.length, `[${vector.join(',')}]`, maxDistance, limit]);
  return result.rows;
}
