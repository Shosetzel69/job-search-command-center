// #589: read-only schema/migration metadata through the existing DEV diagnostic
// transaction. No caller SQL, relation names, tenant IDs, data rows or credentials.
import {createHash} from 'node:crypto';
import {loadMigrations} from './migrations.js';
import {PERSONAL_TABLES} from './personal-table-registry.js';

export const DEV_SCHEMA_TABLES=Object.freeze([...new Set([
 'schema_migrations','tenants','app_user','user_identity','profile','user_session',
 'collection_policy','system_bootstrap','account_capacity_policy','account_deletion_audit',
 'canonical_jobs','source_postings','search_runs','source_run_results','scheduler_config',
 'scheduler_state','coverage_scope_state',...PERSONAL_TABLES,
])].sort());
const NAME=/^[a-z][a-z0-9_]{0,62}$/;
const SHA=/^[a-f0-9]{64}$/;
const VERSION=/^[0-9]{3,12}$/;
const checksum=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
function require(ok,code){if(!ok)throw Error(code);}
const boundedRows=(r,max)=>{
 require(Array.isArray(r?.rows)&&r.rows.length<=max,'schema_metadata_limit');
 return r.rows;
};

export async function collectDevSchemaInventory(tx,{readMigrations=loadMigrations}={}){
 const expected=await readMigrations();
 require(Array.isArray(expected)&&expected.length>0&&expected.length<=128&&
  expected.every(x=>VERSION.test(x.version)&&SHA.test(x.checksum)&&
    /^[0-9]{3,12}_[a-z0-9][a-z0-9_-]*\.sql$/.test(x.name))&&
  new Set(expected.map(x=>x.version)).size===expected.length,'schema_migration_inventory_invalid');
 const present=boundedRows(await tx.query(
  "SELECT to_regclass('public.schema_migrations') IS NOT NULL AS present"),1);
 require(present.length===1&&typeof present[0].present==='boolean','schema_metadata_invalid');
 const actual=present[0].present?boundedRows(await tx.query(
  'SELECT version,name,checksum FROM public.schema_migrations ORDER BY version LIMIT 129'),128):[];
 require(actual.every(x=>typeof x.version==='string'&&VERSION.test(x.version)&&
  typeof x.name==='string'&&/^[0-9]{3,12}_[a-z0-9][a-z0-9_-]*\.sql$/.test(x.name)&&
  typeof x.checksum==='string'&&SHA.test(x.checksum))&&
  new Set(actual.map(x=>x.version)).size===actual.length,'schema_migration_metadata_invalid');
 const byVersion=new Map(actual.map(x=>[x.version,x]));
 const known=new Set(expected.map(x=>x.version));
 const migrations=expected.map(x=>{
  const found=byVersion.get(x.version);
  return {version:x.version,expected_checksum:x.checksum,actual_checksum:found?.checksum??null,
   state:!found?'MISSING':found.name===x.name&&found.checksum===x.checksum?'MATCH':'MISMATCH'};
 });
 const extra_versions=actual.filter(x=>!known.has(x.version)).map(x=>x.version);
 const rows=boundedRows(await tx.query(
  `SELECT c.relname::text AS table_name,
          ARRAY(SELECT i.relname::text FROM pg_catalog.pg_index ix
            JOIN pg_catalog.pg_class i ON i.oid=ix.indexrelid
            WHERE ix.indrelid=c.oid ORDER BY i.relname LIMIT 129) AS indexes,
          ARRAY(SELECT k.conname::text FROM pg_catalog.pg_constraint k
            WHERE k.conrelid=c.oid ORDER BY k.conname LIMIT 129) AS constraints
     FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname::text=ANY($1::text[]) AND c.relkind IN ('r','p')
    ORDER BY c.relname LIMIT 129`,[DEV_SCHEMA_TABLES]),128);
 const tableMap=new Map();
 for(const row of rows){
  require(DEV_SCHEMA_TABLES.includes(row.table_name)&&!tableMap.has(row.table_name),
   'schema_table_metadata_invalid');
  for(const key of ['indexes','constraints'])require(Array.isArray(row[key])&&row[key].length<=128&&
    row[key].every(x=>typeof x==='string'&&NAME.test(x)),'schema_object_metadata_invalid');
  tableMap.set(row.table_name,{table:row.table_name,present:true,
   indexes:[...row.indexes].sort(),constraints:[...row.constraints].sort()});
 }
 const tables=DEV_SCHEMA_TABLES.map(name=>tableMap.get(name)||{table:name,present:false,indexes:[],constraints:[]});
 const migration_state=migrations.every(x=>x.state==='MATCH')&&extra_versions.length===0?'MATCH':'DRIFT';
 const table_state=tables.every(x=>x.present)?'PRESENT':'MISSING';
 const schema={database:'jobsearch_dev',read_only:true,migration_state,table_state,
  migrations,extra_versions,tables,
  migration_checksum:checksum(actual.map(x=>[x.version,x.name,x.checksum])),
  catalog_checksum:checksum(tables)};
 require(Buffer.byteLength(JSON.stringify(schema))<=32768,'schema_metadata_limit');
 // Index/constraint inventory is observed metadata, not proof of complete DDL parity.
 return schema;
}
