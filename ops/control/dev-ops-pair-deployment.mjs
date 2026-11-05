// #589 R6 — paired DEV ops deploy/rollback contract, source-only.
// Never call mutating Google APIs from the read-only diagnostic worker.
// This orchestrates *injected* owner-verified capabilities of the existing
// separately privileged ops deployer; no default credentials or transport.
import {planDevDeployment} from '../observation/dev-rollout-evaluator.mjs';
import {createHash} from 'node:crypto';
const SHA=/^[0-9a-f]{40}$/;
const DIGEST=/^sha256:[0-9a-f]{64}$/;
const SA='jscc-ops-deployer-dev@jscc-dev.iam.gserviceaccount.com';
const GATEWAY='jscc-ops-gateway-dev';
const JOB='jscc-diagnostics-dev';
const ROOT='europe-west1-docker.pkg.dev/jscc-shared/jscc-ops/';
const fingerprint=(x)=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const workItem=x=>typeof x==='string' && /^#[1-9][0-9]{0,5}$/.test(x);

function imageUri(kind,digest) {
  if(typeof digest!=='string' || !DIGEST.test(digest))throw new Error('invalid_image_digest');
  return ROOT+(kind==='gateway'?'jscc-ops-gateway':'jscc-diagnostics')+'@'+digest;
}

export function planDevOpsPairDeployment({
  environment,work_item_ref,source_sha,expected_current_gateway_digest,
  expected_current_worker_digest,proposed_gateway_digest,proposed_worker_digest,
  observed_gateway,observed_worker,
}) {
  if(environment!=='dev')throw new Error('environment_denied');
  if(!workItem(work_item_ref)) throw new Error('invalid_work_item_ref');
  if(typeof source_sha!=='string' || !SHA.test(source_sha))
    throw new Error('invalid_source_sha');
  const currentGateway=imageUri('gateway',expected_current_gateway_digest);
  const currentWorker=imageUri('worker',expected_current_worker_digest);
  const proposedGateway=imageUri('gateway',proposed_gateway_digest);
  const proposedWorker=imageUri('worker',proposed_worker_digest);
  if(!observed_gateway || observed_gateway.resource!==
      'projects/jscc-dev/locations/europe-west1/services/'+GATEWAY)
    throw new Error('gateway_observation_mismatch');
  const gw=planDevDeployment(observed_gateway,{
    expected_current_digest:expected_current_gateway_digest,
    proposed_image_digest:proposed_gateway_digest,
    expected_source_sha:source_sha,
  });
  // A Cloud Run Job is not a Cloud Run Service. Never infer the worker
  // image from service traffic, latest created revision, or an image tag.
  if(!observed_worker || observed_worker.environment!=='dev' ||
     observed_worker.resource!==
     'projects/jscc-dev/locations/europe-west1/jobs/'+JOB ||
     observed_worker.effective_image_digest!==expected_current_worker_digest ||
     observed_worker.image_resolution_verified!==true)
    throw new Error('worker_image_not_proven');
  if(currentGateway===proposedGateway && currentWorker===proposedWorker)
    return Object.freeze({
      environment:'dev',work_item_ref,source_sha,change_required:false,
      previous:{gateway_image:currentGateway,worker_image:currentWorker},
      next:{gateway_image:proposedGateway,worker_image:proposedWorker},
      deployment_authorized:false,approval_required:false,
      verdict:'ALREADY_AT_DIGEST',
    });
  const binding={
    environment:'dev',work_item_ref,source_sha,
    previous:{gateway_image:currentGateway,worker_image:currentWorker},
    next:{gateway_image:proposedGateway,worker_image:proposedWorker},
    deployer:SA,gateway_service:GATEWAY,diagnostics_job:JOB,
  };
  return Object.freeze({
    ...binding,plan_hash:fingerprint(binding),change_required:true,
    sequence:['freeze_ops','deploy_worker','deploy_gateway','verify_pair','unfreeze_ops'],
    deployment_authorized:false,approval_required:true,
    source_image_link:'UNVERIFIED',zero_cost_proven:false,
    verdict:'OWNER_APPROVAL_AND_IMAGE_PAIR_PROVENANCE_REQUIRED',
  });
}

function checkProof(value,kind,plan) {
  if(!value || value.verified!==true || value.kind!==kind ||
     value.source_sha!==plan.source_sha || value.environment!=='dev' ||
     value.work_item_ref!==plan.work_item_ref || value.plan_hash!==plan.plan_hash)
    throw new Error(kind+'_not_verified');
}

export async function executeApprovedDevOpsPair(plan,{
  verifyApproval,verifyImagePair,verifyCost,verifyCurrentState,
  freezeOps,deployWorker,deployGateway,verifyPair,
  rollbackGateway,rollbackWorker,unfreezeOps,
}={}) {
  if(!plan || plan.environment!=='dev' || !plan.change_required ||
     plan.verdict!=='OWNER_APPROVAL_AND_IMAGE_PAIR_PROVENANCE_REQUIRED' ||
     plan.deployer!==SA || plan.gateway_service!==GATEWAY || plan.diagnostics_job!==JOB ||
     !workItem(plan.work_item_ref) ||
     typeof plan.source_sha!=='string' || !SHA.test(plan.source_sha) ||
     plan.plan_hash!==fingerprint({
       environment:'dev',work_item_ref:plan.work_item_ref,source_sha:plan.source_sha,
       previous:plan.previous,next:plan.next,deployer:SA,
       gateway_service:GATEWAY,diagnostics_job:JOB,
     }) ||
     plan.previous?.gateway_image!==imageUri('gateway',plan.previous?.gateway_image?.split('@').at(-1)) ||
     plan.previous?.worker_image!==imageUri('worker',plan.previous?.worker_image?.split('@').at(-1)) ||
     plan.next?.gateway_image!==imageUri('gateway',plan.next?.gateway_image?.split('@').at(-1)) ||
     plan.next?.worker_image!==imageUri('worker',plan.next?.worker_image?.split('@').at(-1)))
    throw new Error('invalid_pair_plan');
  const callbacks=[
    verifyApproval,verifyImagePair,verifyCost,verifyCurrentState,
    freezeOps,deployWorker,deployGateway,verifyPair,
    rollbackGateway,rollbackWorker,unfreezeOps,
  ];
  if(callbacks.some(fn=>typeof fn!=='function'))throw new Error('authorized_deployer_not_configured');
  // Verify all evidence BEFORE touching either Cloud Run resource.
  const approval=await verifyApproval(plan);
  checkProof(approval,'OWNER_APPROVAL',plan);
  if(typeof approval.approval_ref!=='string' ||
     !/^#[1-9][0-9]{0,5}\/[a-zA-Z0-9._-]{1,100}$/.test(approval.approval_ref) ||
     !approval.approval_ref.startsWith(plan.work_item_ref+'/'))
    throw new Error('owner_approval_reference_missing');
  checkProof(await verifyImagePair(plan),'IMMUTABLE_IMAGE_PAIR',plan);
  const cost=await verifyCost(plan);
  checkProof(cost,'COST_ADMISSION',plan);
  if(cost.no_incremental_cost_proven!==true)throw new Error('incremental_cost_not_proven');
  const live=await verifyCurrentState(plan);
  checkProof(live,'CURRENT_STATE',plan);
  if(live.gateway_image!==plan.previous.gateway_image ||
     live.worker_image!==plan.previous.worker_image)
    throw new Error('deployment_state_drift');
  const done=[];
  let frozen=false,freezeAttempted=false;
  try {
    freezeAttempted=true;
    await freezeOps(plan);
    frozen=true;
    await deployWorker({
      resource:'projects/jscc-dev/locations/europe-west1/jobs/'+JOB,
      image:plan.next.worker_image,source_sha:plan.source_sha,
      service_account:'jscc-diagnostics-dev@jscc-dev.iam.gserviceaccount.com',
    });
    done.push('worker');
    await deployGateway({
      resource:'projects/jscc-dev/locations/europe-west1/services/'+GATEWAY,
      image:plan.next.gateway_image,source_sha:plan.source_sha,
      service_account:'jscc-ops-gateway-dev@jscc-dev.iam.gserviceaccount.com',
    });
    done.push('gateway');
    const verified=await verifyPair(plan);
    checkProof(verified,'DEPLOYED_PAIR',plan);
    if(verified.gateway_image!==plan.next.gateway_image ||
       verified.worker_image!==plan.next.worker_image)
      throw new Error('deployment_verification_mismatch');
    await unfreezeOps(plan);
    frozen=false;
    return Object.freeze({state:'SUCCEEDED',environment:'dev',source_sha:plan.source_sha,
      pair_verified:true,rollback_attempted:false});
  } catch(e) {
    if(freezeAttempted && !frozen) return Object.freeze({
      state:'FREEZE_UNCERTAIN',environment:'dev',source_sha:plan.source_sha,
      pair_verified:false,rollback_attempted:false,manual_intervention_required:true,
      coarse_error:'freeze_outcome_unknown',rollback_errors:[],
    });
    // A remote call may have mutated its resource before throwing. Always
    // attempt rollback of BOTH elements after entering the mutation phase.
    const errors=[];
    if(frozen) {
      try {
        await rollbackGateway({
          resource:'projects/jscc-dev/locations/europe-west1/services/'+GATEWAY,
          image:plan.previous.gateway_image,
        });
      } catch {errors.push('gateway_rollback_failed');}
      try {
        await rollbackWorker({
          resource:'projects/jscc-dev/locations/europe-west1/jobs/'+JOB,
          image:plan.previous.worker_image,
        });
      } catch {errors.push('worker_rollback_failed');}
      // DO NOT unfreeze if a rollback was incomplete.
      if(!errors.length) {
        try {
          const restored=await verifyCurrentState(plan);
          checkProof(restored,'CURRENT_STATE',plan);
          if(restored.gateway_image!==plan.previous.gateway_image ||
             restored.worker_image!==plan.previous.worker_image)
            throw new Error('rollback_evidence_mismatch');
          await unfreezeOps(plan);
          frozen=false;
        } catch {errors.push('rollback_verification_failed');}
      }
    }
    return Object.freeze({
      state:errors.length?'ROLLBACK_BLOCKED':'ROLLED_BACK',
      environment:'dev',source_sha:plan.source_sha,
      pair_verified:false,rollback_attempted:frozen||done.length>0,
      manual_intervention_required:errors.length>0,
      coarse_error:errors.length?'rollback_incomplete':'deployment_failed',
      rollback_errors:errors,
    });
  }
}
