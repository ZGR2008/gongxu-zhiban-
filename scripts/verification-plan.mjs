// Deliberately separate offline checks, controlled browsers, local data and paid AI.
export const suites=['offline','browser','accessibility','database'];
export function options(args){
 const result={suite:'offline',list:false,python:null};
 const seen=new Set();
 for(const arg of args){const key=arg.split('=')[0];if(seen.has(key))throw Error('Duplicate verification option');seen.add(key);
  if(arg==='--list')result.list=true;
  else if(arg.startsWith('--suite='))result.suite=arg.slice(8);
  else if(arg.startsWith('--python=')&&arg.length>9)result.python=arg.slice(9);
  else throw Error('Unknown verification option');
 }
 if(!suites.includes(result.suite))throw Error('Choose offline, browser, accessibility or database. Real models require a separately approved evaluation run.');
 return result;
}
export function plan(suite,rootTests){
 if(!suites.includes(suite))throw Error('Unknown suite');
 const node=(id,args,cwd='.',needs=[])=>({id,engine:'node',args,cwd,needs});
 const compile=(app,test=false)=>node(`${app}-${test?'test-build':'build'}`,[`node_modules/typescript/bin/tsc`,'-p',test?'tsconfig.test.json':'tsconfig.json'],`apps/${app}`);
 if(suite==='offline')return [
  node('environment-templates',['scripts/check-env-templates.mjs']),
  ...['api','embedding','web'].map(app=>node(`${app}-types`,['node_modules/typescript/bin/tsc','--noEmit','-p','tsconfig.json'],`apps/${app}`)),
  compile('api'),compile('embedding'),
  node('web-build',['node_modules/vite/bin/vite.js','build'],'apps/web',['web-types']),
  compile('api',true),compile('embedding',true),
  node('api-unit',['--test','dist/**/*.test.js'],'apps/api',['api-test-build']),
  node('embedding-unit',['--test','dist/**/*.test.js'],'apps/embedding',['embedding-test-build']),
  node('root-script-unit',['--test',...rootTests.map(file=>'scripts/'+file)],'.',['api-build']),
  {id:'python-package-regression',engine:'python',args:['scripts/export-review.test.py'],cwd:'.',needs:[]},
  node('offline-evaluation',['scripts/evaluate-offline.mjs'],'.',['api-build']),
  node('evaluation-preparation',['scripts/evaluate-prepare.mjs'],'.',['api-build']),
 ];
 if(suite==='browser')return [node('controlled-browser',['scripts/reliability-browser.mjs']),node('production-build',['node_modules/vite/bin/vite.js','build'],'apps/web'),node('production-recovery',['scripts/verify-production-recovery.mjs'],'.',['production-build']),node('entry-performance',['scripts/measure-web-entry.mjs','--assert-deferred'],'.',['production-build'])];
 if(suite==='accessibility')return [node('desktop-accessibility',['scripts/reliability-browser.mjs','--accessibility'])];
 return [compile('api'),...['execution-concurrency','segment-review','long-plan','reliability','requirement-preconditions','trace-concurrency','test-list','fresh-database','review-context','document-context','knowledge-answer','document-list','knowledge-list','index-compatibility','embedding-mixed','growth-scope','agent-recovery'].map(name=>node(name,['../../scripts/'+name+'-local.mjs'],'apps/api',['api-build']))];
}
