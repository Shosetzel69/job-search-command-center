import test from 'node:test';import assert from 'node:assert/strict';
import {inspectNileAuthorization} from '../src/nile-admission.mjs';
const request={authorization_id:'valid_grant_identifier_123',expected_probe_sha:'a'.repeat(40)};
test('no trusted backend is fail-closed before any grant or usage lookup',async()=>{
 await assert.rejects(inspectNileAuthorization({request,actor:'actor',nowMs:Date.now()}),/nile_grant_backend_unavailable/);
});
test('untrusted grant records are rejected without consulting counters',async()=>{
 let counterCalled=false;
 await assert.rejects(inspectNileAuthorization({request,actor:'actor',nowMs:Date.now(),
 readGrant:async()=>({trusted:false}),readUsage:async()=>{counterCalled=true;return null;}}),/nile_grant_unverified/);
 assert.equal(counterCalled,false);
});
test('missing immutable generation or revocation check rejects',async()=>{
 for(const x of [{trusted:true,revocation_checked:true},{trusted:true,generation:'1',revocation_checked:false}])
 await assert.rejects(inspectNileAuthorization({request,actor:'actor',nowMs:Date.now(),
 readGrant:async()=>x,readUsage:async()=>({trusted:true,globalMutateUsed:0,globalOperationsUsed:0,grantUsed:0})}),/nile_grant_unverified/);
});
test('untrusted usage rejects without granting dispatch',async()=>{
 await assert.rejects(inspectNileAuthorization({request,actor:'actor',nowMs:Date.now(),
 readGrant:async()=>({trusted:true,generation:'12',revocation_checked:true,grant:{}}),
 readUsage:async()=>({trusted:false})}),/nile_usage_unverified/);
});
