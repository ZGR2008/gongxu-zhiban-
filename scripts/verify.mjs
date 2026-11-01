import {spawn} from 'node:child_process';
import {mkdir,readdir,writeFile,access} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join,isAbsolute,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {options,plan} from './verification-plan.mjs';
import {sourceProvenance} from '../evaluation/source-provenance.mjs';

const root=fileURLToPath(new URL('../',import.meta.url)),config=options(process.argv.slice(2));
const rootTests=(await readdir(join(root,'scripts'))).filter(name=>name.endsWith('.test.mjs')).sort();
if(!rootTests.length)throw Error('Root regression discovery returned no files');
const steps=plan(config.suite,rootTests);
if(config.list){console.log(JSON.stringify({suite:config.suite,paidCalls:false,steps},null,2));}
else{
 const out=join(root,'.runtime','verification-v4-'+randomUUID());await mkdir(out,{recursive:true});
 const report={suite:config.suite,startedAt:new Date().toISOString(),...sourceProvenance(root),scope:config.suite==='offline'?'local_builds_unit_fixtures_and_protocols_no_model_no_database':config.suite==='database'?'explicit_real_local_data_synthetic_accounts_and_model_fixtures':'controlled_browser_no_real_model',paidModelCalls:0,steps:[]};
 let python=config.python??process.env.VERIFY_PYTHON;
 if(!python&&process.platform==='win32'&&process.env.USERPROFILE){const bundled=join(process.env.USERPROFILE,'.cache','codex-runtimes','codex-primary-runtime','dependencies','python','python.exe');try{await access(bundled);python=bundled;}catch{}}
 python??=process.platform==='win32'?'python':'python3';
 const succeeded=new Set();
 for(const step of steps){
  const entry={id:step.id,command:[step.engine==='python'?'python': 'node',...step.args],cwd:step.cwd,status:'running',startedAt:new Date().toISOString()};report.steps.push(entry);
  if(step.needs.some(id=>!succeeded.has(id))){entry.status='not_run';entry.reason='required_build_failed';console.log('NOT RUN '+step.id);continue;}
  console.log('RUN '+step.id);const log=createWriteStream(join(out,step.id+'.log'));
  const started=Date.now();
  const result=await new Promise(resolveResult=>{
   const child=spawn(step.engine==='python'?python:process.execPath,step.args,{cwd:resolve(root,step.cwd),env:{...process.env},windowsHide:true,shell:false});
   child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});let settled=false,timedOut=false,notRun=false;let tail='';
   child.stdout.on('data',chunk=>{tail=(tail+String(chunk)).slice(-4096);if(/(?:^|\n)NOT RUN\b/.test(tail))notRun=true;});
   const finish=value=>{if(settled)return;settled=true;clearTimeout(timer);resolveResult(value);};
   const timer=setTimeout(()=>{timedOut=true;child.kill();},config.suite==='offline'?600000:1200000);
   child.on('error',()=>finish({status:'not_run',reason:'runtime_unavailable'}));child.on('close',code=>finish(timedOut?{status:'failed',reason:'bounded_step_timeout'}:notRun?{status:'not_run',reason:'child_reported_missing_environment',exitCode:code}:{status:code===0?'passed':'failed',exitCode:code}));
  });
  await new Promise(resolveLog=>log.end(resolveLog));Object.assign(entry,result,{elapsedMs:Date.now()-started,log:step.id+'.log'});
  if(entry.status==='passed')succeeded.add(step.id);
  console.log(entry.status.toUpperCase()+' '+step.id);
  await writeFile(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
 }
 report.finishedAt=new Date().toISOString();report.status=report.steps.every(x=>x.status==='passed')?'passed':'incomplete_or_failed';
 await writeFile(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
 console.log('Report: '+join(out,'report.json'));if(report.status!=='passed')process.exitCode=1;
}
