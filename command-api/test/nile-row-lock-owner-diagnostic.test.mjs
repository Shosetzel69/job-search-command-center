// Diagnostic only: run against the attested disposable Nile CI database.
// No production/managed DEV access, no schema changes, no persistent writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {admitNileCi,attestNativeDatabase} from '../scripts/nile-ci-local-admission.mjs';
admitNileCi();
const url=process.env.NILE_TEST_DATABASE_URL;
test('Nile active search profile row-lock owner trace',async()=>{
 const a=new pg.Client({connectionString:url});
 const b=new pg.Client({connectionString:url});
 const tenant=randomUUID(), profile=randomUUID();
 let aTx=false,bTx=false;
 try {
  await Promise.all([a.connect(),b.connect()]);
  await attestNativeDatabase(a);
  // Use a temporary fixture row only if the native schema permits it.
  // This probe intentionally avoids assuming shared/tenant mixed writes.
  const identity=async c=>(await c.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  const [holder,waiter]=await Promise.all([identity(a),identity(b)]);
  console.log('NILE_LOCK_TRACE_CONNECTIONS='+JSON.stringify({holder,waiter,tenant,profile}));
  await a.query('BEGIN');aTx=true;
  await a.query(`SET LOCAL nile.tenant_id = '${tenant}'`);
  await b.query('BEGIN');bTx=true;
  await b.query(`SET LOCAL nile.tenant_id = '${tenant}'`);
  // Read-only preflight: avoid fabricating a fixture or modifying real rows.
  const existing=await a.query("SELECT search_profile_id FROM search_profile WHERE tenant_id=$1 AND status='ACTIVE' ORDER BY created_at,search_profile_id LIMIT 1",[tenant]);
  if(!existing.rows.length){
   console.log('NILE_LOCK_TRACE_SKIPPED=no_active_profile_for_ephemeral_tenant');
   return;
  }
  const id=existing.rows[0].search_profile_id;
  await a.query('SELECT search_profile_id FROM search_profile WHERE tenant_id=$1 AND search_profile_id=$2 FOR UPDATE',[tenant,id]);
  await b.query("SET LOCAL statement_timeout = '1000ms'");
  const started=Date.now();
  await assert.rejects(b.query('SELECT search_profile_id FROM search_profile WHERE tenant_id=$1 AND search_profile_id=$2 FOR UPDATE',[tenant,id]),e=>e.code==='57014');
  console.log('NILE_LOCK_TRACE_RESULT='+JSON.stringify({holder,waiter,elapsed_ms:Date.now()-started,sqlstate:'57014'}));
 } finally {
  if(bTx)await b.query('ROLLBACK').catch(()=>{});
  if(aTx)await a.query('ROLLBACK').catch(()=>{});
  await Promise.all([a.end().catch(()=>{}),b.end().catch(()=>{})]);
 }
});
