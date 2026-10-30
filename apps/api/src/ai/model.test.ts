import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { AiError, aiErrorStatus, completeChat, loadAiConfig } from './model.js';
import { registerAiRoutes } from './routes.js';
import type { ProjectStore } from '../project-store.js';
import type { Pool } from 'pg';
import { PgAiGenerationStore } from './store.js';

const config = { baseUrl: 'https://example.test/v1', apiKey: 'test-secret', model: 'test-model', timeoutMs: 1000 };
const projectId = 'f121f4c1-2ec0-4d1f-8d9c-38a761d788be';
const auth = { authorization: `Bearer ${'a'.repeat(64)}` };

test('AI config is explicit and validates complete configuration', () => {
  assert.equal(loadAiConfig({}), undefined);
  assert.throws(() => loadAiConfig({ AI_MODEL: 'x' }), /configured together/);
  assert.throws(() => loadAiConfig({ AI_MODEL: 'x', AI_API_KEY: 'x', AI_BASE_URL: 'file:///etc' }), /HTTP/);
  assert.equal(loadAiConfig({ AI_MODEL: 'm', AI_API_KEY: 'k', AI_BASE_URL: 'https://example.test/v1/' })?.baseUrl, 'https://example.test/v1');
});

test('chat sends configured model and accepts only a genuine valid response', async () => {
  let seenUrl = ''; let seenAuth = ''; let seenBody = '';
  const fake: typeof fetch = async (input, init) => {
    seenUrl = String(input); seenAuth = String((init?.headers as Record<string, string>).Authorization); seenBody = String(init?.body);
    return new Response(JSON.stringify({ choices: [{ message: { content: '真实响应草稿' } }] }), { status: 200 });
  };
  const result = await completeChat(config, [{ role: 'user', content: '问题' }], fake);
  assert.equal(result, '真实响应草稿'); assert.equal(seenUrl, 'https://example.test/v1/chat/completions');
  assert.equal(seenAuth, 'Bearer test-secret'); assert.equal(JSON.parse(seenBody).model, 'test-model');
  await assert.rejects(completeChat(config, [], async () => new Response('{}')), (e: unknown) => e instanceof AiError && e.code === 'ai_provider_error');
  await assert.rejects(completeChat(undefined, []), (e: unknown) => e instanceof AiError && e.code === 'ai_not_configured');
});

test('timeout is surfaced without pretending a result', async () => {
  const fake: typeof fetch = (_input, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
  });
  await assert.rejects(completeChat({ ...config, timeoutMs: 5 }, [], fake), (e: unknown) => e instanceof AiError && e.code === 'ai_timeout');
});

test('provider failures are classified without exposing response bodies, secrets, or URLs', async () => {
  for (const [status, code, httpStatus] of [
    [401, 'ai_auth_error', 502], [403, 'ai_auth_error', 502],
    [402, 'ai_insufficient_balance', 502], [429, 'ai_rate_limited', 429],
    [500, 'ai_provider_error', 502],
  ] as const) {
    const sensitive = `provider error ${config.apiKey} ${config.baseUrl}`;
    await assert.rejects(completeChat(config, [], async () => new Response(sensitive, { status })), (error: unknown) => {
      assert.ok(error instanceof AiError);
      assert.equal(error.code, code);
      assert.equal(aiErrorStatus(error.code), httpStatus);
      assert.equal(error.message, code);
      assert.equal(JSON.stringify(error).includes(sensitive), false);
      return true;
    });
  }
  await assert.rejects(completeChat(config, [], async () => { throw new Error(`network error ${config.apiKey} ${config.baseUrl}`); }),
    (error: unknown) => error instanceof AiError && error.code === 'ai_provider_error' && error.message === 'ai_provider_error');
  assert.equal(aiErrorStatus('ai_not_configured'), 503);
  assert.equal(aiErrorStatus('ai_timeout'), 504);
});

test('analysis requires authorization and ownership, and persists successful response as draft', async (t) => {
  const saved: string[] = [];
  const store = {
    userBySession: async () => ({ id: 'user1', name: 'user', email: 'u@example.test' }),
    getProject: async (_uid: string, id: string) => id === projectId ? { id, name: '项目', description: '描述' } : null,
    createRequirement: async (_uid: string, id: string, content: string) => { saved.push(content); return { id: 'r1', projectId: id, version: 1, content, status: 'draft' }; },
  } as unknown as ProjectStore;
  const generationStore = { createRequirementAnalysis: async (_uid: string, id: string, content: string, model: string, summary: string) => {
    assert.equal(model, 'test-model'); assert.equal(summary, '校园项目'); saved.push(content);
    return { id: 'r1', projectId: id, version: 1, content, status: 'draft' as const, createdAt: new Date(), confirmedAt: null };
  }, listGenerations: async () => [] };
  const app = Fastify(); await registerAiRoutes(app, store, config, generationStore); t.after(() => app.close());
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: '需求草稿' } }] }));
  t.after(() => { globalThis.fetch = originalFetch; });
  const path = `/projects/${projectId}/requirements/analyze`;
  assert.equal((await app.inject({ method: 'POST', url: path, payload: { idea: '校园项目' } })).statusCode, 401);
  assert.equal((await app.inject({ method: 'POST', url: path, headers: auth, payload: { idea: '' } })).statusCode, 400);
  assert.equal((await app.inject({ method: 'POST', url: '/projects/befb5442-8de2-4b6e-bd1f-58ea8feff682/requirements/analyze', headers: auth, payload: { idea: '项目' } })).statusCode, 404);
  const response = await app.inject({ method: 'POST', url: path, headers: auth, payload: { idea: '校园项目' } });
  assert.equal(response.statusCode, 201); assert.equal(response.json().requirement.status, 'draft'); assert.deepEqual(saved, ['需求草稿']);
  const status = await app.inject({ method: 'GET', url: '/ai/status', headers: auth });
  assert.equal(status.json().configured, true); assert.equal(status.body.includes('test-secret'), false);
  const records = await app.inject({ method: 'GET', url: `/projects/${projectId}/ai-generations`, headers: auth });
  assert.deepEqual(records.json(), { generations: [] });
  assert.equal((await app.inject({ method: 'GET', url: `/projects/${projectId}/ai-generations` })).statusCode, 401);
  globalThis.fetch = async () => new Response('provider failure', { status: 500 });
  const failed = await app.inject({ method: 'POST', url: path, headers: auth, payload: { idea: '校园项目' } });
  assert.equal(failed.statusCode, 502); assert.equal(failed.body.includes('provider failure'), false);
  for (const [providerStatus, expectedStatus, code] of [[401, 502, 'ai_auth_error'], [402, 502, 'ai_insufficient_balance'], [429, 429, 'ai_rate_limited']] as const) {
    globalThis.fetch = async () => new Response('sensitive provider response', { status: providerStatus });
    const result = await app.inject({ method: 'POST', url: path, headers: auth, payload: { idea: '校园项目' } });
    assert.equal(result.statusCode, expectedStatus);
    assert.deepEqual(result.json(), { error: code });
    assert.equal(result.body.includes('sensitive provider response'), false);
  }
  assert.deepEqual(saved, ['需求草稿']);
});

test('unconfigured AI never creates a requirement', async (t) => {
  let saved = false;
  const store = { userBySession: async () => ({ id: 'u' }), getProject: async () => ({ id: projectId }), createRequirement: async () => { saved = true; } } as unknown as ProjectStore;
  const app = Fastify(); await registerAiRoutes(app, store); t.after(() => app.close());
  const response = await app.inject({ method: 'POST', url: `/projects/${projectId}/requirements/analyze`, headers: auth, payload: { idea: '项目' } });
  assert.equal(response.statusCode, 503); assert.equal(response.json().error, 'ai_not_configured'); assert.equal(saved, false);
});

test('requirement and generation record use one transaction and roll back on failure', async () => {
  const queries: string[] = [];
  const client = {
    query: async (sql: string) => {
      queries.push(sql);
      if (sql.startsWith('SELECT id FROM projects')) return { rowCount: 1, rows: [{ id: projectId }] };
      if (sql.includes('INSERT INTO requirement_versions')) return { rows: [{ id: 'requirement-1' }] };
      if (sql.includes('INSERT INTO ai_generations')) throw new Error('database failure');
      return { rows: [] };
    },
    release: () => { queries.push('RELEASE'); },
  };
  const store = new PgAiGenerationStore({ connect: async () => client } as unknown as Pool);
  await assert.rejects(store.createRequirementAnalysis('u', projectId, 'draft', 'model', 'idea'));
  assert.equal(queries.some((q) => q === 'COMMIT'), false);
  assert.deepEqual(queries.slice(-2), ['ROLLBACK', 'RELEASE']);
});
