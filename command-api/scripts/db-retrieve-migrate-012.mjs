// #520: separate, DEV-only additive migration path. Legacy migrate stays disabled.
// No account provisioning, backfill, GRANT, DROP, or generic migration execution.
// The caller MUST additionally attest the immutable service digest and exact owner
// authorization. Environment checks are defense in depth, not an auth authority.
import { pathToFileURL } from 'node:url';
import { loadMigrations } from '../src/db/migrations.js';
import { closeMigrationPool, getMigrationPool } from '../src/db/pool.js';
import { migrationDatabaseConfig } from '../src/db/config.js';

const TARGET = '012_refresh_requests.sql';
const SHA = /^[0-9a-f]{40}$/;
const fail = code => { throw Object.assign(new Error(code), { code }); };

export function admitRetrieve012(env, buildIdentity) {
  const source = buildIdentity?.sourceSha;
  if (env.APP_ENV !== 'dev' || env.CLOUD_RUN_JOB !== 'jscc-db-migrate-dev' ||
      !SHA.test(source || '') || !SHA.test(env.SOURCE_SHA || '') || source !== env.SOURCE_SHA ||
      buildIdentity.runtimeDataSha !== source) fail('RETRIEVE012_SCOPE_DENIED');
  const mode = env.RETRIEVE012_MODE;
  if (mode === 'inspect') {
    if (env.RETRIEVE012_OWNER_GATE) fail('RETRIEVE012_INSPECT_GATE_UNEXPECTED');
  } else if (mode === 'apply') {
    if (env.RETRIEVE012_OWNER_GATE !== 'APPROVE_RETRIEVE_DEV_NILE_012_' + source) fail('RETRIEVE012_OWNER_GATE_DENIED');
  } else fail('RETRIEVE012_MODE_DENIED');
  return Object.freeze({ mode, source });
}

export function assertRetrieve012Ledger(migrations, rows, objects) {
  const versions = Array.from({length:12},(_,i)=>String(i+1).padStart(3,'0'));
  if (migrations.length !== 12 || migrations.some((m,i)=>m.version !== versions[i]) ||
      migrations.at(-1).name !== TARGET) fail('RETRIEVE012_CANDIDATE_MIGRATIONS_DENIED');
  if (migrations[10].name !== '011_profile_job_count_snapshots.sql' ||
      migrations[10].checksum !== 'c6cb6ac52c9a717a5dc452b38fb0874be51896190dc24beab01babfafe623f0e') fail('RETRIEVE012_HISTORICAL_011_MISMATCH');
  if (![11,12].includes(rows.length) || rows.some((r,i)=>{
    const expected=migrations[i];
    return String(r.version)!==expected.version || r.name!==expected.name || r.checksum!==expected.checksum;
  })) fail('RETRIEVE012_LEDGER_MISMATCH');
  if (rows.length===11 && (objects.table_present || objects.index_present)) fail('RETRIEVE012_UNTRACKED_OBJECT');
  if (rows.length===12 && (!objects.table_present || !objects.index_present || !objects.tenant_id_ready)) {
    // Return bounded schema evidence, no raw catalog/credentials.
    fail('RETRIEVE012_SCHEMA_DRIFT_'+[objects.table_present,objects.index_present,objects.tenant_id_ready].map(Boolean).map(Number).join(''));
  }
  return rows.length===12 ? 'ALREADY_APPLIED' : 'PENDING_012';
}

async function getState(client, migrations) {
  const rows=(await client.query('SELECT version, name, checksum FROM schema_migrations ORDER BY version')).rows;
  // Native Nile catalog visibility for tenant DDL is reliable in a fresh
  // transaction after commit; use information_schema for the table's shape.
  // Managed Nile cancels mixed logical-catalog subqueries (SQLSTATE 57014).
  // Keep each check separate; never infer an affirmative result from a timeout.
  const objects={
    table_present:(await client.query("SELECT to_regclass('public.refresh_requests') IS NOT NULL AS table_present")).rows[0]?.table_present===true,
    index_present:(await client.query("SELECT to_regclass('public.refresh_requests_profile_idx') IS NOT NULL AS index_present")).rows[0]?.index_present===true,
    tenant_id_ready:(await client.query(`
      SELECT count(*)::int AS column_count FROM information_schema.columns
       WHERE table_schema='public' AND table_name='refresh_requests'
         AND column_name='tenant_id' AND data_type='uuid' AND is_nullable='NO'
    `)).rows[0]?.column_count===1,
  };
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
  const state=assertRetrieve012Ledger(migrations,rows,objects);
  const historicalTable=(await client.query("SELECT to_regclass('public.profile_job_count_snapshots') IS NOT NULL AS table_present")).rows[0]?.table_present===true;
  const historicalColumns=Number((await client.query(`
    SELECT count(*)::int AS column_count FROM information_schema.columns
     WHERE table_schema='public' AND table_name='profile_job_count_snapshots'
       AND column_name IN ('tenant_id','search_profile_id','scope_key','profile_version','fit_algorithm_version','totals','evaluated_at')
  `)).rows[0]?.column_count);
  const historicalIndexes=await client.query(`
    SELECT idx.relname AS indexname, pg_get_indexdef(i.indexrelid) AS indexdef
      FROM pg_catalog.pg_index i
      JOIN pg_catalog.pg_class idx ON idx.oid=i.indexrelid
     WHERE i.indrelid=to_regclass('public.profile_job_count_snapshots')
       AND idx.relname='profile_job_count_snapshots_version_idx'
       AND i.indisvalid AND i.indisready
  `);
  const historicalIndex=historicalIndexes.rows?.some(row =>
    row.indexname==='profile_job_count_snapshots_version_idx' &&
    /\(\s*tenant_id\s*,\s*search_profile_id\s*,\s*profile_version\s*\)/i.test(String(row.indexdef||''))
  )===true;
  if (!historicalTable || historicalColumns!==7 || !historicalIndex)
    fail('RETRIEVE012_HISTORICAL_011_SCHEMA_DRIFT');
  return state;
}

export async function prepareOrApplyRetrieve012({env=process.env,buildIdentity,db,migrations}={}) {
  const admitted=admitRetrieve012(env,buildIdentity);
  migrationDatabaseConfig(env);
  const files=migrations || await loadMigrations();
  const pool=db || getMigrationPool(env);
  const client=await pool.connect();
  let committed=false;
  try {
    await client.query(admitted.mode==='inspect' ? 'BEGIN READ ONLY' : 'BEGIN');
    const actual=(await client.query('SELECT current_database() AS database_name')).rows[0]?.database_name;
    if (actual!=='jobsearch_dev') fail('RETRIEVE012_DATABASE_DENIED');
    if (admitted.mode==='apply') {
      // Managed Nile does not implement advisory or table locks (0A000).
      // Serialize this narrowly scoped migration on the existing immutable 011
      // ledger row, in the same transaction, before reading any schema state.
      // The legacy migration path remains disabled in managed DEV.
      const lock=await client.query("SELECT version FROM schema_migrations WHERE version='011' FOR UPDATE");
      if (lock.rows?.length!==1 || String(lock.rows[0].version)!=='011')
        fail('RETRIEVE012_LEDGER_LOCK_DENIED');
    }
    const before=await getState(client,files);
    let after=before;
    let applied=false;
    if (admitted.mode==='apply' && before==='PENDING_012') {
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
      if(after!=='ALREADY_APPLIED') fail('RETRIEVE012_POSTCHECK_FAILED');
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
    const result=await prepareOrApplyRetrieve012({buildIdentity:BUILD_IDENTITY});
    process.stdout.write(JSON.stringify(result)+'\n');
  } catch(error) {
    // Never print raw SQL, database URL, credentials, or provider exception text.
    const code=typeof error?.code==='string' && /^RETRIEVE012_[A-Z_0-9]+$/.test(error.code) ? error.code : typeof error?.code==='string' && /^[0-9A-Z]{5}$/.test(error.code) ? 'RETRIEVE012_SQLSTATE_'+error.code : 'RETRIEVE012_EXECUTION_FAILED';
    process.stderr.write(code+'\n');
    process.exitCode=86;
  } finally { await closeMigrationPool(); }
}
