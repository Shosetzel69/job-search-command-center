import test from 'node:test';
import assert from 'node:assert/strict';
import {collectDevSchemaInventory,collectDevRuntimeHealth,collectDevTenantInvariants,DEV_SCHEMA_TABLES} from '../src/db/dev-schema-inventory.js';
import {withDevDiagnosticTransaction} from '../src/db/tenant-gateway.js';
const sha='a'.repeat(64),other='b'.repeat(64);
const migrations=[{version:'001',name:'001_schema_migrations.sql',checksum:sha}];
const rows=[{table_name:'schema_migrations',indexes:['schema_migrations_pkey'],constraints:['schema_migrations_pkey']}];
function tx({actual=migrations,tables=rows,present=true}={}){
 const calls=[];
 return {calls,query:async(sql,params)=>{
  calls.push([sql,params]);
  if(sql.includes('to_regclass'))return {rows:[{present}]};
  if(sql.includes('FROM public.schema_migrations'))return {rows:actual};
  if(sql.includes('pg_catalog.pg_class')){assert.deepEqual(params,[DEV_SCHEMA_TABLES]);return {rows:tables};}
  throw Error('unapproved_sql');
 }};
}
const collect=t=>collectDevSchemaInventory(t,{readMigrations:async()=>migrations});
test('schema inventory compares exact migration checksums, projects only fixed catalog objects',async()=>{
 const t=tx(),out=await collect(t);
 assert.equal(out.database,'jobsearch_dev');
 assert.equal(out.read_only,true);
 assert.equal(out.migration_state,'MATCH');
 assert.equal(out.table_state,'MISSING');
 assert.deepEqual(out.tables.find(x=>x.table==='schema_migrations'),{
  table:'schema_migrations',present:true,indexes:['schema_migrations_pkey'],constraints:['schema_migrations_pkey']});
 assert.equal(out.tables.find(x=>x.table==='canonical_jobs').present,false);
 assert.match(out.catalog_checksum,/^[a-f0-9]{64}$/);
 assert.equal(t.calls.length,3);
});
test('schema inventory explicitly identifies missing, divergent and extra migrations',async()=>{
 const drift=await collect(tx({actual:[{...migrations[0],checksum:other},{version:'999',name:'999_other.sql',checksum:sha}]}));
 assert.equal(drift.migration_state,'DRIFT');
 assert.equal(drift.migrations[0].state,'MISMATCH');
 assert.deepEqual(drift.extra_versions,['999']);
 const missing=await collect(tx({present:false}));
 assert.equal(missing.migration_state,'DRIFT');
 assert.equal(missing.migrations[0].state,'MISSING');
});
test('unexpected catalog rows, malformed migration metadata and unbounded output fail closed',async()=>{
 for(const bad of [
  {tables:[{table_name:'private_data',indexes:[],constraints:[]}]},
  {tables:[{...rows[0],indexes:['private/secret']}]},
  {tables:[rows[0],rows[0]]},
  {actual:[{...migrations[0],checksum:'not-a-digest'}]},
 ])await assert.rejects(()=>collect(tx(bad)));
});
test('schema collector can only operate inside existing read-only transaction; rollback preserves tenant boundary',async()=>{
 const profile='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 const context={user_id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',profile_id:profile,role:'ADMIN',status:'ACTIVE'};
 const env={APP_ENV:'dev',JSCC_DEV_NILE_DIAGNOSTICS:'true'};
 const t=tx(),calls=[],released=[];
 const db={connect:async()=>({query:async(sql,params)=>{
  calls.push(sql);
  if(sql.includes("current_setting('nile.tenant_id'"))return {rows:[{tenant_id:profile}]};
  if(sql.includes('current_database()'))return {rows:[{db:'jobsearch_dev',ro:'on'}]};
  if(sql==='BEGIN READ ONLY'||sql==='ROLLBACK'||sql.startsWith('SET LOCAL'))return {rows:[]};
  return t.query(sql,params);
 },release:v=>released.push(v)})};
 const out=await withDevDiagnosticTransaction(context,collect,{env,db});
 assert.equal(out.read_only,true);
 assert.equal(calls[0],'BEGIN READ ONLY');
 assert.equal(calls.at(-1),'ROLLBACK');
 assert.deepEqual(released,[false]);
});


test('runtime health reports only current backend and current process bounded evidence',async()=>{
 const pool={totalCount:3,idleCount:1,waitingCount:0};
 const row={database:'jobsearch_dev',read_only:true,statement_timeout_bound:true,lock_timeout_bound:true,
  backend_tls:true,granted_locks:2,waiting_locks:0,private:'not-returned'};
 const read=async(value=row,db=pool)=>collectDevRuntimeHealth({query:async(sql,params)=>{
  assert.match(sql,/pg_catalog\.pg_stat_ssl WHERE pid=pg_backend_pid\(\)/);
  assert.match(sql,/pg_catalog\.pg_locks WHERE pid=pg_backend_pid\(\)/);
  assert.equal(params,undefined);
  return {rows:[value]};
 }},db);
 const out=await read();
 assert.equal(out.backend_tls,'OBSERVED_TLS');
 assert.equal(out.lock_scope,'current_backend_only');
 assert.equal(out.pool_scope,'current_process_only');
 assert.deepEqual(out.pool,{total:3,idle:1,waiting:0});
 assert.equal(JSON.stringify(out).includes('not-returned'),false);
 assert.equal((await read({...row,backend_tls:null})).backend_tls,'UNKNOWN');
 for(const bad of [{...row,database:'jobsearch_prod'},{...row,read_only:false},{...row,waiting_locks:-1}])
  await assert.rejects(()=>read(bad),/runtime_health_metadata_invalid/);
 await assert.rejects(()=>read(row,{...pool,idleCount:4}),/runtime_health_pool_invalid/);
});


test('013 remote preflight reuses exact migration ledger and refuses writable or foreign DB',async()=>{
 const {inspectEvaluation013ReadOnly,COLUMNS,INDEXES}=await import('../scripts/db-evaluation-migrate-013.mjs');
 const {loadMigrations}=await import('../src/db/migrations.js');
 const files=await loadMigrations();
 const ledger=files.map(({version,name,checksum})=>({version,name,checksum}));
 const run=async({applied=false,db='jobsearch_dev',ro='on',drift=false}={})=>{
  const calls=[];
  const tx={query:async(sql,params)=>{
   calls.push(sql);
   assert.match(sql.trim(),/^SELECT\b/i);
   if(sql.includes('current_database()'))return {rows:[{db,ro}]};
   if(sql.startsWith('SELECT version,name,checksum'))return {rows:ledger.slice(0,applied?13:12)};
   if(sql.includes('information_schema.columns')){
    assert.deepEqual(params,[Object.keys(COLUMNS)]);
    return {rows:applied?Object.entries(COLUMNS).map(([column_name,data_type])=>({column_name,data_type,is_nullable:'YES'})):[]};
   }
   if(sql.includes('to_regclass')&&!sql.includes('pg_catalog.pg_index'))return {rows:[{table_present:true}]};
   if(sql.includes('pg_catalog.pg_index')){
    assert.deepEqual(params,[Object.keys(INDEXES)]);
    return {rows:applied?Object.entries(INDEXES).map(([indexname,column])=>({indexname,
     indexdef:'CREATE INDEX '+indexname+' ON profile_job_evaluation USING btree (tenant_id, search_profile_id, '+column+', job_id)',
     indisvalid:!drift,indisready:true})):[]};
   }
   throw Error('unexpected_query');
  }};
  const result=await inspectEvaluation013ReadOnly(tx,{readMigrations:async()=>files});
  assert.ok(calls.length>1);
  return result;
 };
 const pending=await run();
 assert.equal(pending.readiness,'PENDING_013');
 assert.equal(pending.checksum,files.at(-1).checksum);
 assert.equal(pending.apply_authorized,false);
 assert.equal((await run({applied:true})).readiness,'ALREADY_APPLIED');
 await assert.rejects(()=>run({db:'jobsearch_test'}),/DIAGNOSTIC_SCOPE_DENIED/);
 await assert.rejects(()=>run({ro:'off'}),/DIAGNOSTIC_SCOPE_DENIED/);
 await assert.rejects(()=>run({applied:true,drift:true}),/INDEX_DRIFT/);
});

test('configured diagnostic tenant foundation check is read-only, parameterized and saturates at two',async()=>{
 const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 const collect=(row,guard={db:'jobsearch_dev',ro:'on',tenant:id})=>collectDevTenantInvariants({tenantId:id,query:async(sql,params)=>{
  assert.match(sql,/^SELECT/);
  if(sql.includes('current_database()'))return {rows:[guard]};
  assert.deepEqual(params,[id]);assert.match(sql,/sp.tenant_id=\$1/);assert.match(sql,/LIMIT 2/);
  return {rows:[row]};
 }});
 const good=await collect({active_profiles:1,missing_preferences:0,private:'not-returned'});
 assert.equal(good.foundation_state,'CONSISTENT');assert.equal(good.complete_database_validation,false);
 assert.equal(JSON.stringify(good).includes(id),false);assert.equal(JSON.stringify(good).includes('not-returned'),false);
 assert.equal((await collect({active_profiles:2,missing_preferences:0})).foundation_state,'INCONSISTENT');
 assert.equal((await collect({active_profiles:1,missing_preferences:1})).foundation_state,'INCONSISTENT');
 await assert.rejects(()=>collect({active_profiles:0,missing_preferences:1}));
 await assert.rejects(()=>collect({active_profiles:1,missing_preferences:0},{db:'jobsearch_dev',ro:'off',tenant:id}));
 await assert.rejects(()=>collect({active_profiles:1,missing_preferences:0},{db:'jobsearch_dev',ro:'on',tenant:'foreign'}));
});
