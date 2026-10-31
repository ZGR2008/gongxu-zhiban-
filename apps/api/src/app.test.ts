import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { migrationFiles } from './database-readiness.js';

test('health is available and readiness reports missing database', async () => {
  const app = await createApp({ corsOrigin: 'http://localhost:5173' });
  assert.equal((await app.inject('/health')).statusCode, 200);
  const ready = await app.inject('/ready');
  assert.equal(ready.statusCode, 503);
  assert.equal(ready.json().database, 'not_configured');
  await app.close();
});

test('readiness queries database and handles failures', async () => {
  const versions = (await migrationFiles()).map(file => ({ version: file.slice(0, -4) }));
  let queried = 0;
  const app = await createApp({ corsOrigin: 'http://localhost:5173', database: { query: async (sql) => {
    queried++;
    return { rows: sql === 'SELECT version FROM schema_migrations' ? versions : [{ hasMigrations: true, hasVector: true }] };
  }, end: async () => {} } });
  assert.equal((await app.inject('/ready')).statusCode, 200);
  assert.equal(queried, 2);
  await app.close();
  const failed = await createApp({ corsOrigin: 'http://localhost:5173', database: { query: async () => { throw new Error('secret connection detail'); }, end: async () => {} } });
  const response = await failed.inject('/ready');
  assert.equal(response.statusCode, 503);
  assert.equal(response.json().database, 'unavailable');
  assert.ok(!response.body.includes('secret connection detail'));
  await failed.close();
});

test('reachable but unmigrated database is not ready', async () => {
  const app = await createApp({ corsOrigin: 'http://localhost:5173', database: {
    query: async () => ({ rows: [{ hasMigrations: false, hasVector: false }] }), end: async () => {},
  } });
  const response = await app.inject('/ready');
  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.json(), { status: 'not_ready', database: 'connected', schema: 'migration_required', vector: 'missing' });
  await app.close();
});

test('outdated migrations and a missing vector extension each prevent readiness', async () => {
  const versions = (await migrationFiles()).map(file => ({ version: file.slice(0, -4) }));
  for (const scenario of [{ applied: versions.slice(0, -1), vector: true }, { applied: versions, vector: false }]) {
    const app = await createApp({ corsOrigin: 'http://localhost:5173', database: {
      query: async sql => ({ rows: sql === 'SELECT version FROM schema_migrations' ? scenario.applied : [{ hasMigrations: true, hasVector: scenario.vector }] }),
      end: async () => {},
    } });
    const response = await app.inject('/ready');
    assert.equal(response.statusCode, 503);
    assert.equal(response.json().schema, scenario.vector ? 'migration_required' : 'current');
    assert.equal(response.json().vector, scenario.vector ? 'installed' : 'missing');
    await app.close();
  }
});

test('configuration rejects invalid port and database protocol', () => {
  assert.throws(() => loadConfig({ PORT: '0' }));
  assert.throws(() => loadConfig({ DATABASE_URL: 'https://example.com' }));
});
