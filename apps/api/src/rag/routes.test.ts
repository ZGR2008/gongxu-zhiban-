import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registerKnowledgeRoutes } from './routes.js';
import type { ProjectStore } from '../project-store.js';
import type { Pool } from 'pg';
import type { KnowledgeHit } from './search.js';

const owner = '00000000-0000-4000-8000-000000000001';
const hit: KnowledgeHit = { id: '00000000-0000-4000-8000-000000000002', document_id: '00000000-0000-4000-8000-000000000003', document_name: 'source.txt', page: null, content: '可核对的原始内容', distance: 0.1 };
const store = { userBySession: async () => ({ id: owner, name: '测试', email: 'example@example.test' }) } as unknown as ProjectStore;
const pool = {} as Pool;
const embedding = { baseUrl: 'https://example.test', apiKey: 'test', model: 'embedding' };
const ai = { baseUrl: 'https://example.test', apiKey: 'test', model: 'chat', timeoutMs: 1000 };
const auth = { authorization: `Bearer ${'a'.repeat(64)}` };

test('RAG answer refuses unsupported citations and returns only actual retrieved sources', async () => {
  const app = Fastify();
  let answer = JSON.stringify({ answer: '回答', citations: ['00000000-0000-4000-8000-000000000099'] });
  await registerKnowledgeRoutes(app, store, pool, embedding, ai, { retrieve: async (_pool, userId) => { assert.equal(userId, owner); return [hit]; }, complete: async () => answer });
  const options = { method: 'POST' as const, url: '/knowledge/answer', headers: auth, payload: { query: '问题' } };
  assert.equal((await app.inject(options)).statusCode, 502);
  answer = JSON.stringify({ answer: '回答', citations: [hit.id] });
  const ok = await app.inject(options);
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.json().sources[0].id, hit.id);
  await app.close();
});

test('RAG answer does not call model when no evidence is retrieved', async () => {
  const app = Fastify(); let called = false;
  await registerKnowledgeRoutes(app, store, pool, embedding, ai, { retrieve: async () => [], complete: async () => { called = true; return ''; } });
  const response = await app.inject({ method: 'POST', url: '/knowledge/answer', headers: auth, payload: { query: '无来源的问题' } });
  assert.equal(response.statusCode, 200); assert.equal(response.json().reason, 'no_evidence'); assert.equal(called, false);
  await app.close();
});

test('document text and chunks can be stored before embeddings are configured', async () => {
  const app = Fastify(); const calls: string[] = [];
  const client = { query: async (sql: string) => { calls.push(sql); return sql.includes('INSERT INTO knowledge_documents') ? { rows: [{ id: hit.document_id }], rowCount: 1 } : { rows: [], rowCount: 0 }; }, release: () => {} };
  const fakePool = { connect: async () => client } as unknown as Pool;
  await registerKnowledgeRoutes(app, store, fakePool);
  const saved = await app.inject({ method: 'POST', url: '/knowledge/text', headers: auth, payload: { name: 'source.txt', text: '这是已经保存的真实文档内容。' } });
  assert.equal(saved.statusCode, 201);
  assert.equal(saved.json().status, 'awaiting_embedding');
  assert.ok(calls.some((sql) => sql.includes('INSERT INTO knowledge_chunks')));
  const index = await app.inject({ method: 'POST', url: `/knowledge/${hit.document_id}/index`, headers: auth });
  assert.equal(index.statusCode, 503);
  assert.equal(index.json().error, 'embedding_not_configured');
  await app.close();
});
