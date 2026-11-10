// #531 W02-5: explicit CI admission before loading any database module.
import {admitNileCi,attestNativeDatabase} from './nile-ci-local-admission.mjs';
// Never accept a local, non-CI, or incomplete runner invocation: fail before importing pg.
admitNileCi();
const [{default:pg},{migrate,loadMigrations}]=await Promise.all([
  import('pg'), import('../src/db/migrations.js')
]);
const url=String(process.env.NILE_TEST_DATABASE_URL||'').trim();
if(!url)throw new Error('NILE_TEST_DATABASE_URL is required');
const db=new pg.Pool({connectionString:url,max:2,connectionTimeoutMillis:10000,idleTimeoutMillis:30000});
try {
  await attestNativeDatabase(db);
  const items=await loadMigrations();
  const expected=Array.from({length:11},(_,i)=>String(i+1).padStart(3,'0'));
  if(items.length!==11||items.some((m,i)=>m.version!==expected[i]))throw new Error('W025_M01 invalid migration inventory');
  const first=await migrate({db});
  if(first.applied.length!==11||first.current!=='011')throw new Error('W025_M01 first migration mismatch');
  const stored=await db.query('SELECT version,checksum FROM schema_migrations ORDER BY version');
  if(stored.rows.length!==11||stored.rows.some((r,i)=>r.version!==items[i].version||r.checksum!==items[i].checksum))
    throw new Error('W025_M01 checksum mismatch');
  const schema=await db.query("SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='coverage_scope_state' AND column_name='role_subfamilies'");
  if(schema.rowCount!==1)throw new Error('W025_M01 role family schema absent');
  const counts=await db.query("SELECT to_regclass('public.profile_job_count_snapshots') IS NOT NULL AS present");
  if(counts.rows?.[0]?.present!==true)throw new Error('F04 aggregate snapshot schema absent');
  console.log('W025_MIGRATIONS_FIRST=PASS');
  const second=await migrate({db});
  if(second.applied.length!==0||second.current!=='011')throw new Error('W025_M02 not idempotent');
  const again=await db.query('SELECT version,checksum FROM schema_migrations ORDER BY version');
  if(JSON.stringify(stored.rows)!==JSON.stringify(again.rows))throw new Error('W025_M02 migration ledger changed');
  console.log('W025_MIGRATIONS_IDEMPOTENCE=PASS');
}finally{await db.end();}
