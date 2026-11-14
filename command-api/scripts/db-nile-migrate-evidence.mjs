// #531 W02-5: explicit CI admission before loading any database module.
import {admitNileCi,attestNativeDatabase} from './nile-ci-local-admission.mjs';
// Never accept a local, non-CI, or incomplete runner invocation: fail before importing pg.
admitNileCi();
const [{default:pg},{migrate,loadMigrations},{prepareOrApplyRetrieve012},{mkdtemp,writeFile,rm},{tmpdir},{join}]=await Promise.all([
  import('pg'), import('../src/db/migrations.js'), import('./db-retrieve-migrate-012.mjs'),
  import('node:fs/promises'), import('node:os'), import('node:path'),
]);
const url=String(process.env.NILE_TEST_DATABASE_URL||'').trim();
if(!url)throw new Error('NILE_TEST_DATABASE_URL is required');
const db=new pg.Pool({connectionString:url,max:2,connectionTimeoutMillis:10000,idleTimeoutMillis:30000});
try {
  await attestNativeDatabase(db);
  const items=await loadMigrations();
  const expected=Array.from({length:12},(_,i)=>String(i+1).padStart(3,'0'));
  if(items.length!==12||items.some((m,i)=>m.version!==expected[i]))throw new Error('W025_M01 invalid migration inventory');
  // Exercise the real 011 -> 012 DEV release path on the attested disposable
  // native Nile instance, not against managed DEV. Retain the complete
  // ledger, cardinality, schema and idempotence oracles below.
  const prefix=await mkdtemp(join(tmpdir(),'jscc-nile-011-'));
  let first;
  try {
    for (const item of items.slice(0,11)) await writeFile(join(prefix,item.name),item.sql,{flag:'wx'});
    first=await migrate({db,dir:prefix});
  } finally { await rm(prefix,{recursive:true,force:true}); }
  if(first.applied.length!==11||first.current!=='011')throw new Error('W025_M01 prefix migration mismatch');
  const source='a'.repeat(40);
  const buildIdentity={sourceSha:source,runtimeDataSha:source};
  const releaseEnv={APP_ENV:'dev',CLOUD_RUN_JOB:'jscc-db-migrate-dev',SOURCE_SHA:source,
    NILE_MIGRATION_DATABASE_URL:url,RETRIEVE012_MODE:'inspect'};
  const inspected=await prepareOrApplyRetrieve012({env:releaseEnv,buildIdentity,db});
  if(inspected.before!=='PENDING_012'||inspected.applied)throw new Error('W025_M01 012 precheck mismatch');
  const applyEnv={...releaseEnv,RETRIEVE012_MODE:'apply',RETRIEVE012_OWNER_GATE:'APPROVE_RETRIEVE_DEV_NILE_012_'+source};
  const applied=await prepareOrApplyRetrieve012({env:applyEnv,buildIdentity,db});
  if(!applied.applied||applied.before!=='PENDING_012'||applied.after!=='ALREADY_APPLIED')throw new Error('W025_M01 012 apply mismatch');
  const retry=await prepareOrApplyRetrieve012({env:applyEnv,buildIdentity,db});
  if(retry.applied||retry.after!=='ALREADY_APPLIED')throw new Error('W025_M02 012 retry mismatch');
  console.log('RETRIEVE012_NATIVE_PREFIX_APPLY_RETRY=PASS');
  const stored=await db.query('SELECT version,checksum FROM schema_migrations ORDER BY version');
  if(stored.rows.length!==12||stored.rows.some((r,i)=>r.version!==items[i].version||r.checksum!==items[i].checksum))
    throw new Error('W025_M01 checksum mismatch');
  const schema=await db.query("SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='coverage_scope_state' AND column_name='role_subfamilies'");
  if(schema.rowCount!==1)throw new Error('W025_M01 role family schema absent');
  const requestTable=await db.query("SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='refresh_requests' AND column_name='tenant_id'");
  if(requestTable.rowCount!==1)throw new Error('Retrieve request tenant schema absent');
  console.log('W025_MIGRATIONS_FIRST=PASS');
  const second=await migrate({db});
  if(second.applied.length!==0||second.current!=='012')throw new Error('W025_M02 not idempotent');
  const again=await db.query('SELECT version,checksum FROM schema_migrations ORDER BY version');
  if(JSON.stringify(stored.rows)!==JSON.stringify(again.rows))throw new Error('W025_M02 migration ledger changed');
  console.log('W025_MIGRATIONS_IDEMPOTENCE=PASS');
}finally{await db.end();}
