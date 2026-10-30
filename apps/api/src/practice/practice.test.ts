import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import type { Pool } from 'pg';
import type { ProjectStore } from '../project-store.js';
import { checkSyntax, parseGeneratedCases } from './validation.js';
import { registerPracticeRoutes } from './routes.js';

const project = 'f121f4c1-2ec0-4d1f-8d9c-38a761d788be';
const requirement = 'd3d80f1c-5c71-4f7d-b3a6-cd8af99c3e9d';
const auth = { authorization: `Bearer ${'a'.repeat(64)}` };
const ai = { baseUrl: 'https://example.invalid', apiKey: 'test', model: 'test', timeoutMs: 1000 };
const store = { userBySession: async () => ({ id: 'user' }), getProject: async () => ({ id: project }),
  listRequirements: async () => [{ id: requirement, status: 'confirmed', version: 1, content: '项目需求' }] } as unknown as ProjectStore;

test('in-memory syntax checking detects malformed code but never executes input', () => {
  (globalThis as Record<string, unknown>).__practiceExecuted = false;
  const valid = checkSyntax('globalThis.__practiceExecuted = true;\nconst x: number = 1;', 'typescript');
  assert.equal(valid.length, 0);
  assert.equal((globalThis as Record<string, unknown>).__practiceExecuted, false);
  const findings = checkSyntax('const value = ;', 'javascript');
  assert.ok(findings.length > 0); assert.equal(findings[0].line, 1); assert.ok(findings[0].code > 0);
  delete (globalThis as Record<string, unknown>).__practiceExecuted;
});
test('rejects malformed or incomplete model output instead of manufacturing cases', () => {
  assert.equal(parseGeneratedCases('not json'), null);
  assert.equal(parseGeneratedCases(JSON.stringify({ cases: [{ category: 'normal', title: 'x', preconditions: '', steps: 'x', expected: 'x' }] })), null);
  const cases = ['normal', 'boundary', 'exception'].map(category => ({ category, title: 'x', preconditions: '', steps: 'x', expected: 'x' }));
  assert.equal(parseGeneratedCases(JSON.stringify({ cases }))?.length, 3);
});
test('review requires project access and keeps syntax findings distinct from model advice', async t => {
  const writes: unknown[][] = [];
  const pool = { query: async (_sql: string, values: unknown[]) => { writes.push(values); return { rows: [{ syntaxFindings: JSON.parse(values[3] as string), aiAdvice: values[4] }] }; } } as unknown as Pool;
  let calls = 0; const app = Fastify();
  await registerPracticeRoutes(app, store, pool, ai, { complete: async () => { calls++; return '未经验证的建议'; } }); t.after(() => app.close());
  const url = `/projects/${project}/code-reviews`;
  assert.equal((await app.inject({ method: 'POST', url, payload: { language: 'javascript', code: 'const x = ;' } })).statusCode, 401);
  const response = await app.inject({ method: 'POST', url, headers: auth, payload: { language: 'javascript', code: 'const x = ;' } });
  assert.equal(response.statusCode, 201); assert.equal(calls, 1); assert.equal(writes.length, 1);
  assert.ok(response.json().review.syntaxFindings.length); assert.equal(response.json().aiStatus, 'unverified');
});
test('test generation requires confirmed requirements and does not persist invalid output', async t => {
  let calls = 0; let writes = 0;
  const pool = { query: async () => { writes++; return { rows: [] }; } } as unknown as Pool;
  const app = Fastify(); await registerPracticeRoutes(app, store, pool, ai, { complete: async () => { calls++; return '{}'; } }); t.after(() => app.close());
  const url = `/projects/${project}/test-cases`;
  const wrong = await app.inject({ method: 'POST', url, headers: auth, payload: { requirementId: project } });
  assert.equal(wrong.statusCode, 409); assert.equal(calls, 0);
  const bad = await app.inject({ method: 'POST', url, headers: auth, payload: { requirementId: requirement } });
  assert.equal(bad.statusCode, 422); assert.equal(writes, 0);
});
test('project ownership is checked before reading stored reviews', async t => {
  let queries = 0;
  const pool = { query: async () => { queries++; return { rows: [] }; } } as unknown as Pool;
  const otherUser = { ...store, getProject: async () => null } as ProjectStore;
  const app = Fastify(); await registerPracticeRoutes(app, otherUser, pool, ai); t.after(() => app.close());
  const response = await app.inject({ method: 'GET', url: `/projects/${project}/code-reviews`, headers: auth });
  assert.equal(response.statusCode, 404); assert.equal(queries, 0);
});
test('generated cases persist together, with unexecuted status left to the database default', async t => {
  const writes: { sql: string; values?: unknown[] }[] = [];
  const client = { query: async (sql: string, values?: unknown[]) => { writes.push({ sql, values }); return { rows: sql.startsWith('INSERT') ? [{ result: 'not_run' }] : [] }; }, release: () => {} };
  const pool = { connect: async () => client } as unknown as Pool;
  const payload = { cases: ['normal', 'boundary', 'exception'].map(category => ({ category, title: '示例', preconditions: '', steps: '输入', expected: '输出' })) };
  const app = Fastify(); await registerPracticeRoutes(app, store, pool, ai, { complete: async () => JSON.stringify(payload) }); t.after(() => app.close());
  const response = await app.inject({ method: 'POST', url: `/projects/${project}/test-cases`, headers: auth, payload: { requirementId: requirement } });
  assert.equal(response.statusCode, 201); assert.equal(response.json().cases.length, 3);
  assert.equal(writes[0].sql, 'BEGIN'); assert.equal(writes.at(-1)?.sql, 'COMMIT');
  assert.equal(writes.filter(item => item.sql.startsWith('INSERT')).length, 3);
  assert.ok(writes.filter(item => item.sql.startsWith('INSERT')).every(item => item.values?.[1] === requirement && !item.sql.split('VALUES')[0].includes('result')));
});
