// Real, isolated local database install check. Uses the existing role as-is.
// No credentials are displayed or written; the synthetic database is retained.
import {createRequire} from 'node:module';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import assert from 'node:assert/strict';
import {loadConfig} from '../apps/api/dist/config.js';
import {createApp} from '../apps/api/dist/app.js';
import {PgProjectStore} from '../apps/api/dist/project-store.js';
import {migrationFiles,migrationDirectory} from '../apps/api/dist/database-readiness.js';

const require=createRequire(new URL('../apps/api/package.json',import.meta.url));
require('dotenv').config({path:fileURLToPath(new URL('../apps/api/.env',import.meta.url))});
const config=loadConfig();
const local=url=>['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname);
if(!config.DATABASE_URL||!local(config.DATABASE_URL))throw Error('An existing loopback database is required');
const {Pool}=require('pg'),exec=promisify(execFile);
const source=new Pool({connectionString:config.DATABASE_URL,connectionTimeoutMillis:3000,query_timeout:10000});
const name='gx_review_v4_'+randomUUID().replaceAll('-','');
assert.match(name,/^gx_review_v4_[a-f0-9]{32}$/);
const target=new URL(config.DATABASE_URL);assert.notEqual(target.pathname,'/'+name);target.pathname='/'+name;
const directory=new URL(`../.runtime/fresh-database-local-${randomUUID()}/`,import.meta.url);await mkdir(directory,{recursive:true});
const report={scope:'real_local_fresh_database_actual_migration_cli_and_loopback_http',originalDatabaseModified:false,credentialsChanged:false,permissionsChanged:false,realModel:false,externalCalls:0,syntheticRecords:true,checks:[],httpChecks:[],startedAt:new Date().toISOString(),retainedSyntheticDatabase:null};
const originalFetch=globalThis.fetch;
globalThis.fetch=(input,options)=>{if(!local(input instanceof Request?input.url:String(input)))throw Error('External requests prohibited');return originalFetch(input,{...options,redirect:'error'});};
let pool,app,origin,identity,stage='permission_check';
async function check(label,work){stage=label;await work();report.checks.push({name:label,status:'passed'});console.log(`PASS ${label}`);}
async function migrate(expected){
 // Child env changes only the test destination; no .env files or service config are written.
 const result=await exec(process.execPath,[fileURLToPath(new URL('../apps/api/dist/migrate.js',import.meta.url))],{cwd:fileURLToPath(new URL('../apps/api/',import.meta.url)),env:{...process.env,DATABASE_URL:target.href},timeout:30000,maxBuffer:128000,windowsHide:true});
 const lines=result.stdout.split(/\r?\n/).filter(line=>/^(Applied migration|Migration \d+_[a-z0-9_]+ already applied)/.test(line));
 assert.equal(lines.length,21);assert.equal(lines.filter(line=>line.startsWith('Applied migration')).length,expected);
 return lines.map(line=>line.match(/\d+_[a-z0-9_]+/)[0]);
}
async function call(method,path,body){const response=await fetch(new URL(path,origin),{method,headers:{...(identity?{authorization:'Bearer '+identity.token}:{}),...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});return {status:response.status,body:await response.json()};}
function status(label,result,expected){report.httpChecks.push({name:label,status:result.status,expected});assert.equal(result.status,expected,label);return result.body;}
try{
 const permission=await source.query('SELECT rolcreatedb OR rolsuper AS allowed FROM pg_roles WHERE rolname=current_user');
 if(!permission.rows[0]?.allowed){report.status='not_run';report.reason='Existing role cannot create an isolated database; no permission changes attempted';console.log('NOT RUN existing role has no database creation permission');}
 else{
  const files=await migrationFiles();assert.equal(files.length,21);assert.ok(files.includes('020_test_execution_revision.sql'));assert.ok(files.includes('021_requirement_segment_reviews.sql'));
  report.migrations=await Promise.all(files.map(async file=>({file,sha256:createHash('sha256').update(await readFile(new URL(file,migrationDirectory))).digest('hex')})));
  await source.query(`CREATE DATABASE ${name} TEMPLATE template0`);report.retainedSyntheticDatabase=name;
  pool=new Pool({connectionString:target.href,connectionTimeoutMillis:3000,statement_timeout:15000,query_timeout:18000});
  await check('empty_database_has_no_project_tables_or_migration_history',async()=>{const r=await pool.query("SELECT to_regclass('users') IS NULL AND to_regclass('schema_migrations') IS NULL AS empty");assert.equal(r.rows[0].empty,true);});
  let installed;
  await check('actual_cli_installs_all_twenty_one_migrations_and_vector_on_empty_database',async()=>{installed=await migrate(21);const r=await pool.query("SELECT version FROM schema_migrations ORDER BY version");assert.deepEqual(r.rows.map(row=>row.version),installed);assert.equal((await pool.query("SELECT COUNT(*)::int AS n FROM pg_extension WHERE extname IN ('vector','pgcrypto')")).rows[0].n,2);assert.equal((await pool.query("SELECT column_default FROM information_schema.columns WHERE table_name='practice_test_cases' AND column_name='execution_revision'")).rows[0].column_default,'0');});
  await check('second_cli_run_preserves_migration_timestamps_and_empty_business_tables',async()=>{const before=(await pool.query('SELECT version,applied_at FROM schema_migrations ORDER BY version')).rows;assert.deepEqual(await migrate(0),installed);assert.deepEqual((await pool.query('SELECT version,applied_at FROM schema_migrations ORDER BY version')).rows,before);assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM users')).rows[0].n,0);});
  app=await createApp({projectStore:new PgProjectStore(pool),pool,database:{query:sql=>pool.query(sql),end:async()=>{}},corsOrigin:'http://127.0.0.1:5173'});origin=await app.listen({host:'127.0.0.1',port:0});
  await check('fresh_service_is_ready_and_manual_workflow_persists_without_ai',async()=>{
   status('ready',await call('GET','/ready'),200);identity=status('register',await call('POST','/auth/register',{name:'空库验收 · 合成',email:`fresh-review-${randomUUID()}@example.test`,password:randomBytes(24).toString('base64url')}),201);
   const p=status('create_project',await call('POST','/projects',{name:'独立空库验收 · 合成',description:'实际迁移入口检查，不含已有业务数据'}),201);const root=`/projects/${p.project.id}`;
   const v=status('create_requirement',await call('POST',root+'/requirements',{content:'保存与确认需求后，必须可查看准确版本和原文条目。'}),201).requirement;
   status('confirm_requirement',await call('POST',`${root}/requirements/${v.id}/confirm`,{expectedContent:v.content}),200);
   const trace=status('read_trace',await call('GET',root+'/trace'),200);assert.equal(trace.version.id,v.id);assert.equal(trace.items.length,1);
   status('create_code_draft',await call('PUT',root+'/code-draft',{language:'typescript',code:'const syntheticDraft = 1;',expectedRevision:0}),201);assert.equal(status('read_code_draft',await call('GET',root+'/code-draft'),200).draft.code,'const syntheticDraft = 1;');
   assert.equal(status('read_ai_status',await call('GET','/ai/status'),200).configured,false);
  });
  report.status='passed';
 }
}catch(error){report.status='failed';report.failedStage=stage;report.errorType=error.name;report.safeCode=typeof error.code==='string'&&/^[A-Z0-9_]{1,40}$/.test(error.code)?error.code:null;console.error(`FAIL ${stage} (${error.name}); connection details suppressed`);process.exitCode=1;}
finally{await app?.close();await pool?.end();await source.end();report.finishedAt=new Date().toISOString();await writeFile(new URL('report.json',directory),JSON.stringify(report,null,2)+'\n');console.log('Report: '+fileURLToPath(new URL('report.json',directory)));}
