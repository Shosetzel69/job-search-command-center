import test from 'node:test';
import assert from 'node:assert/strict';
import {assertNileGrantPolicy,validateNileProbeArguments} from '../src/nile-policy.mjs';
const SHA='a'.repeat(40), now=1_800_000_000_000;
function fixture() { return {
 authorization_id:'owner_authorization_123',actor:'human-owner-bound-actor',
 task:'run_nile_probe',suite:'nile-auth-concurrency',task_class:'MUTATE',
 probe_sha:SHA,job:'jscc-nile-tests-dev',database_alias:'jobsearch_temp',
 repository:'Shosetzel69/job-search-command-center',atc_id:'ATC-531-NILE-EXEC-01',
 catalog_version:'next-reviewed-version',worker_digest:'sha256:reviewed',
 provider_host:'verified-provider-host',provider_database_id:'verified-db-id',
 namespace:'owned-fixture-namespace',owner_authorization_ref:'owner-attestation',
 not_before_ms:now-60_000,expires_ms:now+600_000,revoked:false,max_uses:2,used:0
};}
const request={authorization_id:'owner_authorization_123',expected_probe_sha:SHA};
const context=()=>({grant:fixture(),request,actor:'human-owner-bound-actor',nowMs:now,globalMutateUsed:0,globalOperationsUsed:0});
test('fixed probe argument schema rejects SQL, target and arbitrary selectors',()=>{
 assert.deepEqual(validateNileProbeArguments(request),request);
 for(const extra of [{sql:'DROP TABLE x'},{database:'application_dev'},{task_class:'VERIFY'},{suite:'dev-health'},{url:'https://example.org'}])
 assert.throws(()=>validateNileProbeArguments({...request,...extra}),/invalid_probe_arguments/);
 assert.throws(()=>validateNileProbeArguments({...request,expected_probe_sha:'bad'}),/invalid_probe_sha/);
});
test('bound valid grant is accepted by pure policy (not dispatch)',()=>{
 assert.equal(assertNileGrantPolicy(context()).task_class,'MUTATE');
});
test('binding and context mismatch fail closed',()=>{
 for(const [k,v] of Object.entries({actor:'other',job:'jscc-diagnostics-dev',database_alias:'jobsearch_dev',task_class:'VERIFY',probe_sha:'b'.repeat(40),atc_id:'ATC-OTHER',repository:'other/repo',authorization_id:'other_authorization_123'})){
  const grant={...fixture(),[k]:v};
  assert.throws(()=>assertNileGrantPolicy({...context(),grant}),/grant_binding_mismatch/);
 }
 assert.throws(()=>assertNileGrantPolicy({...context(),actor:'other'}),/grant_binding_mismatch/);
});
test('revoked, expired, short-lived, exhausted and invalid counters fail closed',()=>{
 const variants=[
  {revoked:true},{expires_ms:now+299_999},{expires_ms:now+24*60*60*1000+1},{max_uses:6},
  {used:2},{used:-1},{not_before_ms:now+1}
 ];
 for(const patch of variants) assert.throws(()=>assertNileGrantPolicy({...context(),grant:{...fixture(),...patch}}));
 for(const caps of [{globalMutateUsed:5},{globalOperationsUsed:50},{globalMutateUsed:-1}])
 assert.throws(()=>assertNileGrantPolicy({...context(),...caps}),/daily_cap_exhausted/);
});
test('unreadable or missing grant bindings are rejected',()=>{
 for(const k of ['worker_digest','provider_database_id','namespace','owner_authorization_ref']){
  assert.throws(()=>assertNileGrantPolicy({...context(),grant:{...fixture(),[k]:''}}),/grant_binding_missing/);
 }
 assert.throws(()=>assertNileGrantPolicy({...context(),grant:null}),/grant_missing/);
});
