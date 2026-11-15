import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const old=resolve(process.argv[2]||'');
assert.equal(execFileSync('git',['-C',old,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),'121f88e212013d2c4665bb70f881a3bcee365d21');
const load=path=>import(pathToFileURL(resolve(old,'command-api',path)).href);
const {admitNileCi,attestNativeDatabase}=await load('scripts/nile-ci-local-admission.mjs');
admitNileCi();
const {getPool,closePool}=await load('src/db/pool.js');
const {databaseReadiness}=await load('src/db/readiness.js');
const {deleteTenantDomain,withTenantTransaction}=await load('src/db/tenant-gateway.js');
const db=getPool();
const a=randomUUID(),b=randomUUID();
try {
  await attestNativeDatabase(db);
  const ledgerBefore=(await db.query('SELECT version,name,checksum FROM schema_migrations ORDER BY version')).rows;
  assert.equal(ledgerBefore.length,12);
  assert.equal(ledgerBefore.at(-1).name,'012_refresh_requests.sql');
  assert.equal((await databaseReadiness(process.env,{db})).status,'ok');
  for(const id of [a,b]){
    await db.query('INSERT INTO tenants(id,name) VALUES($1,$2)',[id,'rollback-probe']);
    await db.query("INSERT INTO refresh_requests(tenant_id,request_id,actor_role,intent,outcome) VALUES($1,$2,'ADMIN','manual','PENDING')",[id,randomUUID()]);
    await db.query("INSERT INTO profile_job_count_snapshots(tenant_id,search_profile_id,scope_key,profile_version,fit_algorithm_version,totals) VALUES($1,$2,'probe',1,'probe','{}')",[id,randomUUID()]);
  }
  const count=async(table,id)=>Number((await db.query('SELECT count(*) AS n FROM '+table+' WHERE tenant_id=$1',[id])).rows[0].n);
  for(const table of ['refresh_requests','profile_job_count_snapshots']){assert.equal(await count(table,a),1);assert.equal(await count(table,b),1);}
  assert.equal((await deleteTenantDomain(a,{db})).deleted,true);
  for(const table of ['refresh_requests','profile_job_count_snapshots']){assert.equal(await count(table,a),0);assert.equal(await count(table,b),1);}
  assert.equal((await deleteTenantDomain(b,{db})).deleted,true);
  for(const table of ['refresh_requests','profile_job_count_snapshots'])assert.equal(await count(table,b),0);
  assert.deepEqual((await db.query('SELECT version,name,checksum FROM schema_migrations ORDER BY version')).rows,ledgerBefore);
  console.log('EXACT_OLD_RUNTIME_READINESS_AND_TENANT_CASCADE_012=PASS');
}finally{await closePool();}
