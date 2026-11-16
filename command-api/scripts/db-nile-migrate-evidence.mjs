// #531 W02-5: explicit CI admission before loading any database module.
import {admitNileCi,attestNativeDatabase} from './nile-ci-local-admission.mjs';
// Never accept a local, non-CI, or incomplete runner invocation: fail before importing pg.
admitNileCi();
const [{default:pg},{migrate,loadMigrations},{prepareOrApplyRetrieve012},{mkdtemp,writeFile,rm},{tmpdir},{join}]=await Promise.all([
  import('pg'), import('../src/db/migrations.js'), import('./db-retrieve-migrate-012.mjs'),
  import('node:fs/promises'), import('node:os'), import('node:path'),
]);
const {prepareOrApplyEvaluation013}=await import('./db-evaluation-migrate-013.mjs');
const url=String(process.env.NILE_TEST_DATABASE_URL||'').trim();
if(!url)throw new Error('NILE_TEST_DATABASE_URL is required');
const db=new pg.Pool({connectionString:url,max:2,connectionTimeoutMillis:10000,idleTimeoutMillis:30000});
try {
  await attestNativeDatabase(db);
  const items=await loadMigrations();
  const expected=Array.from({length:13},(_,i)=>String(i+1).padStart(3,'0'));
  if(items.length!==13||items.some((m,i)=>m.version!==expected[i]))throw new Error('W025_M01 invalid migration inventory');
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
  const inspected=await prepareOrApplyRetrieve012({env:releaseEnv,buildIdentity,db,migrations:items.slice(0,12)});
  if(inspected.before!=='PENDING_012'||inspected.applied)throw new Error('W025_M01 012 precheck mismatch');
  const applyEnv={...releaseEnv,RETRIEVE012_MODE:'apply',RETRIEVE012_OWNER_GATE:'APPROVE_RETRIEVE_DEV_NILE_012_'+source};
  // Two independent clients must serialize before the ledger/schema read.
  // Exactly one writes; the other sees the committed ledger and is idempotent.
  const attempts=await Promise.all([0,1].map(()=>prepareOrApplyRetrieve012({env:applyEnv,buildIdentity,db,migrations:items.slice(0,12)})));
  const applied=attempts.filter(x=>x.applied), skipped=attempts.filter(x=>!x.applied);
  if(applied.length!==1||applied[0].before!=='PENDING_012'||applied[0].after!=='ALREADY_APPLIED'||
     skipped.length!==1||skipped[0].before!=='ALREADY_APPLIED'||skipped[0].after!=='ALREADY_APPLIED')
    throw new Error('W025_M01 012 concurrent apply mismatch');
  console.log('RETRIEVE012_NATIVE_CONCURRENT_ROW_LOCK=PASS');
  const retry=await prepareOrApplyRetrieve012({env:applyEnv,buildIdentity,db,migrations:items.slice(0,12)});
  if(retry.applied||retry.after!=='ALREADY_APPLIED')throw new Error('W025_M02 012 retry mismatch');
  console.log('RETRIEVE012_NATIVE_PREFIX_APPLY_RETRY=PASS');
  const evaluationEnv={APP_ENV:'dev',CLOUD_RUN_JOB:'jscc-db-migrate-dev',SOURCE_SHA:source,
    NILE_MIGRATION_DATABASE_URL:url,EVALUATION013_MODE:'inspect'};
  const inspected013=await prepareOrApplyEvaluation013({env:evaluationEnv,buildIdentity,db,migrations:items});
  if(inspected013.before!=='PENDING_013'||inspected013.applied)throw new Error('W025_M01 013 precheck mismatch');
  const apply013={...evaluationEnv,EVALUATION013_MODE:'apply',EVALUATION013_OWNER_GATE:'APPROVE_EVALUATION_DEV_NILE_013_'+source};
  const applied013=await prepareOrApplyEvaluation013({env:apply013,buildIdentity,db,migrations:items});
  if(!applied013.applied||applied013.after!=='ALREADY_APPLIED')throw new Error('W025_M01 013 apply mismatch');
  const retry013=await prepareOrApplyEvaluation013({env:apply013,buildIdentity,db,migrations:items});
  if(retry013.applied||retry013.after!=='ALREADY_APPLIED')throw new Error('W025_M02 013 retry mismatch');
  console.log('EVALUATION013_NATIVE_PREFIX_APPLY_RETRY=PASS');
  // Destructive schema rollback is exercised only on this admitted ephemeral
  // native CI database, before any product fixture or application data exists.
  // CI is exclusive and admitted as disposable, with no application clients yet.
  // Release the distributed ACCESS SHARE lock from COUNT before distributed DDL:
  // coordinator logs on both previous attempts identify remote SQLSTATE 55P03.
  const count=await db.query('SELECT count(*)::integer AS count FROM profile_job_evaluation');
  if(Number(count.rows[0]?.count)!==0)throw Error('EVALUATION013_ROLLBACK_NONEMPTY_DENIED');
  const rollbackClient=await db.connect();
  try{
    await rollbackClient.query('BEGIN');
    const lock=await rollbackClient.query("SELECT version FROM schema_migrations WHERE version='012' FOR UPDATE");
    if(lock.rows.length!==1)throw Error('EVALUATION013_ROLLBACK_LOCK_DENIED');
    const {COLUMNS}=await import('./db-evaluation-migrate-013.mjs');
    await rollbackClient.query('ALTER TABLE profile_job_evaluation '+Object.keys(COLUMNS).map(c=>'DROP COLUMN '+c).join(', '));
    const removed=await rollbackClient.query("DELETE FROM schema_migrations WHERE version='013' AND checksum=$1 RETURNING version",[items.at(-1).checksum]);
    if(removed.rows.length!==1)throw Error('EVALUATION013_ROLLBACK_LEDGER_DENIED');
    await rollbackClient.query('COMMIT');
  }catch(e){await rollbackClient.query('ROLLBACK').catch(()=>{});throw e;}
  finally{rollbackClient.release();}
  const rolledBack=await prepareOrApplyEvaluation013({env:evaluationEnv,buildIdentity,db,migrations:items});
  if(rolledBack.before!=='PENDING_013')throw Error('EVALUATION013_ROLLBACK_POSTCHECK_FAILED');
  const restored013=await prepareOrApplyEvaluation013({env:apply013,buildIdentity,db,migrations:items});
  if(!restored013.applied||restored013.after!=='ALREADY_APPLIED')throw Error('EVALUATION013_ROLLBACK_REAPPLY_FAILED');
  console.log('EVALUATION013_NATIVE_EMPTY_ROLLBACK_REAPPLY=PASS');

  const stored=await db.query('SELECT version,checksum FROM schema_migrations ORDER BY version');
  if(stored.rows.length!==13||stored.rows.some((r,i)=>r.version!==items[i].version||r.checksum!==items[i].checksum))
    throw new Error('W025_M01 checksum mismatch');
  const schema=await db.query("SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='coverage_scope_state' AND column_name='role_subfamilies'");
  if(schema.rowCount!==1)throw new Error('W025_M01 role family schema absent');
  const requestTable=await db.query("SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='refresh_requests' AND column_name='tenant_id'");
  if(requestTable.rowCount!==1)throw new Error('Retrieve request tenant schema absent');
  console.log('W025_MIGRATIONS_FIRST=PASS');
  const second=await migrate({db});
  if(second.applied.length!==0||second.current!=='013')throw new Error('W025_M02 not idempotent');
  const again=await db.query('SELECT version,checksum FROM schema_migrations ORDER BY version');
  if(JSON.stringify(stored.rows)!==JSON.stringify(again.rows))throw new Error('W025_M02 migration ledger changed');
  console.log('W025_MIGRATIONS_IDEMPOTENCE=PASS');
}finally{await db.end();}
