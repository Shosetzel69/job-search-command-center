// Diagnostic only: disposable, attested native Nile CI; never managed DEV.
import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {admitNileCi,attestNativeDatabase} from './nile-ci-local-admission.mjs';
admitNileCi();
const {resolveOrProvisionGoogleIdentity,resolveActiveSearchProfile}=await import('../src/multiuser-repository.js');
const url=process.env.NILE_TEST_DATABASE_URL;
const env={...process.env,APP_ENV:'dev'};
test('W025-L03 Nile active search profile row-lock owner trace', {timeout:30000},async()=>{
 const db=new pg.Pool({connectionString:url,max:2});
 const a=new pg.Client({connectionString:url,connectionTimeoutMillis:10000});
 const b=new pg.Client({connectionString:url,connectionTimeoutMillis:10000});
 let aTx=false,bTx=false;
 try {
  await attestNativeDatabase(db);
  const unique=randomUUID();
  // Use the same supported provisioning path as the native role-family suite.
  const ctx=await resolveOrProvisionGoogleIdentity({
   sub:'w025-lock-trace-'+unique,email:'w025-lock-'+unique+'@example.test',email_verified:true
  },env,{db});
  const profile=await resolveActiveSearchProfile(ctx,env,{db});
  const tenant=ctx.profile_id, profileId=profile.search_profile_id;
  assert.ok(tenant&&profileId,'native fixture must have an active search profile');
  await Promise.all([a.connect(),b.connect()]);
  const pid=async c=>(await c.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  const [holder,waiter]=await Promise.all([pid(a),pid(b)]);
  console.log('NILE_LOCK_TRACE_CONNECTIONS='+JSON.stringify({holder,waiter,tenant,profileId}));
  await a.query('BEGIN');aTx=true;
  await a.query(`SET LOCAL nile.tenant_id = '${tenant}'`);
  await a.query("SELECT search_profile_id FROM search_profile WHERE tenant_id=$1 AND status='ACTIVE' ORDER BY created_at,search_profile_id FOR UPDATE",[tenant]);
  console.log('NILE_LOCK_TRACE_HOLDER_ACQUIRED='+JSON.stringify({holder,profileId}));
  await b.query('BEGIN');bTx=true;
  await b.query(`SET LOCAL nile.tenant_id = '${tenant}'`);
  await b.query("SET LOCAL statement_timeout = '1500ms'");
  const started=Date.now();
  let failure;
  try{
   await b.query("SELECT search_profile_id FROM search_profile WHERE tenant_id=$1 AND status='ACTIVE' ORDER BY created_at,search_profile_id FOR UPDATE",[tenant]);
  }catch(e){failure=e;}
  const elapsed_ms=Date.now()-started;
  console.log('NILE_LOCK_TRACE_RESULT='+JSON.stringify({holder,waiter,elapsed_ms,sqlstate:failure?.code||null}));
  assert.equal(failure?.code,'57014','waiter must time out while holder retains row lock');
  assert.ok(elapsed_ms>=1000,'waiter must actually wait for lock');
 }finally{
  if(bTx)await b.query('ROLLBACK').catch(()=>{});
  if(aTx)await a.query('ROLLBACK').catch(()=>{});
  await Promise.all([a.end().catch(()=>{}),b.end().catch(()=>{}),db.end().catch(()=>{})]);
 }
});
