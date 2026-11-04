import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {
  CATALOG_VERSION, DEV_DIAGNOSTIC_SCRIPT_ID, DEV_DIAGNOSTIC_SCRIPT_SHA256,
  TASK_CATALOG, validateTaskRequest, publicEvidence, authenticatedEvidence, validateDispatchBinding,
} from '../src/lib.mjs';
import {executeDevGcloudScript} from '../diagnostics/dev-gcloud-script-runner.mjs';

const service='jscc-dev-workspace-manager';
const buildId='c5bbfb85-0aab-40c7-aa47-a5589aa9e295';
const digest='sha256:'+'a'.repeat(64), another='sha256:'+'b'.repeat(64);
const manifest=readFileSync(new URL('../diagnostics/dev-runtime-build-inventory-v1.json',import.meta.url));
const args={
  environment:'dev',script_id:DEV_DIAGNOSTIC_SCRIPT_ID,
  script_sha256:DEV_DIAGNOSTIC_SCRIPT_SHA256,service,buildId,
};
const runtime=()=>({
  environment:'dev',task:'describe_dev_runtime',
  resource:'projects/jscc-dev/locations/europe-west1/services/'+service,
  effective_revisions:[{revision:service+'-00001-lbp',percent:100,image_digest:digest}],
});
const build=()=>({
  environment:'dev',task:'describe_dev_build',
  resource:'projects/jscc-shared/locations/europe-west1/builds/'+buildId,
  build_status:'SUCCESS',
  immutable_images:[{image:'europe-west1-docker.pkg.dev/jscc-shared/jscc-ops/jscc-ops-gateway:approved',
     image_digest:digest}],
});
function mock({onRuntime=runtime(),onBuild=build(),throwAt=null}={}) {
  const calls=[];
  const observer={
    describe: async request=>{
      calls.push(request);
      if(throwAt===request.task) throw new Error('PERMISSION_BLOCKED');
      return request.task==='describe_dev_runtime' ? onRuntime : onBuild;
    },
  };
  return {observer,calls};
}

test('R4 reviewed immutable script JSON is SHA-bound to exact catalog value',()=>{
 assert.equal(createHash('sha256').update(manifest).digest('hex'),DEV_DIAGNOSTIC_SCRIPT_SHA256);
 const parsed=JSON.parse(manifest.toString('utf8'));
 assert.equal(parsed.effects,'none');
 assert.deepEqual(parsed.steps.map(x=>x.method),['GET','GET']);
 assert.deepEqual(parsed.steps.map(x=>x.project),['jscc-dev','jscc-shared']);
 assert.equal(parsed.script_id,DEV_DIAGNOSTIC_SCRIPT_ID);
});

test('R4 catalog exposes only one typed OBSERVE script and retains diagnostics',()=>{
 assert.equal(CATALOG_VERSION,'589-r4-v1');
 assert.equal(TASK_CATALOG.run_dev_gcloud_script.class,'OBSERVE');
 assert.deepEqual(validateTaskRequest('run_dev_gcloud_script',args).args,args);
 for(const old of ['describe_execution','read_execution_logs','inspect_runtime_snapshot',
   'run_test_suite','describe_dev_runtime','describe_dev_build','inspect_dev_rollout',
   'plan_dev_deployment']) assert.ok(TASK_CATALOG[old]);
 assert.ok(!TASK_CATALOG.run_gcloud_shell);
});

test('R4 executes only two fixed read-only API observations in fixed order',async()=>{
 const {observer,calls}=mock();
 const result=await executeDevGcloudScript(args,{observer});
 assert.deepEqual(calls,[
  {environment:'dev',task:'describe_dev_runtime',service},
  {environment:'dev',task:'describe_dev_build',buildId},
 ]);
 assert.equal(result.script_id,DEV_DIAGNOSTIC_SCRIPT_ID);
 assert.equal(result.script_sha256,DEV_DIAGNOSTIC_SCRIPT_SHA256);
 assert.equal(result.script_step_count,2);
 assert.equal(result.script_verdict,'RUNTIME_DIGEST_MATCHES_BUILD_OUTPUT');
 assert.equal(result.runtime_revision_count,1);
 assert.equal(result.script_source_provenance,'UNVERIFIED');
 assert.equal(result.target_source_sha,'UNKNOWN');
 assert.equal(JSON.stringify(result).includes('approved'),false);
});

test('R4 build mismatch is reported, never interpreted as source proof',async()=>{
 const {observer}=mock({onBuild:{
   ...build(),immutable_images:[{image:'europe-west1-docker.pkg.dev/jscc-shared/jscc-ops/x:tag',image_digest:another}],
 }});
 const result=await executeDevGcloudScript(args,{observer});
 assert.equal(result.script_verdict,'RUNTIME_BUILD_DIGEST_MISMATCH');
 assert.equal(result.script_source_provenance,'UNVERIFIED');
});

test('R4 incomplete build and runtime metadata do not claim success',async()=>{
 for(const [runtimeData,buildData,expected] of [
   [runtime(),{...build(),build_status:'WORKING'},'BUILD_NOT_SUCCESSFUL'],
   [runtime(),{...build(),immutable_images:[]},'BUILD_DIGEST_UNKNOWN'],
   [{...runtime(),effective_revisions:[{revision:service+'-00001-lbp',percent:100,image_digest:'UNKNOWN'}]},
    build(),'RUNTIME_IMAGE_UNKNOWN'],
 ]) {
  const {observer}=mock({onRuntime:runtimeData,onBuild:buildData});
  assert.equal((await executeDevGcloudScript(args,{observer})).script_verdict,expected);
 }
});

test('R4 rejects script replacement and modified manifest before doing any API work',async()=>{
 for(const fake of [
  Buffer.concat([manifest,Buffer.from('\n')]),
  Buffer.from(manifest.toString('utf8').replace('"effects": "none"','"effects": "write"')),
 ]) {
  const {observer,calls}=mock();
  await assert.rejects(()=>executeDevGcloudScript(args,{observer,manifestBytes:fake}),/SCRIPT_INTEGRITY_BLOCKED/);
  assert.equal(calls.length,0);
 }
});

test('R4 blocks arbitrary scripts, missing approval-like keys, env mismatch and extra commands',()=>{
 const invalid=[
  {...args,environment:'test'},
  {...args,script_id:'any-shell'},
  {...args,script_sha256:'0'.repeat(64)},
  {...args,service:'jscc-prod'},
  {...args,buildId:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'},
  {...args,command:'gcloud projects add-iam-policy-binding'},
  {...args,script:'rm -rf /'},
 ];
 for(const request of invalid) assert.throws(()=>validateTaskRequest('run_dev_gcloud_script',request));
 assert.throws(()=>validateTaskRequest('run_dev_gcloud_script',{...args,script_sha256:undefined}));
});

test('R4 effective upstream 403 is a hard block, not a partial successful script',async()=>{
 for(const throwAt of ['describe_dev_runtime','describe_dev_build']) {
  const {observer,calls}=mock({throwAt});
  await assert.rejects(()=>executeDevGcloudScript(args,{observer}),/PERMISSION_BLOCKED/);
  assert.equal(calls.length,throwAt==='describe_dev_runtime'?1:2);
 }
});

test('R4 cross-project or mismatched evidence cannot be emitted as valid',async()=>{
 for(const overrides of [
  {onRuntime:{...runtime(),resource:'projects/jscc-prod/locations/europe-west1/services/'+service}},
  {onBuild:{...build(),resource:'projects/other/locations/europe-west1/builds/'+buildId}},
  {onRuntime:{...runtime(),effective_revisions:[{revision:service+'-x',percent:60,image_digest:digest}]}},
  {onRuntime:{...runtime(),effective_revisions:[]}},
  {onBuild:{...build(),immutable_images:[{image:'other-registry/x',image_digest:digest}]}},
 ]) {
  const {observer}=mock(overrides);
  await assert.rejects(()=>executeDevGcloudScript(args,{observer}),/SCRIPT_EVIDENCE_MISMATCH/);
 }
});

test('R4 sensitive source snippets and cloud substitutions never cross evidence projection',async()=>{
 const {observer}=mock({
  onBuild:{...build(),substitutions:{_SECRET:'cleartext'},token:'supersecret'},
  onRuntime:{...runtime(),env:[{name:'PASSWORD',value:'secret'}]},
 });
 const result=await executeDevGcloudScript(args,{observer});
 assert.equal(JSON.stringify(result).includes('cleartext'),false);
 assert.equal(JSON.stringify(result).includes('PASSWORD'),false);
 const evidence={operation_id:'op-test-1234567890',assertions:{
  target_alias:service,script_id:result.script_id,script_sha256:result.script_sha256,
  script_verdict:result.script_verdict,script_step_count:2,script_source_provenance:'UNVERIFIED',
  secret:'DO_NOT_LEAK',
 }};
 const pub=publicEvidence(evidence).assertions;
 const auth=authenticatedEvidence(evidence).assertions;
 assert.equal(pub.script_sha256,undefined);
 assert.equal(pub.script_verdict,undefined);
 assert.equal(auth.script_sha256,DEV_DIAGNOSTIC_SCRIPT_SHA256);
 assert.equal(auth.secret,undefined);
});

test('R4 old catalog dispatch cannot execute in new worker',()=>{
 const dispatch={execution_name:'jscc-diagnostics-dev-abcdef',
  catalog_version:'589-r3-v2',ops_source_sha:'a'.repeat(40),
  worker_image_digest:'sha256:'+'f'.repeat(64),expires_at_ms:Date.now()+50000};
 assert.throws(()=>validateDispatchBinding(dispatch,dispatch.execution_name,{
  catalog_version:CATALOG_VERSION,
  ops_source_sha:dispatch.ops_source_sha,worker_image_digest:dispatch.worker_image_digest,
 }),/catalog_version_mismatch/);
});

test('R4 worker image includes both script manifest and runner, not any gcloud SDK',()=>{
 const docker=readFileSync(new URL('../Dockerfile.worker',import.meta.url),'utf8');
 assert.match(docker,/COPY ops\/diagnostics\/dev-gcloud-script-runner\.mjs/);
 assert.match(docker,/COPY ops\/diagnostics\/dev-runtime-build-inventory-v1\.json/);
 assert.match(docker,/USER node/);
 assert.doesNotMatch(docker,/apt-get.*google-cloud-cli/);
});
