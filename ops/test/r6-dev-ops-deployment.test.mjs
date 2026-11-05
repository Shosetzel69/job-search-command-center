import test from 'node:test';
import assert from 'node:assert/strict';
import {planDevOpsPairDeployment,executeApprovedDevOpsPair}
 from '../control/dev-ops-pair-deployment.mjs';

const sha='a'.repeat(40), oldG='sha256:'+'b'.repeat(64),newG='sha256:'+'c'.repeat(64),
 oldW='sha256:'+'d'.repeat(64),newW='sha256:'+'e'.repeat(64);
const gatewayService='jscc-ops-gateway-dev';
const observedGateway=()=>({
 environment:'dev',task:'describe_dev_runtime',
 resource:'projects/jscc-dev/locations/europe-west1/services/'+gatewayService,
 observed_at:'2026-11-05T16:00:00Z',
 effective_revisions:[{revision:gatewayService+'-00011-baw',percent:100,image_digest:oldG}],
});
const workerJob=()=>({
 environment:'dev',
 resource:'projects/jscc-dev/locations/europe-west1/jobs/jscc-diagnostics-dev',
 effective_image_digest:oldW,image_resolution_verified:true,
});
const input=()=>({
 environment:'dev',work_item_ref:'#589',source_sha:sha,
 expected_current_gateway_digest:oldG,expected_current_worker_digest:oldW,
 proposed_gateway_digest:newG,proposed_worker_digest:newW,
 observed_gateway:observedGateway(),observed_worker:workerJob(),
});
const plan=()=>planDevOpsPairDeployment(input());
function approvedCallbacks(overrides={}) {
 const events=[];
 const original={
  verifyApproval:async()=>({kind:'OWNER_APPROVAL',verified:true,source_sha:sha,environment:'dev',work_item_ref:'#589',plan_hash:plan().plan_hash,approval_ref:'#589/APPROVE_DEPLOY'}),
  verifyImagePair:async()=>({kind:'IMMUTABLE_IMAGE_PAIR',verified:true,source_sha:sha,environment:'dev',work_item_ref:'#589',plan_hash:plan().plan_hash}),
  verifyCost:async()=>({kind:'COST_ADMISSION',verified:true,source_sha:sha,environment:'dev',work_item_ref:'#589',plan_hash:plan().plan_hash,no_incremental_cost_proven:true}),
  verifyCurrentState:async()=>({kind:'CURRENT_STATE',verified:true,source_sha:sha,environment:'dev',work_item_ref:'#589',plan_hash:plan().plan_hash,
    gateway_image:plan().previous.gateway_image,worker_image:plan().previous.worker_image}),
  freezeOps:async()=>{events.push('freeze');},
  deployWorker:async x=>{events.push('worker');assert.equal(x.resource,
    'projects/jscc-dev/locations/europe-west1/jobs/jscc-diagnostics-dev');},
  deployGateway:async x=>{events.push('gateway');assert.equal(x.resource,
    'projects/jscc-dev/locations/europe-west1/services/jscc-ops-gateway-dev');},
  verifyPair:async()=>({kind:'DEPLOYED_PAIR',verified:true,source_sha:sha,environment:'dev',work_item_ref:'#589',plan_hash:plan().plan_hash,
    gateway_image:plan().next.gateway_image,worker_image:plan().next.worker_image}),
  rollbackGateway:async()=>{events.push('rollback_gateway');},
  rollbackWorker:async()=>{events.push('rollback_worker');},
  unfreezeOps:async()=>{events.push('unfreeze');},
 };
 return {events,callbacks:{...original,...overrides}};
}

test('R6 plan pins paired existing ops resources and exact immutable image URIs',()=>{
 const p=plan();
 assert.equal(p.environment,'dev');
 assert.equal(p.deployer,'jscc-ops-deployer-dev@jscc-dev.iam.gserviceaccount.com');
 assert.equal(p.gateway_service,'jscc-ops-gateway-dev');
 assert.equal(p.diagnostics_job,'jscc-diagnostics-dev');
 assert.equal(p.previous.gateway_image,
 'europe-west1-docker.pkg.dev/jscc-shared/jscc-ops/jscc-ops-gateway@'+oldG);
 assert.equal(p.next.worker_image,
 'europe-west1-docker.pkg.dev/jscc-shared/jscc-ops/jscc-diagnostics@'+newW);
 assert.equal(p.deployment_authorized,false);
 assert.equal(p.source_image_link,'UNVERIFIED');
 assert.equal(p.zero_cost_proven,false);
 assert.deepEqual(p.sequence,['freeze_ops','deploy_worker','deploy_gateway','verify_pair','unfreeze_ops']);
});

test('R6 plan rejects drift and unproven worker Job image; no generic DEV service',()=>{
 for(const bad of [
  {...input(),environment:'prod'},
  {...input(),source_sha:'main'},
  {...input(),expected_current_gateway_digest:'latest'},
  {...input(),observed_worker:{...workerJob(),image_resolution_verified:false}},
  {...input(),observed_worker:{...workerJob(),effective_image_digest:newW}},
  {...input(),observed_gateway:{...observedGateway(),
    resource:'projects/jscc-prod/locations/europe-west1/services/jscc-ops-gateway-dev'}},
  {...input(),observed_gateway:{...observedGateway(),
    effective_revisions:[{revision:gatewayService+'-00011-baw',percent:80,image_digest:oldG}]}},
 ]) assert.throws(()=>planDevOpsPairDeployment(bad));
});

test('R6 no-op plan needs no mutation but never grants deploy access',()=>{
 const p=planDevOpsPairDeployment({...input(),
  proposed_gateway_digest:oldG,proposed_worker_digest:oldW});
 assert.equal(p.change_required,false);
 assert.equal(p.deployment_authorized,false);
 assert.equal(p.approval_required,false);
 assert.equal(p.verdict,'ALREADY_AT_DIGEST');
 await assert.rejects(()=>executeApprovedDevOpsPair(p,approvedCallbacks().callbacks),/invalid_pair_plan/);
});

test('R6 missing privileged callbacks denies changes without executing GCloud',async()=>{
 await assert.rejects(()=>executeApprovedDevOpsPair(plan()),/authorized_deployer_not_configured/);
 const {events,callbacks}=approvedCallbacks({
  verifyApproval:async()=>({kind:'OWNER_APPROVAL',verified:false,source_sha:sha,environment:'dev',work_item_ref:'#589',plan_hash:plan().plan_hash}),
 });
 await assert.rejects(()=>executeApprovedDevOpsPair(plan(),callbacks),/OWNER_APPROVAL_not_verified/);
 assert.deepEqual(events,[]);
});

test('R6 fail-closed cost and current-image drift before freeze',async()=>{
 for(const replacements of [
  {verifyCost:async()=>({kind:'COST_ADMISSION',verified:true,source_sha:sha,
    environment:'dev',no_incremental_cost_proven:false})},
  {verifyCurrentState:async()=>({kind:'CURRENT_STATE',verified:true,source_sha:sha,
    environment:'dev',gateway_image:'wrong',worker_image:plan().previous.worker_image})},
 ]) {
  const {events,callbacks}=approvedCallbacks(replacements);
  await assert.rejects(()=>executeApprovedDevOpsPair(plan(),callbacks));
  assert.deepEqual(events,[]);
 }
});

test('R6 success requires worker then gateway, paired verification then unfreeze',async()=>{
 const {events,callbacks}=approvedCallbacks();
 const r=await executeApprovedDevOpsPair(plan(),callbacks);
 assert.equal(r.state,'SUCCEEDED');
 assert.equal(r.pair_verified,true);
 assert.equal(r.rollback_attempted,false);
 assert.deepEqual(events,['freeze','worker','gateway','unfreeze']);
});

test('R6 gateway deploy failure triggers paired rollback and verification',async()=>{
 const {events,callbacks}=approvedCallbacks({
  deployGateway:async()=>{events.push('gateway');throw Error('deploy_failed');},
 });
 const r=await executeApprovedDevOpsPair(plan(),callbacks);
 assert.equal(r.state,'ROLLED_BACK');
 assert.equal(r.pair_verified,false);
 assert.equal(r.rollback_attempted,true);
 assert.equal(r.manual_intervention_required,false);
 assert.deepEqual(events,['freeze','worker','gateway','rollback_gateway','rollback_worker','unfreeze']);
});

test('R6 partial rollback failure retains freeze and reports manual intervention',async()=>{
 const {events,callbacks}=approvedCallbacks({
  deployWorker:async()=>{events.push('worker');throw Error('worker_partial_apply');},
  rollbackWorker:async()=>{events.push('rollback_worker');throw Error('rollback_403');},
 });
 const r=await executeApprovedDevOpsPair(plan(),callbacks);
 assert.equal(r.state,'ROLLBACK_BLOCKED');
 assert.equal(r.manual_intervention_required,true);
 assert.deepEqual(r.rollback_errors,['worker_rollback_failed']);
 assert.deepEqual(events,['freeze','worker','rollback_gateway','rollback_worker']);
});

test('R6 post-deployment verification mismatch restores both resources',async()=>{
 const {events,callbacks}=approvedCallbacks({
  verifyPair:async()=>({kind:'DEPLOYED_PAIR',verified:true,source_sha:sha,environment:'dev',work_item_ref:'#589',plan_hash:plan().plan_hash,
    gateway_image:plan().previous.gateway_image,worker_image:plan().next.worker_image}),
 });
 const r=await executeApprovedDevOpsPair(plan(),callbacks);
 assert.equal(r.state,'ROLLED_BACK');
 assert.deepEqual(events,['freeze','worker','gateway','rollback_gateway','rollback_worker','unfreeze']);
});

test('R6 owner proof cannot be replayed for a different image pair',async()=>{
 const {events,callbacks}=approvedCallbacks({
  verifyImagePair:async()=>({kind:'IMMUTABLE_IMAGE_PAIR',verified:true,source_sha:sha,
    environment:'dev',work_item_ref:'#589',plan_hash:'f'.repeat(64)}),
 });
 await assert.rejects(()=>executeApprovedDevOpsPair(plan(),callbacks),/IMMUTABLE_IMAGE_PAIR_not_verified/);
 assert.deepEqual(events,[]);
});

test('R6 failed freeze is uncertain: do not assume release, rollback or unfreeze',async()=>{
 const {events,callbacks}=approvedCallbacks({
  freezeOps:async()=>{events.push('freeze');throw Error('freeze_timeout');},
 });
 const x=await executeApprovedDevOpsPair(plan(),callbacks);
 assert.equal(x.state,'FREEZE_UNCERTAIN');
 assert.equal(x.manual_intervention_required,true);
 assert.equal(x.rollback_attempted,false);
 assert.deepEqual(events,['freeze']);
});

test('R6 untrusted resource replacement cannot hijack planned registry',async()=>{
 const p={...plan(),next:{...plan().next,gateway_image:'https://bad.invalid/foo@'+newG}};
 await assert.rejects(()=>executeApprovedDevOpsPair(p,approvedCallbacks().callbacks),/invalid_pair_plan/);
});
