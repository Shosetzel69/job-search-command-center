import pg from 'pg';
import { databaseConfig } from './config.js';

const { Pool } = pg;
let pool;

export function createPool(env = process.env) {
  const config = databaseConfig(env);
  return new Pool({
    connectionString:config.connectionString,
    max:config.poolMax,
    connectionTimeoutMillis:config.connectionTimeoutMillis,
    idleTimeoutMillis:config.idleTimeoutMillis,
    allowExitOnIdle:true,
  });
}

export function getPool(env = process.env) {
  if (!pool) pool = createPool(env);
  return pool;
}

export async function closePool() {
  if (!pool) return;
  const current = pool;
  pool = undefined;
  await current.end();
}

export async function withTransaction(fn, { env = process.env, db = getPool(env) } = {}) {
  if (typeof fn !== 'function') throw new TypeError('transaction callback is required');
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await fn({ query:(text, params=[]) => client.query(text, params) });
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
