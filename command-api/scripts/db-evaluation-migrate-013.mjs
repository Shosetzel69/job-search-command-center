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
export const INDEXES=Object.freeze({
 pje_listing_score_idx:'score',pje_listing_publication_idx:'publication_at',
 pje_listing_retrieve_idx:'retrieve_at',pje_listing_title_idx:'sort_title',
 pje_listing_country_idx:'display_country',pje_listing_mode_idx:'display_work_mode'});
export function admitEvaluation013(env,identity){
 const source=identity?.sourceSha,mode=env.EVALUATION013_MODE;
 if(env.APP_ENV!=='dev'||env.CLOUD_RUN_JOB!=='jscc-db-migrate-dev'||!SHA.test(source||'')||
   env.SOURCE_SHA!==source||identity.runtimeDataSha!==source)fail('EVALUATION013_SCOPE_DENIED');
 if(mode==='inspect'){if(env.EVALUATION013_OWNER_GATE)fail('EVALUATION013_INSPECT_GATE_UNEXPECTED');}
 else if(mode==='apply'){if(env.EVALUATION013_OWNER_GATE!=='APPROVE_EVALUATION_DEV_NILE_013_'+source)fail('EVALUATION013_OWNER_GATE_DENIED');}
 else fail('EVALUATION013_MODE_DENIED');
 return {mode,source};
}
// Nile may deparse logical public tables using the underlying database UUID
// schema. Accept only an exact public schema alias, no extra clauses or keys.
// Catalog evidence is scoped by the resolved logical table OID and exact names;
// index readiness, validity, count, uniqueness and definition are mandatory.
function normalizeIndexDefinition(definition){
 return String(definition).trim().replace(/\s+/g,' ')
  .replace(/^CREATE INDEX /i,'CREATE INDEX ')
  .replace(/ ON (?:"public"|public|"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_public")\./i,' ON ')
  .replace(/ USING BTREE /i,' USING btree ')
  .replace(/,\s*/g,', ');
}
export function assertEvaluation013Ledger(files,rows,columns,indexes){
 if(files.length!==13||files.some((m,i)=>m.version!==String(i+1).padStart(3,'0'))||
   files.at(-1).name!==TARGET||files[10].checksum!=='c6cb6ac52c9a717a5dc452b38fb0874be51896190dc24beab01babfafe623f0e')
   fail('EVALUATION013_CANDIDATE_MIGRATIONS_DENIED');
 if(![12,13].includes(rows.length)||rows.some((r,i)=>String(r.version)!==files[i].version||
   r.name!==files[i].name||r.checksum!==files[i].checksum))fail('EVALUATION013_LEDGER_MISMATCH');
 if(!Array.isArray(indexes))fail('EVALUATION013_INDEX_EVIDENCE_MISSING');
 if(rows.length===12&&(columns.length!==0||indexes.length!==0))fail('EVALUATION013_UNTRACKED_OBJECTS');
 if(rows.length===13&&(indexes.length!==Object.keys(INDEXES).length||
   new Set(indexes.map(i=>i.indexname)).size!==Object.keys(INDEXES).length||
   indexes.some(i=>!Object.hasOwn(INDEXES,i.indexname)||i.indisvalid!==true||i.indisready!==true||
     normalizeIndexDefinition(i.indexdef)!==`CREATE INDEX ${i.indexname} ON profile_job_evaluation USING btree (tenant_id, search_profile_id, ${INDEXES[i.indexname]}, job_id)`)))
   fail('EVALUATION013_INDEX_DRIFT');
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
 // Use the table-OID-scoped catalog path already used by migration 012.
 // pg_indexes returned [] even without a schema filter in native Nile.
 // Require the logical table to resolve. Do not filter invalid/unready indexes
 // out of the precheck: an existing, invalid target object is still drift.
 if((await client.query("SELECT to_regclass('public.profile_job_evaluation') IS NOT NULL AS table_present")).rows[0]?.table_present!==true)
   fail('EVALUATION013_INDEX_TABLE_UNRESOLVED');
 const indexes=(await client.query(`
   SELECT idx.relname AS indexname, pg_get_indexdef(i.indexrelid) AS indexdef,
          i.indisvalid, i.indisready
     FROM pg_catalog.pg_index i
     JOIN pg_catalog.pg_class idx ON idx.oid=i.indexrelid
    WHERE i.indrelid=to_regclass('public.profile_job_evaluation')
      AND idx.relname::text=ANY($1::text[])
 `,[Object.keys(INDEXES)])).rows;
 try{return assertEvaluation013Ledger(files,rows,columns,indexes);}
 catch(error){
   // Only native disposable CI receives catalog diagnostics: no runtime data.
   if(error?.code==='EVALUATION013_INDEX_DRIFT'&&process.env.CI==='true'&&process.env.GITHUB_ACTIONS==='true')
     console.error('EVALUATION013_NATIVE_INDEX_EVIDENCE='+JSON.stringify(indexes.map(i=>({indexname:i.indexname,indexdef:i.indexdef,indisvalid:i.indisvalid,indisready:i.indisready}))));
   throw error;
 }
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
