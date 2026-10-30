import type { Pool } from 'pg';

export type User = { id: string; name: string; email: string };
export type Project = { id: string; name: string; description: string; status: string; createdAt: Date; updatedAt: Date };
export type Requirement = { id: string; projectId: string; version: number; content: string; status: 'draft' | 'confirmed'; createdAt: Date; confirmedAt: Date | null };
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
  updateRequirement(userId: string, projectId: string, id: string, content: string): Promise<Requirement | null>;
  confirmRequirement(userId: string, projectId: string, id: string): Promise<Requirement | null>;
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
  async updateRequirement(userId: string, projectId: string, id: string, content: string) {
    const r = await this.pool.query(`UPDATE requirement_versions r SET content=to_jsonb($4::text) FROM projects p WHERE r.id=$3 AND r.project_id=$2 AND p.id=r.project_id AND p.owner_id=$1 AND r.status='draft' RETURNING r.id,r.project_id AS "projectId",r.version,r.content #>> '{}' AS content,r.status,r.created_at AS "createdAt",r.confirmed_at AS "confirmedAt"`, [userId,projectId,id,content]); return r.rows[0] ?? null;
  }
  async confirmRequirement(userId: string, projectId: string, id: string) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Share this project lock with agent-plan confirmation so a newer requirement
      // cannot be confirmed between the plan's version check and task creation.
      const project = await client.query('SELECT id FROM projects WHERE id=$1 AND owner_id=$2 FOR UPDATE', [projectId,userId]);
      if (!project.rowCount) { await client.query('ROLLBACK'); return null; }
      const r = await client.query(`UPDATE requirement_versions r SET status='confirmed',confirmed_at=now() WHERE r.id=$1 AND r.project_id=$2 AND r.status='draft' RETURNING r.id,r.project_id AS "projectId",r.version,r.content #>> '{}' AS content,r.status,r.created_at AS "createdAt",r.confirmed_at AS "confirmedAt"`, [id,projectId]);
      await client.query('COMMIT'); return r.rows[0] ?? null;
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  }
}
