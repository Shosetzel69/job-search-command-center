// #589 R5 — single-connector, DEV-only Cloud Build controller contract.
// No Cloud APIs, child processes or credentials in this module. Only an independently
// authorized operator may inject a privileged dispatch. The diagnostics worker only
// calls planDevOpsBuild(), which is a pure read-only operation.
const PROJECT='jscc-shared';
const REGION='europe-west1';
const BUILD_SCRIPT='scripts/gcp/build_remote_executor_dev.sh';
const BUILD_CONFIG='cloudbuild.ops.yaml';
const BUILDER='projects/jscc-shared/serviceAccounts/jscc-ops-build@jscc-shared.iam.gserviceaccount.com';
const SOURCE_BUCKET='jscc-shared-ops-cloudbuild-source';
const SHA40=/^[0-9a-f]{40}$/;
const BUILD_ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DIGEST=/^sha256:[0-9a-f]{64}$/;
const TERMINAL=new Set(['SUCCESS','FAILURE','CANCELLED','EXPIRED','INTERNAL_ERROR','TIMEOUT']);
const PENDING=new Set(['STATUS_UNKNOWN','PENDING','QUEUED','WORKING']);

export function validateDevOpsBuildInput(input) {
  if(!input || typeof input!=='object' || Array.isArray(input) ||
     Object.keys(input).some(k=>!['environment','work_item_ref','source_sha','trusted_ref'].includes(k)) ||
     Object.keys(input).length!==4) throw new Error('invalid_build_request');
  const {environment,work_item_ref,source_sha,trusted_ref}=input;
  if(environment!=='dev') throw new Error('environment_denied');
  if(typeof work_item_ref!=='string' || !/^#[1-9][0-9]{0,5}$/.test(work_item_ref))
    throw new Error('invalid_work_item_ref');
  if(typeof source_sha!=='string' || !SHA40.test(source_sha)) throw new Error('invalid_source_sha');
  if(trusted_ref!=='refs/heads/main' &&
     !(typeof trusted_ref==='string' &&
       /^refs\/tags\/jscc-ops-approved\/[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(trusted_ref) &&
       !trusted_ref.includes('..'))) throw new Error('unapproved_source_ref');
  return Object.freeze({environment,work_item_ref,source_sha,trusted_ref});
}

export function planDevOpsBuild(input) {
  const x=validateDevOpsBuildInput(input);
  return Object.freeze({
    ...x,
    project:PROJECT,region:REGION,script:BUILD_SCRIPT,config:BUILD_CONFIG,
    build_service_account:BUILDER,source_bucket:SOURCE_BUCKET,
    image_registry:'europe-west1-docker.pkg.dev/jscc-shared/jscc-ops',
    script_is_existing:true,
    source_ref_verified:false,source_snapshot_verified:false,
    approval_verified:false,submission_enabled:false,
    required_gate:'OWNER_APPROVAL_AND_TRUSTED_SOURCE_AND_AUTHORIZED_OPERATOR',
    estimated_incremental_cost:'UNVERIFIED',
  });
}

function verifiedProof(value, kind, plan) {
  // An "approved" string supplied by an MCP client is NOT proof.
  // Trusted callback verifies authoritative GitHub/approval records itself.
  if (!value || value.verified!==true || value.kind!==kind ||
      value.work_item_ref!==plan.work_item_ref || value.source_sha!==plan.source_sha ||
      value.trusted_ref!==plan.trusted_ref) throw new Error(kind+'_not_verified');
}

export function validateBuildReceipt(receipt, plan) {
  if(!receipt || typeof receipt!=='object' || Array.isArray(receipt))
    throw new Error('build_receipt_invalid');
  const id=receipt.build_id, project=receipt.project, region=receipt.region;
  if(typeof id!=='string'||!BUILD_ID.test(id) || project!==PROJECT || region!==REGION ||
     receipt.source_sha!==plan.source_sha) throw new Error('build_receipt_mismatch');
  return Object.freeze({
    build_id:id,project,region,source_sha:plan.source_sha,
    state:'SUBMITTED_UNVERIFIED',source_provenance:'UNVERIFIED',
    actor_approval_ref:typeof receipt.approval_ref==='string' &&
      /^#[1-9][0-9]{0,5}\/[a-zA-Z0-9._-]{1,100}$/.test(receipt.approval_ref)
      ? receipt.approval_ref : null,
  });
}

export async function submitApprovedDevOpsBuild(input, {
  verifyApproval,verifyTrustedRef,verifySourceSnapshot,verifyCostAdmission,dispatch,
}={}) {
  const plan=planDevOpsBuild(input);
  // No callback -> no submission. Never infer permission from a Google OAuth token.
  const gates=[verifyApproval,verifyTrustedRef,verifySourceSnapshot,verifyCostAdmission,dispatch];
  if(gates.some(fn=>typeof fn!=='function')) throw new Error('authorized_operator_not_configured');
  const approval=await verifyApproval(plan);
  verifiedProof(approval,'OWNER_APPROVAL',plan);
  if(typeof approval.approval_ref!=='string' ||
     !/^#[1-9][0-9]{0,5}\/[a-zA-Z0-9._-]{1,100}$/.test(approval.approval_ref))
    throw new Error('owner_approval_reference_missing');
  const ref=await verifyTrustedRef(plan);
  verifiedProof(ref,'TRUSTED_REF',plan);
  const archive=await verifySourceSnapshot(plan);
  verifiedProof(archive,'SOURCE_SNAPSHOT',plan);
  if(typeof archive.generation!=='string' || !/^[1-9][0-9]{0,19}$/.test(archive.generation) ||
      typeof archive.object_sha256!=='string' || !DIGEST.test(archive.object_sha256))
    throw new Error('source_snapshot_unverifiable');
  const cost=await verifyCostAdmission(plan);
  verifiedProof(cost,'COST_ADMISSION',plan);
  if(cost.no_incremental_cost_proven!==true)
    throw new Error('incremental_cost_not_proven');
  // Dispatch receives ONLY fixed source/script/config; never a caller-supplied
  // shell/gcloud argv, project, build config, service account or credentials.
  const receipt=await dispatch(Object.freeze({
    environment:'dev',work_item_ref:plan.work_item_ref,
    source_sha:plan.source_sha,trusted_ref:plan.trusted_ref,
    script:BUILD_SCRIPT,config:BUILD_CONFIG,
    project:PROJECT,region:REGION,source_bucket:SOURCE_BUCKET,
    expected_build_service_account:BUILDER,
    approved_source_generation:archive.generation,
    approved_source_sha256:archive.object_sha256,
    approval_ref:approval.approval_ref,
  }));
  return validateBuildReceipt(receipt,plan);
}

export function projectDevBuildStatus(raw, expected) {
  if(!expected || typeof expected!=='object' || !BUILD_ID.test(String(expected.build_id)) ||
      expected.project!==PROJECT || expected.region!==REGION ||
      typeof expected.source_sha!=='string' || !SHA40.test(expected.source_sha))
    throw new Error('build_tracking_not_authorized');
  const build=raw;
  if(!build || typeof build!=='object' || Array.isArray(build) ||
     build.id!==expected.build_id ||
     (build.projectId !== undefined && build.projectId!==PROJECT) ||
     build.name!==`projects/${PROJECT}/locations/${REGION}/builds/${expected.build_id}`)
    throw new Error('build_identity_mismatch');
  const status=build.status;
  if(!TERMINAL.has(status) && !PENDING.has(status)) throw new Error('unknown_build_status');
  const images=[];
  if(status==='SUCCESS') {
    const source=build.results?.images;
    if(source !== undefined && (!Array.isArray(source) || source.length>20))
      throw new Error('invalid_build_images');
    for(const item of source||[]) {
      if(typeof item?.name!=='string' ||
         !/^europe-west1-docker\.pkg\.dev\/jscc-shared\/jscc-ops\/[a-z0-9][a-z0-9._:-]{1,150}$/.test(item.name) ||
         typeof item.digest!=='string' || !DIGEST.test(item.digest)) continue;
      if(images.length>=10) throw new Error('invalid_build_images');
      images.push(Object.freeze({image:item.name,digest:item.digest}));
    }
  }
  return Object.freeze({
    environment:'dev',project:PROJECT,region:REGION,build_id:expected.build_id,
    requested_source_sha:expected.source_sha,status,
    terminal:TERMINAL.has(status),
    successful:status==='SUCCESS',
    images,immutable_image_count:images.length,
    // Cloud Build status alone does not prove its input archive was the requested SHA.
    source_provenance:'UNVERIFIED',
    failure_class: status==='FAILURE' || status==='INTERNAL_ERROR' ||
      status==='TIMEOUT' || status==='EXPIRED' ? status : null,
  });
}
