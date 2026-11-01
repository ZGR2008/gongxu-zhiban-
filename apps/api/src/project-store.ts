import type { Pool } from 'pg';

export type User = { id: string; name: string; email: string };
export type Project = { id: string; name: string; description: string; status: string; createdAt: Date; updatedAt: Date };
export type Requirement = { id: string; projectId: string; version: number; content: string; status: 'draft' | 'confirmed'; createdAt: Date; confirmedAt: Date | null };
export class RequirementWriteConflict extends Error {
  constructor(public readonly code: 'requirement_content_changed' | 'requirement_newer_draft_exists') { super(code); }
}
export interface ProjectStore {
  createUser(name: string, email: string, passwordHash: string): Promise<User | null>;
  findUserByEmail(email: string): Promise<(User & { passwordHash: string }) | null>;
  createSession(userId: string, tokenHash: string): Promise<void>;
  userBySession(tokenHash: string): Promise<User | null>;
  deleteSession(tokenHash: string): Promise<void>;
  listProjects(userId: string): Promise<Project[]>;
  createProject(userId: string, name: string, description: string): Promise<Project>;
  getProject(userId: string, projectId: string): Promise<Project | null>;
  listRequirements(userId: string, projectId: string): Promise<Requirement[] | null>;
  createRequirement(userId: string, projectId: string, content: string): Promise<Requirement | null>;
  updateRequirement(userId: string, projectId: string, id: string, content: string, expectedContent: string): Promise<Requirement | null>;
  confirmRequirement(userId: string, projectId: string, id: string, expectedContent: string): Promise<Requirement | null>;
}
const projectFields = `id, name, description, status, created_at AS "createdAt", updated_at AS "updatedAt"`;
const requirementFields = `id, project_id AS "projectId", version, content #>> '{}' AS content, status, created_at AS "createdAt", confirmed_at AS "confirmedAt"`;
export class PgProjectStore implements ProjectStore {
  constructor(private pool: Pool) {}
  async createUser(name: string, email: string, hash: string): Promise<User | null> {
    const r = await this.pool.query(`INSERT INTO users(name,email,password_hash) VALUES($1,$2,$3) ON CONFLICT(email) DO NOTHING RETURNING id,name,email`, [name,email,hash]); return r.rows[0] ?? null;
  }
  async findUserByEmail(email: string) { const r = await this.pool.query(`SELECT id,name,email,password_hash AS "passwordHash" FROM users WHERE email=$1`, [email]); return r.rows[0] ?? null; }
  async createSession(userId: string, hash: string) { await this.pool.query(`INSERT INTO user_sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '7 days')`, [userId,hash]); }
  async userBySession(hash: string) { const r = await this.pool.query(`SELECT u.id,u.name,u.email FROM users u JOIN user_sessions s ON s.user_id=u.id WHERE s.token_hash=$1 AND s.expires_at > now()`, [hash]); return r.rows[0] ?? null; }
  async deleteSession(hash: string) { await this.pool.query(`DELETE FROM user_sessions WHERE token_hash=$1`, [hash]); }
  async listProjects(userId: string) { const r = await this.pool.query(`SELECT ${projectFields} FROM projects WHERE owner_id=$1 ORDER BY updated_at DESC`, [userId]); return r.rows; }
  async createProject(userId: string, name: string, description: string) { const r = await this.pool.query(`INSERT INTO projects(owner_id,name,description) VALUES($1,$2,$3) RETURNING ${projectFields}`, [userId,name,description]); return r.rows[0]; }
  async getProject(userId: string, id: string) { const r = await this.pool.query(`SELECT ${projectFields} FROM projects WHERE owner_id=$1 AND id=$2`, [userId,id]); return r.rows[0] ?? null; }
  async listRequirements(userId: string, projectId: string) {
    if (!(await this.getProject(userId,projectId))) return null;
    const r = await this.pool.query(`SELECT ${requirementFields} FROM requirement_versions WHERE project_id=$1 ORDER BY version DESC`, [projectId]); return r.rows;
  }
  async createRequirement(userId: string, projectId: string, content: string) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const project = await client.query('SELECT id FROM projects WHERE id=$1 AND owner_id=$2 FOR UPDATE', [projectId,userId]);
      if (!project.rowCount) { await client.query('ROLLBACK'); return null; }
      const r = await client.query(`INSERT INTO requirement_versions(project_id,version,content) SELECT $1,COALESCE(MAX(version),0)+1,to_jsonb($2::text) FROM requirement_versions WHERE project_id=$1 RETURNING ${requirementFields}`, [projectId,content]);
      await client.query('COMMIT'); return r.rows[0];
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  }
  async updateRequirement(userId: string, projectId: string, id: string, content: string, expectedContent: string) {
    return this.writeDraft(userId, projectId, id, expectedContent, {kind:'edit', content});
  }
  async confirmRequirement(userId: string, projectId: string, id: string, expectedContent: string) {
    return this.writeDraft(userId, projectId, id, expectedContent, {kind:'confirm'});
  }
  private async writeDraft(userId: string, projectId: string, id: string, expectedContent: string, action: {kind:'edit';content:string}|{kind:'confirm'}): Promise<Requirement | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // All draft writes share creation/plan confirmation's project lock, so
      // review of a particular text cannot race an edit or a newer version.
      const project = await client.query('SELECT id FROM projects WHERE id=$1 AND owner_id=$2 FOR UPDATE', [projectId,userId]);
      if (!project.rowCount) { await client.query('ROLLBACK'); return null; }
      const selected = await client.query<Requirement>(`SELECT ${requirementFields} FROM requirement_versions WHERE id=$1 AND project_id=$2 FOR UPDATE`, [id,projectId]);
      const current = selected.rows[0];
      if (!current || current.status !== 'draft') { await client.query('ROLLBACK'); return null; }
      if (current.content !== expectedContent) throw new RequirementWriteConflict('requirement_content_changed');
      if (action.kind === 'confirm') {
        const latest = await client.query('SELECT id FROM requirement_versions WHERE project_id=$1 ORDER BY version DESC LIMIT 1', [projectId]);
        if (latest.rows[0]?.id !== id) throw new RequirementWriteConflict('requirement_newer_draft_exists');
      } else if (action.content === current.content) {
        await client.query('COMMIT'); return current;
      }
      const r = action.kind === 'confirm'
        ? await client.query<Requirement>(`UPDATE requirement_versions SET status='confirmed',confirmed_at=now() WHERE id=$1 AND project_id=$2 AND status='draft' RETURNING ${requirementFields}`, [id,projectId])
        : await client.query<Requirement>(`UPDATE requirement_versions SET content=to_jsonb($3::text) WHERE id=$1 AND project_id=$2 AND status='draft' RETURNING ${requirementFields}`, [id,projectId,action.content]);
      await client.query('COMMIT'); return r.rows[0] ?? null;
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  }
}
