import test from 'node:test';
import assert from 'node:assert/strict';
import {planDevDeployment} from '../observation/dev-rollout-evaluator.mjs';
import {CATALOG_VERSION, validateTaskRequest, authenticatedEvidence, publicEvidence} from '../src/lib.mjs';

const service='jscc-ops-gateway-dev';
const digest='sha256:'+'a'.repeat(64), next='sha256:'+'b'.repeat(64);
const source='c'.repeat(40);
const live=()=>({
 environment:'dev',task:'describe_dev_runtime',
 resource:'projects/jscc-dev/locations/europe-west1/services/'+service,
 observed_at:'2026-11-05T00:00:00Z',
 effective_revisions:[{revision:service+'-00011-baw',percent:100,image_digest:digest}]
});

test('R3 deployment plan requires verified current image and never authorizes changes',()=>{
 assert.equal(CATALOG_VERSION,'589-r4-v1');
 const args={environment:'dev',service,
   expected_current_digest:digest,proposed_image_digest:next,expected_source_sha:source};
 assert.equal(validateTaskRequest('plan_dev_deployment',args).task_class,'OBSERVE');
 const result=planDevDeployment(live(),args);
 assert.equal(result.change_required,true);
 assert.equal(result.approval_required,true);
 assert.equal(result.deployment_authorized,false);
 assert.equal(result.preflight_verdict,'SOURCE_IMAGE_PROVENANCE_REQUIRED');
 assert.equal(result.source_image_link,'UNVERIFIED');
 assert.equal(result.expected_source_sha,source);
});

test('R3 no-change plan remains non-mutating and does not need deployment approval',()=>{
 const result=planDevDeployment(live(),{
   expected_current_digest:digest,proposed_image_digest:digest,expected_source_sha:source
 });
 assert.equal(result.change_required,false);
 assert.equal(result.approval_required,false);
 assert.equal(result.deployment_authorized,false);
 assert.equal(result.preflight_verdict,'ALREADY_AT_DIGEST');
});

test('R3 drift, split traffic and unknown digests fail preflight',()=>{
 for(const revisions of [
  [{revision:service+'-00011-baw',percent:100,image_digest:next}],
  [{revision:service+'-00011-baw',percent:50,image_digest:digest},
   {revision:service+'-00012-baw',percent:50,image_digest:next}],
  [{revision:service+'-00011-baw',percent:100,image_digest:'UNKNOWN'}]
 ]) {
  assert.throws(()=>planDevDeployment({...live(),effective_revisions:revisions},{
    expected_current_digest:digest,proposed_image_digest:next,expected_source_sha:source,
  }),/DEPLOYMENT_PRECONDITION_FAILED/);
 }
});

test('R3 invalid source, project, service and digest inputs fail closed',()=>{
 for(const request of [
  {environment:'prod',service,expected_current_digest:digest,proposed_image_digest:next,expected_source_sha:source},
  {environment:'dev',service:'jscc-test',expected_current_digest:digest,proposed_image_digest:next,expected_source_sha:source},
  {environment:'dev',service,expected_current_digest:'latest',proposed_image_digest:next,expected_source_sha:source},
  {environment:'dev',service,expected_current_digest:digest,proposed_image_digest:next,expected_source_sha:'main'},
  {environment:'dev',service,expected_current_digest:digest,proposed_image_digest:next,expected_source_sha:source,gcloud:'--project=jscc-prod'},
 ]) assert.throws(()=>validateTaskRequest('plan_dev_deployment',request));
 assert.throws(()=>planDevDeployment(live(),{
  expected_current_digest:digest,proposed_image_digest:next,expected_source_sha:'main'
 }),/invalid_source_sha/);
});

test('R3 deployment plan evidence is authenticated-only and cannot contain approval assertion',()=>{
 const plan=planDevDeployment(live(),{
  expected_current_digest:digest,proposed_image_digest:next,expected_source_sha:source
 });
 const result={operation_id:'op-test-1234567890',task:'plan_dev_deployment',
   assertions:{...plan,secret:'PRIVATE'}};
 const pub=publicEvidence(result).assertions;
 const auth=authenticatedEvidence(result).assertions;
 assert.equal(pub.proposed_image_digest,undefined);
 assert.equal(pub.expected_source_sha,undefined);
 assert.equal(auth.proposed_image_digest,next);
 assert.equal(auth.deployment_authorized,false);
 assert.equal(auth.secret,undefined);
});
