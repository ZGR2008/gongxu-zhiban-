import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { loadConfig } from './config.js';
import { migrationDirectory, migrationFiles } from './database-readiness.js';

const config = loadConfig();
if (!config.DATABASE_URL) throw new Error('DATABASE_URL is required to run database migrations');
const pool = new pg.Pool({ connectionString: config.DATABASE_URL, connectionTimeoutMillis: 3000 });
try {
  const files = await migrationFiles();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('gongxu-zhiban-migrations'))");
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
    for (const file of files) {
      const version = file.slice(0, -4);
      const existing = await client.query('SELECT 1 FROM schema_migrations WHERE version = $1', [version]);
      if (!existing.rowCount) {
        await client.query(await readFile(new URL(file, migrationDirectory), 'utf8'));
        await client.query('INSERT INTO schema_migrations(version) VALUES ($1)', [version]);
        console.log(`Applied migration ${version}`);
      } else console.log(`Migration ${version} already applied`);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
} finally { await pool.end(); }
