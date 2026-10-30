import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from './app.js';
import { loadConfig } from './config.js';

test('health is available and readiness reports missing database', async () => {
  const app = await createApp({ corsOrigin: 'http://localhost:5173' });
  assert.equal((await app.inject('/health')).statusCode, 200);
  const ready = await app.inject('/ready');
  assert.equal(ready.statusCode, 503);
  assert.equal(ready.json().database, 'not_configured');
  await app.close();
});

test('readiness queries database and handles failures', async () => {
  let queried = false;
  const app = await createApp({ corsOrigin: 'http://localhost:5173', database: { query: async (sql) => { queried = sql === 'SELECT 1'; }, end: async () => {} } });
  assert.equal((await app.inject('/ready')).statusCode, 200);
  assert.equal(queried, true);
  await app.close();
  const failed = await createApp({ corsOrigin: 'http://localhost:5173', database: { query: async () => { throw new Error('secret connection detail'); }, end: async () => {} } });
  const response = await failed.inject('/ready');
  assert.equal(response.statusCode, 503);
  assert.equal(response.json().database, 'unavailable');
  assert.ok(!response.body.includes('secret connection detail'));
  await failed.close();
});

test('configuration rejects invalid port and database protocol', () => {
  assert.throws(() => loadConfig({ PORT: '0' }));
  assert.throws(() => loadConfig({ DATABASE_URL: 'https://example.com' }));
});
