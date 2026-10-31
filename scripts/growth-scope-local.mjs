import {createRequire} from 'node:module';
import {randomUUID,randomBytes} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {loadConfig} from '../apps/api/dist/config.js';
import {PgProjectStore} from '../apps/api/dist/project-store.js';
import {registerProjectRoutes} from '../apps/api/dist/project-routes.js';
import {registerGrowthRoutes} from '../apps/api/dist/growth/routes.js';

// Synthetic fixtures in the existing local DB only; never delete user data or call AI.
const require=createRequire(new URL('../apps/api/package.json',import.meta.url));require('dotenv').config();
const config=loadConfig();if(!config.DATABASE_URL||!['localhost','127.0.0.1','[::1]'].includes(new URL(config.DATABASE_URL).hostname))throw Error('Local database required');
const {Pool}=require('pg'),Fastify=require('fastify'),pool=new Pool({connectionString:config.DATABASE_URL,connectionTimeoutMillis:3000});
const store=new PgProjectStore(pool),app=Fastify({logger:false});await registerProjectRoutes(app,store);await registerGrowthRoutes(app,store,pool);
app.get('/health',async()=>({status:'ok',service:'gongxu-api'}));app.get('/ready',async()=>({status:'ready'}));app.get('/ai/status',async()=>({configured:false}));
const output=new URL(`../.runtime/growth-scope-local-${randomUUID()}/`,import.meta.url);await mkdir(output,{recursive:true});
const report={scope:'real_local_database_synthetic_records_no_model',checks:[],startedAt:new Date().toISOString()};let stage='setup',owner,foreign,browser;
const call=(method,url,payload,identity=owner)=>app.inject({method,url,headers:{authorization:`Bearer ${identity.token}`},...(payload===undefined?{}:{payload})});
async function check(name,work){stage=name;await work();report.checks.push({name,status:'passed'});console.log(`PASS ${name}`);}
async function project(identity,name){const response=await call('POST','/projects',{name,description:'仅合成统计回归，不代表学生成果'},identity);assert.equal(response.statusCode,201);return response.json().project.id;}
async function version(identity,id,content){const response=await call('POST',`/projects/${id}/requirements`,{content},identity);assert.equal(response.statusCode,201);const result=response.json().requirement.id;assert.equal((await call('POST',`/projects/${id}/requirements/${result}/confirm`,undefined,identity)).statusCode,200);return result;}
async function seed(identity,projectId,requirementId,status,result){
 const run=await pool.query("INSERT INTO agent_runs(project_id,requirement_version_id,model_name,status,finished_at) VALUES($1,$2,'synthetic-fixture','confirmed',now()) RETURNING id",[projectId,requirementId]);
 await pool.query("INSERT INTO tasks(project_id,requirement_version_id,agent_run_id,plan_key,title,stage,description,deliverable,status) VALUES($1,$2,$3,'fixture','合成统计任务','开发','统计测试专用','仅合成记录',$4)",[projectId,requirementId,run.rows[0].id,status]);
 await pool.query("INSERT INTO practice_test_cases(project_id,requirement_version_id,category,title,preconditions,steps,expected,model_name,result,execution_note,executor_id,executed_at) VALUES($1,$2,'normal','合成统计用例','仅本地测试','检查聚合','不混用历史','synthetic-fixture',$3,'仅合成统计夹具',$4,CASE WHEN $3='not_run' THEN NULL ELSE now() END)",[projectId,requirementId,result,result==='not_run'?null:identity.id]);
}
try{
 for(const other of [false,true]){const response=await app.inject({method:'POST',url:'/auth/register',payload:{name:'成长统计 · 合成',email:`growth-scope-${randomUUID()}@example.test`,password:randomBytes(24).toString('base64url')}});assert.equal(response.statusCode,201);const data=response.json(),identity={id:data.user.id,token:data.token};if(other)foreign=identity;else owner=identity;}
 const a=await project(owner,'统计项目A · 合成'),a1=await version(owner,a,'旧版要求'),a2=await version(owner,a,'当前要求');
 const b=await project(owner,'统计项目B · 合成'),b1=await version(owner,b,'另一项目当前要求');
 const f=await project(foreign,'账号隔离 · 合成'),f1=await version(foreign,f,'不可跨账号汇总');
 await seed(owner,a,a1,'done','passed');await seed(owner,a,a1,'blocked','failed');await seed(owner,a,a2,'todo','not_run');await seed(owner,b,b1,'doing','not_run');await seed(foreign,f,f1,'done','passed');
 await check('growth_defaults_to_each_projects_current_version_without_inheriting_old_results',async()=>{
  const response=await call('GET','/growth');assert.equal(response.statusCode,200);const data=response.json();
  assert.equal(data.counts.tasks.total,2);assert.equal(data.counts.tasks.done,0);assert.equal(data.counts.tasks.blocked,0);assert.equal(data.counts.testCases,2);assert.equal(data.counts.testExecutions.total,0);assert.equal(data.counts.projects,2);assert.equal(data.counts.confirmedRequirements,2);
  assert.ok(!data.recommendations.some(item=>['blocked_tasks','failed_tests'].includes(item.code)));assert.equal(data.scope,'current');
 });
 await check('explicit_history_keeps_prior_records_and_does_not_change_current_scope',async()=>{
  const data=(await call('GET','/growth?scope=history')).json();assert.equal(data.scope,'history');assert.equal(data.counts.tasks.total,4);assert.equal(data.counts.tasks.done,1);assert.equal(data.counts.testCases,4);assert.equal(data.counts.testExecutions.passed,1);assert.equal(data.counts.testExecutions.failed,1);assert.equal(data.counts.confirmedRequirements,3);assert.deepEqual(data.recommendations,[]);
  assert.equal((await call('GET','/growth')).json().counts.tasks.total,2);
 });
 await check('scope_validation_and_account_isolation_are_enforced',async()=>{
  assert.equal((await call('GET','/growth?scope=invalid')).statusCode,400);assert.equal((await app.inject({url:'/growth?scope=history'})).statusCode,401);
  const data=(await call('GET','/growth',undefined,foreign)).json();assert.equal(data.counts.projects,1);assert.equal(data.counts.tasks.total,1);assert.equal(data.counts.tasks.done,1);assert.ok(data.events.every(row=>row.projectId===f));
 });
 await check('desktop_current_and_history_statistics_match_real_database',async()=>{
  const address=await app.listen({host:'127.0.0.1',port:0});const {chromium}=await import('playwright');browser=await chromium.launch({headless:true,channel:process.platform==='win32'?'msedge':undefined});
  const context=await browser.newContext({viewport:{width:1536,height:960},reducedMotion:'reduce'});await context.addInitScript(token=>localStorage.setItem('gongxu_token',token),owner.token);const page=await context.newPage();page.setDefaultTimeout(12000);let errors=0;page.on('pageerror',()=>errors++);
  await page.route('**/*',async route=>{const url=new URL(route.request().url());if(url.origin!=='http://127.0.0.1:5173')return route.abort();if(!url.pathname.startsWith('/api/'))return route.continue();const response=await route.fetch({url:address+url.pathname.slice(4)+url.search,maxRedirects:0});await route.fulfill({response});});
  await page.goto('http://127.0.0.1:5173/growth');await page.getByRole('heading',{name:'当前版本任务进度',exact:true}).waitFor();assert.ok((await page.getByRole('region',{name:'任务进度',exact:true}).innerText()).includes('共 2 项'));assert.ok((await page.getByRole('region',{name:'审查与测试统计',exact:true}).innerText()).includes('0 / 0 / 0'));
  await page.getByLabel('任务与测试统计范围').selectOption('history');await page.getByRole('heading',{name:'历史任务状态',exact:true}).waitFor();assert.ok((await page.getByRole('region',{name:'审查与测试统计',exact:true}).innerText()).includes('1 / 1 / 0'));
  await page.getByLabel('任务与测试统计范围').selectOption('current');await page.getByRole('heading',{name:'当前版本任务进度',exact:true}).waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);assert.equal(errors,0);
  await page.screenshot({path:fileURLToPath(new URL('growth-current-desktop.png',output))});await context.close();
 });
 report.status='passed';
}catch(error){report.status='failed';report.failedStage=stage;report.errorType=error.constructor.name;console.log(`FAIL ${stage} (${error.constructor.name})`);process.exitCode=1;}
finally{await browser?.close();for(const identity of [owner,foreign])if(identity)await call('POST','/auth/logout',undefined,identity).catch(()=>{});await app.close();await pool.end();report.finishedAt=new Date().toISOString();await writeFile(new URL('report.json',output),JSON.stringify(report,null,2));console.log(`Report: ${fileURLToPath(new URL('report.json',output))}`);}
