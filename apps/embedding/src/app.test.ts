import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmbeddingApp } from './app.js';
import { encodeWindows, manifest, splitWindows, type EmbeddingEngine } from './model.js';

const vector = (dimension = 0) => Array.from({ length: manifest.dimensions }, (_, index) => index === dimension ? 1 : 0);

test('long Unicode input is fully encoded and window vectors are weighted and normalized', async () => {
  const text = '需'.repeat(800) + '🧪'.repeat(100);
  const windows = splitWindows(text);
  assert.equal(windows.join(''), text);
  assert.deepEqual(windows.map(window => Array.from(window).length), [400, 400, 100]);
  const seen: string[] = [];
  const [result] = await encodeWindows([text], async window => { seen.push(window); return vector(window.includes('🧪') ? 1 : 0); });
  assert.equal(seen.join(''), text);
  assert.ok(Math.abs(result[0] / result[1] - 8) < 1e-10);
  assert.ok(Math.abs(Math.hypot(...result) - 1) < 1e-10);
  await assert.rejects(encodeWindows(['text'], async () => [1, 2]), /invalid_model_output/);
  await assert.rejects(encodeWindows(['text'], async () => Array(manifest.dimensions).fill(0)), /invalid_model_output/);
});

test('readiness distinguishes real engine availability from a live HTTP process', async t => {
  let engine: EmbeddingEngine | undefined;
  let failed = false;
  const app = createEmbeddingApp(() => engine, () => failed); t.after(() => app.close());
  assert.equal((await app.inject('/health')).statusCode, 200);
  assert.equal((await app.inject('/ready')).statusCode, 503);
  const loading = await app.inject({ method: 'POST', url: '/v1/embeddings', payload: { model: manifest.id, input: '需求分析' } });
  assert.equal(loading.statusCode, 503);
  failed = true;
  assert.equal((await app.inject('/ready')).json().error, 'model_load_failed');
  failed = false;
  engine = { state: 'ready', embed: async input => input.map(() => vector()) };
  assert.equal((await app.inject('/ready')).statusCode, 200);
});

test('model identity and input limits are checked before inference', async t => {
  let calls = 0;
  const app = createEmbeddingApp(() => ({ state: 'ready', embed: async input => { calls++; return input.map(() => vector()); } }));
  t.after(() => app.close());
  for (const payload of [
    { model: 'other-model', input: 'text' }, { model: manifest.id, input: [] },
    { model: manifest.id, input: [' '] }, { model: manifest.id, input: 'x'.repeat(12_001) },
    { model: manifest.id, input: 'text', endpoint: 'http://example.test' },
  ]) assert.equal((await app.inject({ method: 'POST', url: '/v1/embeddings', payload })).statusCode, 400);
  assert.equal((await app.inject({ method: 'POST', url: '/v1/embeddings', payload: { model: manifest.id, input: ['x'.repeat(12_000), 'x'.repeat(12_000), 'x'.repeat(12_000)] } })).statusCode, 413);
  assert.equal(calls, 0);
  const result = await app.inject({ method: 'POST', url: '/v1/embeddings', payload: { model: manifest.id, input: ['需求', '测试'] } });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.json().data.map((item: { index: number }) => item.index), [0, 1]);
  assert.equal(result.json().data[0].embedding.length, manifest.dimensions);
});

test('concurrent inference is bounded and the slot is released after errors', async t => {
  let release!: () => void; let entered!: () => void;
  const enteredPromise = new Promise<void>(resolve => { entered = resolve; });
  const barrier = new Promise<void>(resolve => { release = resolve; });
  let first = true;
  const app = createEmbeddingApp(() => ({ state: 'ready', embed: async () => {
    if (first) { first = false; entered(); await barrier; throw new Error('private engine details'); }
    return [vector()];
  } }));
  t.after(() => app.close());
  const request = { method: 'POST' as const, url: '/v1/embeddings', payload: { model: manifest.id, input: 'text' } };
  const running = app.inject(request).then(value => value);
  await enteredPromise;
  assert.equal((await app.inject(request)).statusCode, 429);
  release();
  const error = await running;
  assert.equal(error.statusCode, 500);
  assert.equal(error.body.includes('private engine details'), false);
  assert.equal((await app.inject(request)).statusCode, 200);
});
