import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import type { Pool } from 'pg';
import type { ProjectStore } from '../project-store.js';
import { registerGrowthRoutes, recommendations } from './routes.js';

const owner = 'b6339d14-65b6-4ab7-8d43-4197609d09ee';
const project = 'f121f4c1-2ec0-4d1f-8d9c-38a761d788be';
const task = 'd3d80f1c-5c71-4f7d-b3a6-cd8af99c3e9d';
const auth = { authorization: `Bearer ${'a'.repeat(64)}` };
const store = { userBySession: async () => ({ id: owner }) } as unknown as ProjectStore;
const empty = { projects: 0, confirmedRequirements: 0, tasksTotal: 0, todo: 0, doing: 0, review: 0, done: 0, blocked: 0, codeReviews: 0, syntaxFindings: 0, testCases: 0, executedTests: 0, passedTests: 0, failedTests: 0, blockedTests: 0 };

test('growth returns honest empty state and scopes each query to owner', async t => {
  const queries: { sql: string; values: unknown[] }[] = [];
  const pool = { query: async (sql: string, values: unknown[]) => { queries.push({ sql, values }); return { rows: sql.startsWith('WITH') ? [empty] : [] }; } } as unknown as Pool;
  const app = Fastify(); await registerGrowthRoutes(app, store, pool); t.after(() => app.close());
  assert.equal((await app.inject({ url: '/growth' })).statusCode, 401);
  const response = await app.inject({ url: '/growth', headers: auth });
  assert.equal(response.statusCode, 200); assert.deepEqual(response.json().events, []);
  assert.deepEqual(response.json().recommendations, []); assert.equal(response.json().counts.projects, 0);
  assert.equal(queries.length, 2); assert.ok(queries.every(q => q.values[0] === owner && q.sql.includes('owner_id=$1')));
  assert.match(response.json().disclaimer, /不代表编程能力测评/);
});

test('recommendations explain real evidence and do not assume findings are still open', () => {
  const advice = recommendations({ projects: 1, confirmedRequirements: 1, tasks: { total: 2, todo: 0, doing: 1, review: 0, done: 0, blocked: 1 }, codeReviews: 2, syntaxFindings: 3, testCases: 4, testExecutions: { total: 1, passed: 0, failed: 1, blocked: 0 } });
  assert.deepEqual(advice.map(a => a.code), ['blocked_tasks', 'syntax_findings', 'unexecuted_tests', 'failed_tests']);
  assert.match(advice[1].evidence, /不等于未修复/); assert.match(advice[2].evidence, /4 条用例中有 1 条/);
});

test('growth validates requested scope and never derives next actions from historical totals',async t=>{
  let reads=0;const pool={query:async(sql:string)=>{reads++;return {rows:sql.startsWith('WITH')?[{...empty,tasksTotal:1,blocked:1,testCases:1,executedTests:1,failedTests:1}]:[]};}} as unknown as Pool;
  const app=Fastify();await registerGrowthRoutes(app,store,pool);t.after(()=>app.close());
  assert.equal((await app.inject({url:'/growth?scope=invalid',headers:auth})).statusCode,400);assert.equal(reads,0);
  const history=await app.inject({url:'/growth?scope=history',headers:auth});assert.equal(history.statusCode,200);assert.equal(history.json().scope,'history');assert.deepEqual(history.json().recommendations,[]);assert.match(history.json().disclaimer,/不代表当前需求已验证/);
  const current=await app.inject({url:'/growth',headers:auth});assert.equal(current.json().scope,'current');assert.deepEqual(current.json().recommendations.map((row:{code:string})=>row.code),['blocked_tasks','failed_tests']);
});

test('task update checks authentication, validates status and owner, then audits atomically', async t => {
  const queries: { sql: string; values?: unknown[] }[] = [];
  let owned = true; let released = 0;
  const client = { query: async (sql: string, values?: unknown[]) => { queries.push({ sql, values }); return { rows: sql.startsWith('SELECT') && owned ? [{ id: task, projectId: project, title: '任务', status: 'todo', requirementVersionId: 'current', currentRequirementId: 'current' }] : [] }; }, release: () => { released++; } };
  const pool = { connect: async () => client } as unknown as Pool;
  const app = Fastify(); await registerGrowthRoutes(app, store, pool); t.after(() => app.close());
  const url = `/projects/${project}/tasks/${task}`;
  assert.equal((await app.inject({ method: 'PATCH', url, payload: { status: 'done' } })).statusCode, 401);
  assert.equal((await app.inject({ method: 'PATCH', url, headers: auth, payload: { status: 'invalid' } })).statusCode, 400);
  owned = false;
  assert.equal((await app.inject({ method: 'PATCH', url, headers: auth, payload: { status: 'done' } })).statusCode, 404);
  assert.equal(queries.at(-1)?.sql, 'ROLLBACK'); assert.ok(!queries.some(q => q.sql.startsWith('INSERT')));
  owned = true; queries.length = 0;
  const response = await app.inject({ method: 'PATCH', url, headers: auth, payload: { status: 'done' } });
  assert.equal(response.statusCode, 200); assert.equal(response.json().task.status, 'done');
  assert.deepEqual(queries.map(q => q.sql.split(' ')[0]), ['BEGIN', 'SELECT', 'SELECT', 'UPDATE', 'INSERT', 'COMMIT']);
  assert.equal(queries[1].sql,'SELECT id FROM projects WHERE id=$1 AND owner_id=$2 FOR UPDATE');assert.deepEqual(queries[1].values,[project,owner]);
  assert.deepEqual(queries[2].values, [task, project, owner]);
  assert.deepEqual(queries[4].values, [task, project, owner, 'todo', 'done']); assert.equal(released, 2);
});

test('audit failure rolls back task update and missing database returns 503', async t => {
  const writes: string[] = [];
  const client = { query: async (sql: string) => { writes.push(sql); if (sql.startsWith('INSERT')) throw new Error('audit failed'); return { rows: sql.startsWith('SELECT') ? [{ id: task, projectId: project, status: 'todo',requirementVersionId:'current',currentRequirementId:'current' }] : [] }; }, release: () => {} };
  const app = Fastify(); await registerGrowthRoutes(app, store, { connect: async () => client } as unknown as Pool); t.after(() => app.close());
  assert.equal((await app.inject({ method: 'PATCH', url: `/projects/${project}/tasks/${task}`, headers: auth, payload: { status: 'done' } })).statusCode, 503);
  assert.equal(writes.at(-1), 'ROLLBACK'); assert.ok(!writes.includes('COMMIT'));
  const noDb = Fastify(); await registerGrowthRoutes(noDb); t.after(() => noDb.close());
  assert.equal((await noDb.inject({ url: '/growth', headers: auth })).statusCode, 503);
});

test('a task from a historical requirement cannot be changed or add an audit event',async t=>{
  const queries:string[]=[];
  const client={query:async(sql:string)=>{queries.push(sql);return {rows:sql.startsWith('SELECT')?[{id:task,projectId:project,status:'todo',requirementVersionId:'old',currentRequirementId:'new'}]:[]};},release:()=>{}};
  const app=Fastify();await registerGrowthRoutes(app,store,{connect:async()=>client} as unknown as Pool);t.after(()=>app.close());
  const response=await app.inject({method:'PATCH',url:`/projects/${project}/tasks/${task}`,headers:auth,payload:{status:'done'}});
  assert.equal(response.statusCode,409);assert.equal(response.json().error,'task_requirement_outdated');assert.equal(queries.at(-1),'ROLLBACK');assert.ok(!queries.some(sql=>/^(UPDATE|INSERT)/.test(sql)));
});
