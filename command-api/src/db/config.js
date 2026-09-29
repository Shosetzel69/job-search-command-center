const DATABASES = Object.freeze({ dev:'jobsearch_dev', test:'jobsearch_test', prod:'jobsearch_prod' });

function configError(message) { return Object.assign(new Error(message), { status:503 }); }

export function expectedDatabase(appEnv) {
  const env = String(appEnv || '').trim().toLowerCase();
  const database = DATABASES[env];
  if (!database) throw configError('APP_ENV must be dev, test or prod for database access');
  return database;
}

export function databaseConfig(env = process.env) {
  const appEnv = String(env.APP_ENV || '').trim().toLowerCase();
  const expected = expectedDatabase(appEnv);
  const connectionString = String(env.NILE_DATABASE_URL || '').trim();
  if (!connectionString) throw configError('NILE_DATABASE_URL is required');
  let parsed;
  try { parsed = new URL(connectionString); }
  catch { throw configError('NILE_DATABASE_URL is invalid'); }
  if (!['postgres:','postgresql:'].includes(parsed.protocol)) throw configError('NILE_DATABASE_URL must use PostgreSQL');
  const actual = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (actual !== expected) throw configError(`Database binding mismatch: expected ${expected}`);
  return Object.freeze({
    appEnv,
    expectedDatabase:expected,
    connectionString,
    poolMax:Number(env.DB_POOL_MAX || 2),
    connectionTimeoutMillis:Number(env.DB_CONNECTION_TIMEOUT_MS || 10000),
    idleTimeoutMillis:Number(env.DB_IDLE_TIMEOUT_MS || 30000),
  });
}
