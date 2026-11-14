// #520: separate, DEV-only additive migration path. Legacy migrate stays disabled.
// No account provisioning, backfill, GRANT, DROP, or generic migration execution.
// The caller MUST additionally attest the immutable service digest and exact owner
// authorization. Environment checks are defense in depth, not an auth authority.
import { pathToFileURL } from 'node:url';
import { loadMigrations } from '../src/db/migrations.js';
import { closeMigrationPool, getMigrationPool } from '../src/db/pool.js';
import { migrationDatabaseConfig } from '../src/db/config.js';

const TARGET = '011_refresh_requests.sql';
const SHA = /^[0-9a-f]{40}$/;
const fail = code => { throw Object.assign(new Error(code), { code }); };

export function admitRetrieve011(env, buildIdentity) {
  const source = buildIdentity?.sourceSha;
  if (env.APP_ENV !== 'dev' || env.CLOUD_RUN_JOB !== 'jscc-db-migrate-dev' ||
      !SHA.test(source || '') || !SHA.test(env.SOURCE_SHA || '') || source !== env.SOURCE_SHA ||
      buildIdentity.runtimeDataSha !== source) fail('RETRIEVE011_SCOPE_DENIED');
  const mode = env.RETRIEVE011_MODE;
  if (mode === 'inspect') {
    if (env.RETRIEVE011_OWNER_GATE) fail('RETRIEVE011_INSPECT_GATE_UNEXPECTED');
  } else if (mode === 'apply') {
    if (env.RETRIEVE011_OWNER_GATE !== 'APPROVE_RETRIEVE_DEV_NILE_011_' + source) fail('RETRIEVE011_OWNER_GATE_DENIED');
  } else fail('RETRIEVE011_MODE_DENIED');
  return Object.freeze({ mode, source });
}

export function assertRetrieve011Ledger(migrations, rows, objects) {
  const versions = Array.from({length:11},(_,i)=>String(i+1).padStart(3,'0'));
  if (migrations.length !== 11 || migrations.some((m,i)=>m.version !== versions[i]) ||
      migrations.at(-1).name !== TARGET) fail('RETRIEVE011_CANDIDATE_MIGRATIONS_DENIED');
  if (![10,11].includes(rows.length) || rows.some((r,i)=>{
    const expected=migrations[i];
    return String(r.version)!==expected.version || r.name!==expected.name || r.checksum!==expected.checksum;
  })) fail('RETRIEVE011_LEDGER_MISMATCH');
  if (rows.length===10 && (objects.table_present || objects.index_present)) fail('RETRIEVE011_UNTRACKED_OBJECT');
  if (rows.length===11 && (!objects.table_present || !objects.index_present || !objects.tenant_id_ready)) {
    // Return bounded schema evidence, no raw catalog/credentials.
    fail('RETRIEVE011_SCHEMA_DRIFT_'+[objects.table_present,objects.index_present,objects.tenant_id_ready].map(Boolean).map(Number).join(''));
  }
  return rows.length===11 ? 'ALREADY_APPLIED' : 'PENDING_011';
}

async function getState(client, migrations) {
  const rows=(await client.query('SELECT version, name, checksum FROM schema_migrations ORDER BY version')).rows;
  // Native Nile catalog visibility for tenant DDL is reliable in a fresh
  // transaction after commit; use information_schema for the table's shape.
  const objects=(await client.query(`
    SELECT to_regclass('public.refresh_requests') IS NOT NULL AS table_present,
           to_regclass('public.refresh_requests_profile_idx') IS NOT NULL AS index_present,
           EXISTS(SELECT 1 FROM information_schema.columns
                   WHERE table_schema='public' AND table_name='refresh_requests'
                     AND column_name='tenant_id' AND data_type='uuid' AND is_nullable='NO') AS tenant_id_ready
  `)).rows[0];
  // Nile's tenant-aware index may not resolve through to_regclass in the
  // logical catalog. Require affirmative evidence from the table-scoped
  // PostgreSQL index view instead; an empty result is not a PASS.
  if (!objects.index_present) {
    // Bind index evidence to the OID resolved by the actual logical table
    // in this database. Nile may rewrite the public schema to a physical
    // namespace; do not scan or trust same-named indexes in other schemas.
    const indexes=await client.query(`
      SELECT idx.relname AS indexname, pg_get_indexdef(i.indexrelid) AS indexdef
        FROM pg_catalog.pg_index i
        JOIN pg_catalog.pg_class idx ON idx.oid=i.indexrelid
       WHERE i.indrelid=to_regclass('public.refresh_requests')
         AND idx.relname='refresh_requests_profile_idx'
         AND i.indisvalid AND i.indisready
    `);
    objects.index_present=indexes.rows?.some(row =>
      row.indexname==='refresh_requests_profile_idx' &&
      /\(\s*tenant_id\s*,\s*search_profile_id\s*,\s*created_at\s+DESC\s*\)/i.test(String(row.indexdef||''))
    )===true;
  }
  return assertRetrieve011Ledger(migrations,rows,objects);
}

export async function prepareOrApplyRetrieve011({env=process.env,buildIdentity,db,migrations}={}) {
  const admitted=admitRetrieve011(env,buildIdentity);
  migrationDatabaseConfig(env);
  const files=migrations || await loadMigrations();
  const pool=db || getMigrationPool(env);
  const client=await pool.connect();
  let committed=false;
  try {
    await client.query(admitted.mode==='inspect' ? 'BEGIN READ ONLY' : 'BEGIN');
    const actual=(await client.query('SELECT current_database() AS database_name')).rows[0]?.database_name;
    if (actual!=='jobsearch_dev') fail('RETRIEVE011_DATABASE_DENIED');
    if (admitted.mode==='apply') await client.query("SELECT pg_advisory_xact_lock(hashtext('jscc-schema-migrate'))");
    const before=await getState(client,files);
    let after=before;
    let applied=false;
    if (admitted.mode==='apply' && before==='PENDING_011') {
      const migration=files.at(-1);
      await client.query(migration.sql);
      await client.query('INSERT INTO schema_migrations(version, name, checksum) VALUES ($1, $2, $3)',
        [migration.version,migration.name,migration.checksum]);
      applied=true;
    }
    await client.query('COMMIT');
    committed=true;
    if (applied) {
      // DDL and ledger write are atomic. Distributed schema metadata must be
      // checked after commit on Nile; failure here blocks rollout, never DROP.
      after=await getState(client,files);
      if(after!=='ALREADY_APPLIED') fail('RETRIEVE011_POSTCHECK_FAILED');
    }
    return {status:'ok',environment:'dev',source_sha:admitted.source,mode:admitted.mode,
      before,after,applied,migration:TARGET,checksum:files.at(-1).checksum};
  } catch(error) {
    if (!committed) await client.query('ROLLBACK').catch(()=>{});
    throw error;
  } finally { client.release(); }
}

if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {
    const {BUILD_IDENTITY}=await import('../src/build-identity.generated.js');
    const result=await prepareOrApplyRetrieve011({buildIdentity:BUILD_IDENTITY});
    process.stdout.write(JSON.stringify(result)+'\n');
  } catch(error) {
    // Never print raw SQL, database URL, credentials, or provider exception text.
    const code=typeof error?.code==='string' && /^RETRIEVE011_[A-Z_0-9]+$/.test(error.code) ? error.code : 'RETRIEVE011_EXECUTION_FAILED';
    process.stderr.write(code+'\n');
    process.exitCode=86;
  } finally { await closeMigrationPool(); }
}
