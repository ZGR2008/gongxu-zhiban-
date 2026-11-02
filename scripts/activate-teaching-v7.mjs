// Additive local migration only. No role grants, no private row export, no model calls.
import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';
import {mkdir,writeFile} from 'node:fs/promises';import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';import assert from 'node:assert/strict';
const require=createRequire(new URL('../apps/api/package.json',import.meta.url));require('dotenv').config({path:fileURLToPath(new URL('../apps/api/.env',import.meta.url)),quiet:true});
assert.ok(['localhost','127.0.0.1','[::1]'].includes(new URL(process.env.DATABASE_URL).hostname));
const pool=new(require('pg').Pool)({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:3000});
const dir=new URL(`../.runtime/teaching-activation-v7-${randomUUID()}/`,import.meta.url);await mkdir(dir,{recursive:true});
const report={startedAt:new Date().toISOString(),scope:'authorized_local_additive_migrations',newPaidModelCalls:0,realRoleGrants:0};
try{
 const snapshot=async()=>({projects:(await pool.query('SELECT count(*)::int AS n FROM projects')).rows[0].n,requirements:(await pool.query('SELECT count(*)::int AS n FROM requirement_versions')).rows[0].n,privateDocuments:(await pool.query('SELECT count(*)::int AS n FROM knowledge_documents WHERE owner_id IS NOT NULL')).rows[0].n});
 const active=(await pool.query("SELECT (SELECT count(*) FROM long_plan_jobs WHERE status IN ('queued','running'))+(SELECT count(*) FROM agent_runs WHERE status IN ('queued','running')) AS n")).rows[0].n;
 assert.equal(Number(active),0,'Active generation found; do not restart API or migrate blindly');report.activeGenerations=Number(active);report.before=await snapshot();const integrity=async()=>{const result={};for(const table of ['projects','requirement_versions','practice_test_cases','project_documents','teaching_submissions','teaching_roles'])result[table]=(await pool.query(`SELECT md5(coalesce(string_agg(md5(row_to_json(t)::text),'' ORDER BY md5(row_to_json(t)::text)),'')) AS fingerprint FROM ${table} t`)).rows[0].fingerprint;return result;};const fingerprints=await integrity();
 await promisify(execFile)(process.execPath,[fileURLToPath(new URL('../apps/api/dist/migrate.js',import.meta.url))],{cwd:fileURLToPath(new URL('../apps/api/',import.meta.url)),env:process.env,windowsHide:true,maxBuffer:128000,timeout:30000});
 report.after=await snapshot();assert.deepEqual(report.after,report.before);assert.deepEqual(await integrity(),fingerprints);report.protectedRecordFingerprintsUnchanged=true;report.migrations=(await pool.query('SELECT version FROM schema_migrations ORDER BY version')).rows.map(r=>r.version);assert.equal(report.migrations.length,25);
 report.publicDocuments=(await pool.query("SELECT count(*)::int AS n FROM knowledge_documents WHERE visibility='platform_public'")).rows[0].n;
 report.status='passed';
}catch{report.status='failed';report.reason='Precondition or migration failed; configuration and database row content suppressed. Inspect schema/state with the documented read-only procedure.';process.exitCode=1;}
finally{await pool.end();await writeFile(new URL('report.json',dir),JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,report:fileURLToPath(new URL('report.json',dir))}));}
