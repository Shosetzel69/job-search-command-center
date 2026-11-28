import test from 'node:test';
import assert from 'node:assert/strict';
import {handleDevNileDiagnostic,verifyDiagnosticCaller} from '../src/dev-nile-diagnostic.js';
import {withDevDiagnosticTransaction} from '../src/db/tenant-gateway.js';

const sha='a'.repeat(40);
const env={APP_ENV:'dev',JSCC_DEV_NILE_DIAGNOSTICS:'true',JSCC_DEV_NILE_DIAGNOSTIC_CALLER_SUB:'123456'};
const request=(suffix='',init={})=>new Request('https://example.invalid/admin/dev/nile-diagnostic?operation=fit_verify_plan&expected_source_sha='+sha+suffix,init);
test('fixed audience, exact caller subject and non-browser credentials',async()=>{
  const req=request('',{headers:{Authorization:'Bearer token'}});
  const good=async(token,keys,options)=>{
    assert.equal(token,'token');
    assert.equal(options.audience,'urn:jscc:dev:nile-diagnostic');
    return {payload:{sub:'123456',aud:options.audience}};
  };
  assert.equal(await verifyDiagnosticCaller(req,env,good),true);
  assert.equal(await verifyDiagnosticCaller(req,env,async()=>({payload:{sub:'123457',aud:'urn:jscc:dev:nile-diagnostic'}})),false);
  assert.equal(await verifyDiagnosticCaller(request('',{headers:{Authorization:'Bearer token',Cookie:'x=y'}}),env,good),false);
  assert.equal(await verifyDiagnosticCaller(request('',{headers:{Authorization:'Bearer token',Origin:'https://example.invalid'}}),env,good),false);
});
test('route rejects disabled, cross-environment, method, caller, extra args and source mismatch before DB access',async()=>{
  let calls=0;
  const deps={sourceSha:sha,authorize:async()=>true,read:async()=>{calls++;throw Error('unexpected');}};
  assert.equal((await handleDevNileDiagnostic(request(),{...env,APP_ENV:'test'},deps)).status,404);
  assert.equal((await handleDevNileDiagnostic(request(),{...env,JSCC_DEV_NILE_DIAGNOSTICS:'false'},deps)).status,404);
  assert.equal((await handleDevNileDiagnostic(request('',{method:'POST'}),env,deps)).status,405);
  assert.equal((await handleDevNileDiagnostic(request(),env,{...deps,authorize:async()=>false})).status,403);
  assert.equal((await handleDevNileDiagnostic(request('&tenant=other'),env,deps)).status,400);
  assert.equal((await handleDevNileDiagnostic(request(),env,{...deps,sourceSha:'b'.repeat(40)})).status,409);
  assert.equal(calls,0);
});
test('authorized operation returns source-bound sanitized repository result',async()=>{
  const result=await handleDevNileDiagnostic(request(),env,{
    sourceSha:sha,authorize:async()=>true,read:async()=>({payload:{}}),
    observe:async(op)=>({status:'COLLECTED',operation:op,elapsed_ms:1,timing:{},plan:{'Plan Rows':2}})});
  assert.equal(result.status,200);
  assert.equal((await result.json()).source_sha,sha);
});
const profile='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const context={user_id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',profile_id:profile,role:'ADMIN',status:'ACTIVE'};
function pool({tenant=profile,dbName='jobsearch_dev',ro='on',fail=null}={}){
  const calls=[],released=[];
  return {calls,released,db:{connect:async()=>({query:async(sql)=>{
    calls.push(sql);
    if(fail&&sql.startsWith(fail))throw Object.assign(Error('mock failure'),{code:'0A000'});
    if(sql.includes("current_setting('nile.tenant_id'"))return {rows:[{tenant_id:tenant}]};
    if(sql.includes('current_database()'))return {rows:[{db:dbName,ro}]};
    return {rows:[]};
  },release:discard=>released.push(discard)})}};
}
test('tenant established before guard; transaction always rolls back',async()=>{
  const f=pool();
  await withDevDiagnosticTransaction(context,async tx=>{assert.equal(tx.tenantId,profile);await tx.query('SELECT 1');},{env,db:f.db});
  assert.equal(f.calls[0],'BEGIN READ ONLY');
  assert.match(f.calls[1],/^SET LOCAL nile.tenant_id/);
  assert.equal(f.calls.at(-1),'ROLLBACK');
  assert.deepEqual(f.released,[false]);
});
test('wrong tenant, database, transaction mode or unsupported tenant setting never reaches callback',async()=>{
  for(const options of [{tenant:'wrong'},{dbName:'jobsearch_test'},{ro:'off'},{fail:'SET LOCAL nile.tenant_id'}]){
    const f=pool(options);
    await assert.rejects(withDevDiagnosticTransaction(context,async()=>assert.fail('callback entered'),{env,db:f.db}));
    assert.equal(f.calls.at(-1),'ROLLBACK');
  }
});
test('failed rollback discards pooled connection',async()=>{
  const f=pool({fail:'ROLLBACK'});
  await assert.rejects(withDevDiagnosticTransaction(context,async()=>{}, {env,db:f.db}),err=>err.diagnosticStage==='rollback');
  assert.deepEqual(f.released,[true]);
});


test('configured account readiness classifies observed account without disclosing identity or issuing a session',async()=>{
 const {observeDevNilePlan}=await import('../src/multiuser-repository.js');
 const user='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',base={user_id:user,profile_id:profile,role:'ADMIN',status:'ACTIVE',provisioned_at:'2026-11-01'};
 const run=async row=>{
  const calls=[];
  const db={connect:async()=>({query:async(sql,params)=>{
   calls.push(sql);
   if(sql==='BEGIN READ ONLY'||sql==='ROLLBACK'||sql.startsWith('SET LOCAL'))return {rows:[]};
   if(sql.includes('current_database()'))return {rows:[{db:'jobsearch_dev',ro:'on'}]};
   if(sql.includes('FROM app_user a')){assert.deepEqual(params,[user]);return {rows:row?[row]:[]};}
   if(sql.includes('FROM tenants')){assert.deepEqual(params,[profile]);return {rows:[{id:profile,name:'private'}]};}
   assert.fail(sql);
  },release:()=>{}})};
  const result=await observeDevNilePlan('account_readiness',null,{...env,JSCC_DEV_NILE_DIAGNOSTIC_USER_ID:user},{db});
  assert.equal(result.status,'COLLECTED');assert.equal(calls.at(-1),'ROLLBACK');
  assert.equal(JSON.stringify(result).includes(user),false);assert.equal(JSON.stringify(result).includes(profile),false);
  assert.equal(result.account.user_session_verified,false);
  return result.account.state;
 };
 assert.equal(await run(null),'NOT_FOUND');
 assert.equal(await run({...base,status:'DISABLED'}),'NOT_ACTIVE');
 assert.equal(await run({...base,provisioned_at:null}),'PROVISIONING_INCOMPLETE');
 assert.equal(await run({...base,deletion_started_at:'2026-11-01'}),'DELETION_PENDING');
 assert.equal(await run({...base,role:'USER'}),'ROLE_NOT_ADMITTED');
 assert.equal(await run(base),'READY');
});
