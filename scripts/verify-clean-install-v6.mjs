// Invoke only after an independently installed, sanitized source copy was built and verified offline.
// Credentials remain in the child environment; no .env is copied to the review source.
import {realpath,mkdir,writeFile} from 'node:fs/promises';import {fileURLToPath} from 'node:url';
import {resolve,relative,isAbsolute,join} from 'node:path';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {randomUUID} from 'node:crypto';
import {isolatedVerificationDatabase} from './isolated-verification-db.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
if(process.argv.length!==3)throw Error('Provide one local sanitized review source directory');
const target=await realpath(resolve(process.argv[2])),base=await realpath(resolve(root,'../.review-export')),rel=relative(base,target);
if(!rel||rel.startsWith('..')||isAbsolute(rel))throw Error('Only a source copy within the workspace review export directory is accepted');
const out=join(root,'.runtime','clean-install-v6-'+randomUUID());await mkdir(out,{recursive:true});
const report={scope:'independent_sanitized_source_dependencies_existing_host_runtimes_isolated_database',sourceCopy:rel,paidModelCalls:0,configurationCopied:false,primaryDatabaseModified:false,startedAt:new Date().toISOString()};
try{const database=await isolatedVerificationDatabase();report.database=database.evidence;
 const result=await promisify(execFile)(process.execPath,['scripts/fresh-database-local.mjs'],{cwd:target,env:{...process.env,...database.env},windowsHide:true,timeout:120000,maxBuffer:512000});
 await writeFile(join(out,'fresh-database.log'),result.stdout+result.stderr);report.status='passed';report.command='node scripts/fresh-database-local.mjs (in independent copy; isolated environment)';
}catch{report.status='failed';report.reason='Independent copy/database verification failed; environment values suppressed';process.exitCode=1;}
finally{report.finishedAt=new Date().toISOString();await writeFile(join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,report:join(out,'report.json')}));}
