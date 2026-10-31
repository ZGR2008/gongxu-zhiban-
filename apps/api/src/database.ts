import pg from 'pg';

/** Server-side statement cancellation precedes the client wait bound. Migration
 * sessions use their own pool because schema work can legitimately take longer. */
export const runtimeDatabaseLimits={connectionTimeoutMillis:3000,statement_timeout:15000,query_timeout:18000} as const;
export function createRuntimeDatabase(connectionString:string){
  return new pg.Pool({connectionString,...runtimeDatabaseLimits});
}
