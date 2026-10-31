import { readdir } from 'node:fs/promises';

export const migrationDirectory = new URL('../migrations/', import.meta.url);

export async function migrationFiles(): Promise<string[]> {
  const files = (await readdir(migrationDirectory)).filter(name => /^\d+_[a-z0-9_]+\.sql$/.test(name)).sort();
  if (!files.length) throw new Error('Database migration files are missing');
  return files;
}

type Database = { query: (sql: string) => Promise<unknown> };
type Readiness = { status: 'ready' | 'not_ready'; database: 'connected'; schema: 'current' | 'migration_required'; vector: 'installed' | 'missing' };

/** A reachable PostgreSQL process alone does not make the application ready. */
export async function databaseReadiness(database: Database, versions: string[]): Promise<Readiness> {
  const metadata = await database.query(`SELECT to_regclass('schema_migrations') IS NOT NULL AS "hasMigrations",
    EXISTS(SELECT 1 FROM pg_extension WHERE extname='vector') AS "hasVector"`) as { rows: { hasMigrations: boolean; hasVector: boolean }[] };
  const state = metadata.rows[0];
  let current = false;
  if (state.hasMigrations) {
    const applied = await database.query('SELECT version FROM schema_migrations') as { rows: { version: string }[] };
    const known = new Set(applied.rows.map(row => row.version));
    current = versions.every(version => known.has(version));
  }
  return {
    status: current && state.hasVector ? 'ready' : 'not_ready', database: 'connected',
    schema: current ? 'current' : 'migration_required', vector: state.hasVector ? 'installed' : 'missing',
  };
}
