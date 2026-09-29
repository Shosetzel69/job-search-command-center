import { databaseConfig } from './config.js';
import { getPool } from './pool.js';

export async function databaseReadiness(env = process.env, { db = getPool(env) } = {}) {
  const config = databaseConfig(env);
  const result = await db.query(`
    SELECT current_database() AS database_name,
           current_setting('server_version') AS server_version
  `);
  const row = result.rows?.[0] || {};
  if (row.database_name !== config.expectedDatabase) {
    throw Object.assign(new Error('Connected database does not match environment binding'), { status:503 });
  }
  return Object.freeze({
    status:'ok',
    environment:config.appEnv,
    database:row.database_name,
    server_version:row.server_version,
  });
}
