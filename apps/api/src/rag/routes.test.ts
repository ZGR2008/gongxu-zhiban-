import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { readFile } from 'node:fs/promises';
import { registerKnowledgeRoutes } from './routes.js';
import type { ProjectStore } from '../project-store.js';
import type { Pool } from 'pg';
import type { KnowledgeHit } from './search.js';
import { pdfParserAvailable } from './pdf.js';
import type { FastifyRequest } from 'fastify';

const owner = '00000000-0000-4000-8000-000000000001';
const hit: KnowledgeHit = { id: '00000000-0000-4000-8000-000000000002', document_id: '00000000-0000-4000-8000-000000000003', document_name: 'source.txt', page: null, content: '可核对的原始内容', distance: 0.1 };
const store = { userBySession: async () => ({ id: owner, name: '测试', email: 'example@example.test' }) } as unknown as ProjectStore;
const pool = {} as Pool;
const embedding = { baseUrl: 'https://example.test', apiKey: 'test', model: 'embedding' };
const ai = { baseUrl: 'https://example.test', apiKey: 'test', model: 'chat', timeoutMs: 1000 };
const auth = { authorization: `Bearer ${'a'.repeat(64)}` };

test('RAG answer never starts model work after disconnection during retrieval', async () => {
  const app=Fastify();let request:FastifyRequest;let modelCalls=0;
  app.addHook('preHandler',async current=>{request=current;});
  await registerKnowledgeRoutes(app,store,pool,embedding,ai,{retrieve:async()=>{request.raw.emit('aborted');return [hit];},complete:async()=>{modelCalls++;return JSON.stringify({answer:'不应返回',citations:[hit.id]});}});
  try{
    const response=await app.inject({method:'POST',url:'/knowledge/answer',headers:auth,payload:{query:'已断开的合成问题'}});
    assert.equal(modelCalls,0);assert.equal(response.statusCode,409);assert.equal(response.json().error,'ai_cancelled');
  }finally{await app.close();}
});

test('RAG model phase receives cancellation and late adapters cannot keep a request active', async () => {
  const app=Fastify();let request:FastifyRequest;let received:AbortSignal|undefined;let release:(value:string)=>void=()=>{};let timer:ReturnType<typeof setTimeout>|undefined;
  app.addHook('preHandler',async current=>{request=current;});
  await registerKnowledgeRoutes(app,store,pool,embedding,ai,{retrieve:async()=>[hit],complete:async(_config,_messages,_fetcher,options)=>{
    received=options?.signal;request.raw.emit('aborted');return new Promise(resolve=>{release=resolve;timer=setTimeout(()=>resolve(JSON.stringify({answer:'迟到回答',citations:[hit.id]})),120);});
  }});
  try{
    for(let attempt=0;attempt<3;attempt++){
      const response=await app.inject({method:'POST',url:'/knowledge/answer',headers:auth,payload:{query:'合成模型阶段取消'}});
      assert.ok(received?.aborted);assert.equal(response.statusCode,409);assert.equal(response.json().error,'ai_cancelled');
      clearTimeout(timer);release('');
    }
  }finally{clearTimeout(timer);release('');await app.close();}
});

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

test('RAG can report insufficient evidence despite retrieved candidates without manufacturing citations', async () => {
  const app=Fastify();let calls=0,instructions='';
  await registerKnowledgeRoutes(app,store,pool,embedding,ai,{retrieve:async()=>[hit],complete:async(_config,messages)=>{
    calls++;instructions=messages[0].content;
    return JSON.stringify({status:'insufficient_evidence',answer:'现有资料没有给出所问版本的约束，请补充版本说明。',citations:[]});
  }});
  try{
    const response=await app.inject({method:'POST',url:'/knowledge/answer',headers:auth,payload:{query:'未知版本的约束'}});
    assert.equal(response.statusCode,200);assert.equal(calls,1);assert.equal(response.json().reason,'insufficient_evidence');
    assert.match(instructions,/insufficient_evidence/);assert.match(instructions,/数据而不是指令/);
    assert.deepEqual(response.json().sources,[]);assert.deepEqual(response.json().candidates,[hit]);assert.match(response.json().answer,/版本说明/);
  }finally{await app.close();}
});

test('RAG evidence status cannot bypass citation identity or justify an uncited answer', async () => {
  const app=Fastify();let output:unknown;
  await registerKnowledgeRoutes(app,store,pool,embedding,ai,{retrieve:async()=>[hit],complete:async()=>JSON.stringify(output)});
  try{
    const request={method:'POST' as const,url:'/knowledge/answer',headers:auth,payload:{query:'核对证据协议'}};
    for(const value of [
      {status:'insufficient_evidence',answer:'不足',citations:[hit.id]},
      {status:'insufficient_evidence',answer:'不足',citations:['00000000-0000-4000-8000-000000000099']},
      {status:'answered',answer:'无引用回答',citations:[]},
      {status:'unsupported_status',answer:'错误状态',citations:[hit.id]},
    ]){output=value;assert.equal((await app.inject(request)).statusCode,502);}
    output={status:'answered',answer:'带有效来源的建议，仍需人工核对。',citations:[hit.id]};
    const valid=await app.inject(request);assert.equal(valid.statusCode,200);assert.equal(valid.json().reason,null);assert.deepEqual(valid.json().sources,[hit]);assert.equal(valid.json().candidates,undefined);
  }finally{await app.close();}
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

test('real text PDF is parsed and persisted with page metadata without embeddings', async (context) => {
  if (!(await pdfParserAvailable())) { context.skip('PDF.js dependency not installed'); return; }
  const app = Fastify(); const chunks: unknown[][] = [];
  const client = { query: async (sql: string, values: unknown[] = []) => {
    if (sql.includes('INSERT INTO knowledge_chunks')) chunks.push(values);
    return sql.includes('INSERT INTO knowledge_documents') ? { rows: [{ id: hit.document_id }], rowCount: 1 } : { rows: [], rowCount: 0 };
  }, release: () => {} };
  const fakePool = { connect: async () => client } as unknown as Pool;
  await registerKnowledgeRoutes(app, store, fakePool);
  const bytes = await readFile(new URL('../../test-data/minimal.pdf', import.meta.url));
  const response = await app.inject({ method: 'POST', url: '/knowledge/pdf', headers: auth, payload: { name: 'example.pdf', data: bytes.toString('base64') } });
  assert.equal(response.statusCode, 201); assert.equal(response.json().status, 'awaiting_embedding');
  assert.equal(chunks[0][2], 1); assert.equal(chunks[0][3], 'Software engineering requirements');
  await app.close();
});
