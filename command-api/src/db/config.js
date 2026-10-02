const DATABASES = Object.freeze({ dev:'jobsearch_dev', test:'jobsearch_test', prod:'jobsearch_prod' });

function configError(message) { return Object.assign(new Error(message), { status:503 }); }

export function expectedDatabase(appEnv) {
  const env = String(appEnv || '').trim().toLowerCase();
  const database = DATABASES[env];
  if (!database) throw configError('APP_ENV must be dev, test or prod for database access');
  return database;
}

function connectionConfig(env, variableName) {
  const appEnv = String(env.APP_ENV || '').trim().toLowerCase();
  const expected = expectedDatabase(appEnv);
  const connectionString = String(env[variableName] || '').trim();
  if (!connectionString) throw configError(`${variableName} is required`);
  let parsed;
  try { parsed = new URL(connectionString); }
  catch { throw configError(`${variableName} is invalid`); }
  if (!['postgres:','postgresql:'].includes(parsed.protocol)) throw configError(`${variableName} must use PostgreSQL`);
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

export function devTestSharedDbRoleAllowed(env = process.env) {
  const appEnv = String(env.APP_ENV || '').trim().toLowerCase();
  const flag = String(env.JSCC_ALLOW_DEV_TEST_SHARED_DB_ROLE || '').trim().toLowerCase();
  return (appEnv === 'dev' || appEnv === 'test') && flag === 'true';
}

export function databaseConfig(env = process.env) {
  return connectionConfig(env, 'NILE_DATABASE_URL');
}

export function migrationDatabaseConfig(env = process.env) {
  const migration = connectionConfig(env, 'NILE_MIGRATION_DATABASE_URL');
  const runtime = String(env.NILE_DATABASE_URL || '').trim();
  if (runtime) {
    const runtimeConfig = connectionConfig(env, 'NILE_DATABASE_URL');
    const migrationUrl = new URL(migration.connectionString);
    const runtimeUrl = new URL(runtimeConfig.connectionString);
    const samePrincipal = decodeURIComponent(migrationUrl.username || '') === decodeURIComponent(runtimeUrl.username || '')
      && migrationUrl.hostname === runtimeUrl.hostname
      && (migrationUrl.port || '5432') === (runtimeUrl.port || '5432')
      && decodeURIComponent(migrationUrl.pathname) === decodeURIComponent(runtimeUrl.pathname);
    if (samePrincipal && !devTestSharedDbRoleAllowed(env)) {
      throw configError('Runtime and migration database roles must be distinct');
    }
  }
  return migration;
}
