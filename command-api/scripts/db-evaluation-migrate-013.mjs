// ATC-535-FP02-R6: dedicated additive DEV-only migration, exact-source admission.
import { pathToFileURL } from 'node:url';
import { loadMigrations } from '../src/db/migrations.js';
import { closeMigrationPool,getMigrationPool } from '../src/db/pool.js';
import { migrationDatabaseConfig } from '../src/db/config.js';
const TARGET='013_profile_job_evaluation_listing.sql';
const SHA=/^[0-9a-f]{40}$/;
const fail=code=>{throw Object.assign(new Error(code),{code});};
export const COLUMNS=Object.freeze({input_digest:'text',fit_matrix:'jsonb',sort_title:'text',
 display_country:'text',display_work_mode:'text',display_contract_type:'text',b2b:'boolean',
 publication_at:'timestamp with time zone',publication_precision:'text',retrieve_at:'timestamp with time zone',
 is_repost:'boolean',is_remote:'boolean'});
export function admitEvaluation013(env,identity){
 const source=identity?.sourceSha,mode=env.EVALUATION013_MODE;
 if(env.APP_ENV!=='dev'||env.CLOUD_RUN_JOB!=='jscc-db-migrate-dev'||!SHA.test(source||'')||
   env.SOURCE_SHA!==source||identity.runtimeDataSha!==source)fail('EVALUATION013_SCOPE_DENIED');
 if(mode==='inspect'){if(env.EVALUATION013_OWNER_GATE)fail('EVALUATION013_INSPECT_GATE_UNEXPECTED');}
 else if(mode==='apply'){if(env.EVALUATION013_OWNER_GATE!=='APPROVE_EVALUATION_DEV_NILE_013_'+source)fail('EVALUATION013_OWNER_GATE_DENIED');}
 else fail('EVALUATION013_MODE_DENIED');
 return {mode,source};
}
export function assertEvaluation013Ledger(files,rows,columns){
 if(files.length!==13||files.some((m,i)=>m.version!==String(i+1).padStart(3,'0'))||
   files.at(-1).name!==TARGET||files[10].checksum!=='c6cb6ac52c9a717a5dc452b38fb0874be51896190dc24beab01babfafe623f0e')
   fail('EVALUATION013_CANDIDATE_MIGRATIONS_DENIED');
 if(![12,13].includes(rows.length)||rows.some((r,i)=>String(r.version)!==files[i].version||
   r.name!==files[i].name||r.checksum!==files[i].checksum))fail('EVALUATION013_LEDGER_MISMATCH');
 if(rows.length===12&&columns.length!==0)fail('EVALUATION013_UNTRACKED_COLUMNS');
 if(rows.length===13&&(columns.length!==Object.keys(COLUMNS).length||
   columns.some(c=>COLUMNS[c.column_name]!==c.data_type||c.is_nullable!=='YES')))
   fail('EVALUATION013_SCHEMA_DRIFT');
 return rows.length===13?'ALREADY_APPLIED':'PENDING_013';
}
async function state(client,files){
 const rows=(await client.query('SELECT version,name,checksum FROM schema_migrations ORDER BY version')).rows;
 const columns=(await client.query(`SELECT column_name,data_type,is_nullable FROM information_schema.columns
  WHERE table_schema='public' AND table_name='profile_job_evaluation' AND column_name=ANY($1::text[])`,
  [Object.keys(COLUMNS)])).rows;
 return assertEvaluation013Ledger(files,rows,columns);
}
export async function prepareOrApplyEvaluation013({env=process.env,buildIdentity,db,migrations}={}){
 const admitted=admitEvaluation013(env,buildIdentity);
 migrationDatabaseConfig(env);
 const files=migrations||await loadMigrations();
 const client=await (db||getMigrationPool(env)).connect();
 let committed=false;
 try{
  await client.query(admitted.mode==='inspect'?'BEGIN READ ONLY':'BEGIN');
  if((await client.query('SELECT current_database() AS database_name')).rows[0]?.database_name!=='jobsearch_dev')
   fail('EVALUATION013_DATABASE_DENIED');
  if(admitted.mode==='apply'){
   const lock=await client.query("SELECT version FROM schema_migrations WHERE version='012' FOR UPDATE");
   if(lock.rows?.length!==1||String(lock.rows[0].version)!=='012')fail('EVALUATION013_LEDGER_LOCK_DENIED');
  }
  const before=await state(client,files);let applied=false;
  if(admitted.mode==='apply'&&before==='PENDING_013'){
   const migration=files.at(-1);
   await client.query(migration.sql);
   await client.query('INSERT INTO schema_migrations(version,name,checksum) VALUES ($1,$2,$3)',
    [migration.version,migration.name,migration.checksum]);applied=true;
  }
  await client.query('COMMIT');committed=true;
  const after=applied?await state(client,files):before;
  if(applied&&after!=='ALREADY_APPLIED')fail('EVALUATION013_POSTCHECK_FAILED');
  return {status:'ok',environment:'dev',mode:admitted.mode,source_sha:admitted.source,
   before,after,applied,migration:TARGET,checksum:files.at(-1).checksum};
 }catch(e){if(!committed)await client.query('ROLLBACK').catch(()=>{});throw e;}
 finally{client.release();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const {BUILD_IDENTITY}=await import('../src/build-identity.generated.js');
  console.log(JSON.stringify(await prepareOrApplyEvaluation013({buildIdentity:BUILD_IDENTITY})));
 }catch(e){const code=typeof e?.code==='string'&&/^EVALUATION013_[A-Z_0-9]+$/.test(e.code)?e.code:
  typeof e?.code==='string'&&/^[0-9A-Z]{5}$/.test(e.code)?'EVALUATION013_SQLSTATE_'+e.code:'EVALUATION013_EXECUTION_FAILED';
  console.error(code);process.exitCode=86;}
 finally{await closeMigrationPool();}
}
