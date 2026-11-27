import test from 'node:test';
import assert from 'node:assert/strict';
import {collectDevSchemaInventory,DEV_SCHEMA_TABLES} from '../src/db/dev-schema-inventory.js';
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
