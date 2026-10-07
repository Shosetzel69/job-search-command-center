import { getMigrationPool, closeMigrationPool } from '../src/db/pool.js';
import { databaseConfig, devTestSharedDbRoleAllowed } from '../src/db/config.js';

const TABLES = Object.freeze([
  'tenants','app_user','user_identity','profile','user_session','candidate_profile',
  'search_profile','search_profile_preferences','profile_preferences','profile_job_state','profile_job_evaluation','applications','profile_notes',
  'profile_ui_preferences','collection_policy','system_bootstrap',
  'account_capacity_policy','account_deletion_audit','canonical_jobs',
  'source_postings','search_runs','source_run_results','coverage_scope_state','scheduler_config','scheduler_state',
]);

function roleFromRuntimeUrl(env) {
  const config = databaseConfig(env);
  const parsed = new URL(config.connectionString);
  const role = decodeURIComponent(parsed.username || '').trim();
  if (!role) throw new Error('Runtime database role is missing from NILE_DATABASE_URL');
  return role;
}

export async function provisionRuntimeRole(env = process.env, { db } = {}) {
  const runtimeRole = roleFromRuntimeUrl(env);
  if (devTestSharedDbRoleAllowed(env)) {
    return {
      status:'skipped',
      mode:'dev_test_shared_role_exception',
      runtime_role:runtimeRole,
      tables:TABLES.length,
    };
  }

  const migrationDb = db || getMigrationPool(env);
  const roleResult = await migrationDb.query(
    'SELECT quote_ident($1) AS ident, EXISTS(SELECT 1 FROM pg_roles WHERE rolname=$1) AS exists',
    [runtimeRole],
  );
  if (!roleResult.rows?.[0]?.exists) throw new Error('Runtime database role does not exist');
  const roleIdent = roleResult.rows[0].ident;

  const databaseResult = await migrationDb.query('SELECT quote_ident(current_database()) AS ident');
  const databaseIdent = databaseResult.rows?.[0]?.ident;
  if (!databaseIdent) throw new Error('Database identity could not be resolved');

  await migrationDb.query(`REVOKE CREATE ON SCHEMA public FROM ${roleIdent}`);
  await migrationDb.query(`REVOKE CREATE ON DATABASE ${databaseIdent} FROM ${roleIdent}`);
  await migrationDb.query(`REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM ${roleIdent}`);
  await migrationDb.query(`REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM ${roleIdent}`);
  await migrationDb.query(`GRANT USAGE ON SCHEMA public TO ${roleIdent}`);

  const tables = TABLES.map(name => `public."${name}"`).join(', ');
  await migrationDb.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ${tables} TO ${roleIdent}`);

  return { status:'ok', mode:'strict', runtime_role:runtimeRole, tables:TABLES.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    process.stdout.write(`${JSON.stringify(await provisionRuntimeRole())}\n`);
  } finally {
    await closeMigrationPool();
  }
}