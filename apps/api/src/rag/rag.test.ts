import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunkPages } from './chunk.js';
import { createEmbeddings } from './embeddings.js';
import { searchKnowledge } from './search.js';

test('chunks retain page and source offsets and overlap without crossing pages', () => {
  const text = '软'.repeat(250);
  const chunks = chunkPages([{ page: 2, text }, { page: 3, text: '下页' }], 100, 20);
  assert.equal(chunks[0].page, 2);
  assert.equal(chunks[1].startOffset, 80);
  for (const chunk of chunks.filter((c) => c.page === 2)) assert.equal(text.slice(chunk.startOffset, chunk.endOffset), chunk.content);
  assert.equal(chunks.at(-1)?.page, 3);
});

test('embedding client validates and orders service response', async () => {
  const send: typeof fetch = async () => new Response(JSON.stringify({ data: [{ index: 1, embedding: [2, 3] }, { index: 0, embedding: [1, 2] }] }), { status: 200 });
  assert.deepEqual(await createEmbeddings(['a', 'b'], { apiKey: 'secret', baseUrl: 'https://example.test/v1', model: 'embed' }, send), [[1, 2], [2, 3]]);
  await assert.rejects(createEmbeddings(['a'], { apiKey: '', baseUrl: '', model: '' }, send), /not configured/);
});

test('vector query includes owner, model and dimensions in parameterized SQL', async () => {
  let params: unknown[] = [];
  await searchKnowledge({ query: async (sql, values) => { assert.match(sql, /d\.owner_id = \$1/); params = values; return { rows: [] }; } }, 'owner', 'model', [1, 2]);
  assert.deepEqual(params, ['owner', 'model', 2, '[1,2]', 0.5, 5]);
  await assert.rejects(searchKnowledge({ query: async () => ({ rows: [] }) }, 'owner', 'model', [0, 0]), /Invalid/);
});
