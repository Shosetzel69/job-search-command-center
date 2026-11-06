import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {submitDevOperation,validateDispatchRequest} from '../gateway/cloud-run-dispatch.mjs';
const sha='a'.repeat(40);
const patch=Buffer.from('diff --git a/ops/x b/ops/x\n+++ b/ops/x\n@@ -0,0 +1 @@\n+ok\n');
const request=()=>({action:'implement',idempotency_key:'test-run-12345',manifest:{repository:'Shosetzel69/job-search-command-center',base_sha:sha,branch:'dev/r12-executor',atc_id:'ATC-537-01',work_item_ref:'#537',patch_sha256:createHash('sha256').update(patch).digest('hex')},patch_base64:patch.toString('base64')});
test('reject client-supplied object or privilege controls',()=>{
 assert.throws(()=>validateDispatchRequest({...request(),patch_object:'executor-patches/fake.patch'}),/unexpected_request_field/);
 assert.throws(()=>validateDispatchRequest({...request(),actor_sub:'admin'}),/unexpected_request_field/);
});
test('reject mismatched patch before any reservation',async()=>{
 let calls=0;
 await assert.rejects(()=>submitDevOperation({...request(),manifest:{...request().manifest,patch_sha256:'f'.repeat(64)}},{actor:{sub:'x'},bucket:'jscc-dev-data',reserveOperation:async()=>{calls++;return {created:true}},recordOperation:async()=>{}}),/patch_digest_mismatch/);
 assert.equal(calls,0);
});
test('reject replay before any write',async()=>{
 let calls=0;
 await assert.rejects(()=>submitDevOperation(request(),{actor:{sub:'x'},bucket:'jscc-dev-data',reserveOperation:async()=>({created:false}),recordOperation:async()=>{calls++}}),/idempotency_conflict_or_replay/);
 assert.equal(calls,0);
});
test('never upload when no scoped authorization exists',async()=>{
 let calls=0;
 await assert.rejects(()=>submitDevOperation(request(),{actor:{sub:'x'},bucket:'jscc-dev-data',reserveOperation:async()=>({created:true}),recordOperation:async()=>{},authorizeAction:async()=>false,signingKey:'x'.repeat(40),githubToken:'none',fetchImpl:async()=>{calls++;throw Error('network')}}),/approval_actor_not_authorized/);
 assert.equal(calls,0);
});
