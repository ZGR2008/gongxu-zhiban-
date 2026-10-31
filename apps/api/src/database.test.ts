import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRuntimeDatabase,runtimeDatabaseLimits} from './database.js';

test('runtime pool bounds connection and query waiting with server cancellation first',async()=>{
 const pool=createRuntimeDatabase('postgresql://localhost/synthetic_no_connection');
 assert.equal(pool.options.connectionTimeoutMillis,3000);assert.equal(pool.options.statement_timeout,15000);assert.equal(pool.options.query_timeout,18000);
 assert.ok(runtimeDatabaseLimits.statement_timeout<runtimeDatabaseLimits.query_timeout);assert.equal(pool.totalCount,0);await pool.end();
});
