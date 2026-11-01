// Default is preparation only. --approved-live must only be used after the user
// approves this exact manifest, provider/model, bounded cost and synthetic data.
import {readFile,writeFile,mkdir,realpath,stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';import {resolve,relative,join} from 'node:path';import {createRequire} from 'node:module';import {randomUUID} from 'node:crypto';
import {prepareLive,executeLive} from '../evaluation/live-policy.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),args=process.argv.slice(2);
if(args.length<1||args.length>2||!args[0].startsWith('--prepared=')||(args[1]&&args[1]!=='--approved-live'))throw Error('Use --prepared=.runtime/evaluation-prepared-ID/prepared-inputs.json, optionally --approved-live only after approval');
const input=await realpath(resolve(root,args[0].slice(11))),rel=relative(root,input).replaceAll('\\','/');
if(!/^\.runtime\/evaluation-prepared-[a-f0-9-]+\/prepared-inputs\.json$/.test(rel)||(await stat(input)).size>1000000)throw Error('Only local bounded synthetic preparation manifests accepted');
const manifest=JSON.parse(await readFile(input,'utf8')),prepared=prepareLive(manifest);
const publicScope={policy:prepared.policy,manifestHash:prepared.manifestHash,plannedCalls:prepared.calls.length,reservedUSD:prepared.reservedUSD,dataScope:'versioned synthetic requirements/documents and application prompt templates only; no user uploads, business data or source files',fullHistoricalWorkflow:'not_reproduced',cases:prepared.calls.map(({caseId,pipeline,inputBytes,promptHash})=>({caseId,pipeline,inputBytes,promptHash})),omitted:prepared.omitted};
if(!args.includes('--approved-live'))console.log(JSON.stringify({...publicScope,status:'awaiting_explicit_approval',actualModelCalls:0},null,2));
else{
 const require=createRequire(new URL('../apps/api/package.json',import.meta.url));require('dotenv').config({path:join(root,'apps/api/.env')});
 const out=join(root,'.runtime','evaluation-live-v4-'+randomUUID());await mkdir(out,{recursive:true});
 const report={...publicScope,startedAt:new Date().toISOString(),records:[],actualModelCalls:0,status:'running',quality:'not_judged'};
 await writeFile(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
 try{const result=await executeLive(prepared,{apiKey:process.env.AI_API_KEY,fetchImpl:fetch,onRecord:async(_record,records)=>{report.records=records;report.actualModelCalls=records.length;await writeFile(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');}});Object.assign(report,{reservedUSD:result.reservedUSD,unexecutedCalls:result.remainingCalls,status:result.remainingCalls?'incomplete':'completed_calls_not_quality_acceptance'});}
 catch{report.status='not_run_or_failed';report.reason='local_credential_or_runtime_unavailable';process.exitCode=1;}
 report.finishedAt=new Date().toISOString();await writeFile(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log('Report: '+join(out,'report.json'));console.log('Actual model calls: '+report.actualModelCalls+'; semantic judgments remain unjudged');
}
