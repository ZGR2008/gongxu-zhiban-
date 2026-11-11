// Explicit local CLI. Default is a read-only preflight; --apply commits the reviewed kit once.
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {mkdir, writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {recordingKit} from '../demo/recording-kit-v1.mjs';
import {importRecordingMaterials, RecordingImportError} from './recording-import-core.mjs';
const args = process.argv.slice(2), allowed = new Set(['--teacher','--student','--apply']);
const values = {};
for (let i=0;i<args.length;i++) {
  const name=args[i];
  if (!allowed.has(name) || Object.hasOwn(values,name)) throw Error('Use --teacher EMAIL --student EMAIL [--apply]');
  values[name]=name==='--apply'?true:args[++i];
}
if (!values['--teacher'] || !values['--student']) throw Error('Exact teacher and student email arguments are required');
const require = createRequire(new URL('../apps/api/package.json',import.meta.url));
const out = new URL('../.runtime/recording-import-'+randomUUID()+'/',import.meta.url);
let pool;
try {
  require('dotenv').config({path:fileURLToPath(new URL('../apps/api/.env',import.meta.url)),quiet:true});
  const url = new URL(process.env.DATABASE_URL ?? 'invalid:');
  if (!['postgres:','postgresql:'].includes(url.protocol) || !['127.0.0.1','localhost','[::1]'].includes(url.hostname) || url.search || url.hash) throw Error('Local database configuration required');
  const {Pool} = require('pg'); pool = new Pool({connectionString:url.href,connectionTimeoutMillis:4000,statement_timeout:15000});
  const result=await importRecordingMaterials(pool,{teacherEmail:values['--teacher'],studentEmail:values['--student'],kit:recordingKit,apply:values['--apply']===true});
  await mkdir(out,{recursive:true});
  await writeFile(new URL('manifest.json',out),JSON.stringify(result,null,2)+'\n');
  let actual;
  if(result.projectId){
    const summary=(await pool.query(`SELECT
      (SELECT status FROM requirement_versions WHERE id=$2 AND project_id=$1) AS "requirementStatus",
      (SELECT count(*)::int FROM practice_test_cases WHERE project_id=$1) AS cases,
      (SELECT count(*)::int FROM practice_test_cases WHERE project_id=$1 AND result='not_run' AND executor_id IS NULL AND executed_at IS NULL) AS "notRunCases",
      (SELECT count(*)::int FROM project_documents WHERE project_id=$1) AS documents,
      (SELECT count(*)::int FROM agent_runs WHERE project_id=$1) AS "agentRuns",
      (SELECT count(*)::int FROM tasks WHERE project_id=$1) AS "formalTasks",
      (SELECT count(*)::int FROM teaching_submissions WHERE claim_id=$3) AS submissions,
      (SELECT state FROM teaching_claims WHERE id=$3) AS "claimState",
      (SELECT count(*)::int FROM teaching_members WHERE class_id=$4 AND active) AS "classMembers"`,
      [result.projectId,result.requirementId,result.claimId,result.classId])).rows[0];
    const versions=(await pool.query('SELECT number,state FROM teaching_assignment_versions WHERE assignment_id=$1 ORDER BY number',[result.assignmentId])).rows;
    actual={...summary,versions,verifiedAt:new Date().toISOString()};
    await writeFile(new URL('actual-state.json',out),JSON.stringify(actual,null,2)+'\n');
    if(result.applied && (summary.requirementStatus!=='draft'||summary.cases!==recordingKit.cases.length||summary.notRunCases!==recordingKit.cases.length||summary.documents!==recordingKit.documents.length||summary.agentRuns!==0||summary.formalTasks!==0||summary.submissions!==0||summary.claimState!=='working'||summary.classMembers!==1))throw new RecordingImportError('committed_import_state_changed_inspect_manifest_before_retry');
  }
  console.log(JSON.stringify({applied:result.applied,reused:result.reused,identitiesVerified:result.identitiesVerified??true,expected:result.expected,current:result.current,
    actual,projectUrl:result.projectId?`http://127.0.0.1:5173/projects/${result.projectId}/requirements`:undefined,manifest:fileURLToPath(new URL('manifest.json',out))},null,2));
} catch (error) {
  // Do not emit database error details, connection strings, account names, credentials or query parameters.
  console.error(error instanceof RecordingImportError?error.code:'recording_import_failed_details_suppressed');process.exitCode=1;
} finally { await pool?.end(); }
