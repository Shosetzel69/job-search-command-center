// #589 R4: execute one prepackaged, SHA-bound, READ-ONLY diagnostic program.
// This is a typed Google Cloud API script, not a general gcloud/bash subprocess.
// The worker inherits only its existing DEV diagnostic identity.
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {
  DEV_DIAGNOSTIC_SCRIPT_ID, DEV_DIAGNOSTIC_SCRIPT_SHA256,
  validateTaskRequest,
} from '../src/lib.mjs';

const PLAN_URL=new URL('./dev-runtime-build-inventory-v1.json',import.meta.url);
const EXPECTED_STEPS=Object.freeze([
  {action:'describe_dev_runtime',project:'jscc-dev',api:'run.googleapis.com',method:'GET'},
  {action:'describe_dev_build',project:'jscc-shared',api:'cloudbuild.googleapis.com',method:'GET'},
]);
const DIGEST=/^sha256:[0-9a-f]{64}$/;

function verifiedPlan(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length>4096) throw new Error('SCRIPT_INVALID');
  const hash=createHash('sha256').update(bytes).digest('hex');
  if(hash!==DEV_DIAGNOSTIC_SCRIPT_SHA256) throw new Error('SCRIPT_INTEGRITY_BLOCKED');
  let data;
  try {data=JSON.parse(bytes.toString('utf8'));} catch {throw new Error('SCRIPT_INVALID');}
  if (data?.schema_version!=='1.0' || data.script_id!==DEV_DIAGNOSTIC_SCRIPT_ID ||
      data.environment!=='dev' || data.class!=='OBSERVE' || data.effects!=='none' ||
      data.approved_resource_policy!=='R1-B-FOUR-SERVICES-TWO-BUILDS' ||
      JSON.stringify(data.steps)!==JSON.stringify(EXPECTED_STEPS) ||
      Object.keys(data).length!==7) throw new Error('SCRIPT_INVALID');
  return data;
}

export async function executeDevGcloudScript(args, {
  observer, manifestBytes=readFileSync(PLAN_URL),
}={}) {
  // Defense in depth: worker revalidates all caller-controlled fields even
  // after the Gateway has validated and signed the bounded dispatch.
  const clean=validateTaskRequest('run_dev_gcloud_script',args).args;
  verifiedPlan(manifestBytes);
  if(!observer || typeof observer.describe!=='function') throw new Error('observer_required');

  // Fixed order, no redirects to arbitrary project or API, no shell expansion,
  // no shell, no dynamic command list and no Google Cloud mutation endpoints.
  const runtime=await observer.describe({
    environment:'dev',task:'describe_dev_runtime',service:clean.service,
  });
  const build=await observer.describe({
    environment:'dev',task:'describe_dev_build',buildId:clean.buildId,
  });

  const expectedResource='projects/jscc-dev/locations/europe-west1/services/'+clean.service;
  const expectedBuild='projects/jscc-shared/locations/europe-west1/builds/'+clean.buildId;
  if (runtime?.environment!=='dev' || runtime?.resource!==expectedResource ||
      build?.environment!=='dev' || build?.resource!==expectedBuild ||
      !Array.isArray(runtime.effective_revisions) ||
      runtime.effective_revisions.length<1 || runtime.effective_revisions.length>20 ||
      !Array.isArray(build.immutable_images) || build.immutable_images.length>10) {
    throw new Error('SCRIPT_EVIDENCE_MISMATCH');
  }
  const seen=new Set();
  for(const row of runtime.effective_revisions) {
    if (!row || typeof row.revision!=='string' ||
        !row.revision.startsWith(clean.service+'-') ||
        !/^[a-z0-9-]{6,100}$/.test(row.revision) ||
        !Number.isInteger(row.percent) || row.percent<0 || row.percent>100) {
      throw new Error('SCRIPT_EVIDENCE_MISMATCH');
    }
    if(row.percent>0) {
      if(seen.has(row.revision)) throw new Error('SCRIPT_EVIDENCE_MISMATCH');
      seen.add(row.revision);
    }
  }
  const serving=runtime.effective_revisions.filter(x=>x.percent>0);
  if(serving.length<1 || serving.reduce((n,x)=>n+x.percent,0)!==100) {
    throw new Error('SCRIPT_EVIDENCE_MISMATCH');
  }

  const buildDigests=new Set();
  for(const image of build.immutable_images) {
    if (!image || typeof image.image!=='string' ||
      !image.image.startsWith('europe-west1-docker.pkg.dev/jscc-shared/jscc-ops/') ||
      !/^[a-z0-9][a-z0-9._:\\/-]{1,150}$/.test(
        image.image.slice('europe-west1-docker.pkg.dev/jscc-shared/jscc-ops/'.length)) ||
      image.image.includes('..') ||
      !DIGEST.test(String(image.image_digest))) throw new Error('SCRIPT_EVIDENCE_MISMATCH');
    buildDigests.add(image.image_digest);
  }
  const runtimeDigests=serving.map(x=>x.image_digest);
  const scriptVerdict=build.build_status!=='SUCCESS' ? 'BUILD_NOT_SUCCESSFUL'
    : runtimeDigests.some(x=>!DIGEST.test(String(x))) ? 'RUNTIME_IMAGE_UNKNOWN'
    : buildDigests.size===0 ? 'BUILD_DIGEST_UNKNOWN'
    : runtimeDigests.every(d=>buildDigests.has(d)) ? 'RUNTIME_DIGEST_MATCHES_BUILD_OUTPUT'
    : 'RUNTIME_BUILD_DIGEST_MISMATCH';

  return Object.freeze({
    target_alias:clean.service,
    resource:expectedResource,
    script_id:DEV_DIAGNOSTIC_SCRIPT_ID,
    script_sha256:DEV_DIAGNOSTIC_SCRIPT_SHA256,
    script_step_count:2,
    script_verdict:scriptVerdict,
    runtime_service:clean.service,
    runtime_revision_count:serving.length,
    build_id:clean.buildId,
    build_status:build.build_status,
    script_source_provenance:'UNVERIFIED',
    target_source_sha:'UNKNOWN',
    observed_at:new Date().toISOString(),
  });
}
