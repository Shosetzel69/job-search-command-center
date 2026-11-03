import test from 'node:test';
import assert from 'node:assert/strict';
import {TASK_CATALOG,validateTaskRequest,publicEvidence,authenticatedEvidence} from '../src/lib.mjs';

test('R1 B reuses existing operation protocol with OBSERVE-only tasks',()=>{
 for(const task of ['describe_dev_runtime','describe_dev_build']){
  assert.equal(TASK_CATALOG[task].class,'OBSERVE');
 }
 const r=validateTaskRequest('describe_dev_runtime',{environment:'dev',service:'jscc-dev-workspace-manager'});
 assert.deepEqual(r,{task:'describe_dev_runtime',task_class:'OBSERVE',args:{environment:'dev',service:'jscc-dev-workspace-manager'}});
 const b=validateTaskRequest('describe_dev_build',{environment:'dev',buildId:'f38fa001-3681-42fd-bb8f-9ade6a8eeb8e'});
 assert.equal(b.args.buildId,'f38fa001-3681-42fd-bb8f-9ade6a8eeb8e');
});
test('R1 B rejects cross-project, unrecognized IDs, extra parameters',()=>{
 for(const request of [
  ['describe_dev_runtime',{environment:'prod',service:'jscc-dev-workspace-manager'}],
  ['describe_dev_runtime',{environment:'test',service:'jscc-dev-workspace-manager'}],
  ['describe_dev_runtime',{environment:'dev',service:'jscc-prod-api'}],
  ['describe_dev_runtime',{environment:'dev',service:'jscc-dev-workspace-manager',project:'jscc-prod'}],
  ['describe_dev_build',{environment:'dev',buildId:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'}],
 ])assert.throws(()=>validateTaskRequest(...request));
});
test('R1 B evidence projection does not return arbitrary worker-private response fields',()=>{
 const result={operation_id:'op-test-1234567890',task:'describe_dev_runtime',operation_state:'SUCCEEDED',
 assertions:{resource:'projects/jscc-dev/locations/europe-west1/services/jscc-dev-workspace-manager',
 effective_revisions_json:'[{"revision":"safe","percent":100,"image_digest":"UNKNOWN"}]',
 service_account:'UNKNOWN',observed_at:'2026-11-04T00:00:00Z',token:'SECRET'}};
 const publicResult=publicEvidence(result);
 const auth=authenticatedEvidence(result);
 assert.equal(publicResult.assertions.token,undefined);
 assert.equal(auth.assertions.token,undefined);
 assert.ok(auth.assertions.effective_revisions_json);
});
