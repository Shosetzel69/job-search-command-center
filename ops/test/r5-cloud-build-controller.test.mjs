import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  planDevOpsBuild,validateDevOpsBuildInput,
  submitApprovedDevOpsBuild,validateBuildReceipt,projectDevBuildStatus,
} from '../build/dev-cloud-build-controller.mjs';
import {
  CATALOG_VERSION,TASK_CATALOG,validateTaskRequest,
  authenticatedEvidence,publicEvidence,validateDispatchBinding,
} from '../src/lib.mjs';

const source='a'.repeat(40), ref='refs/heads/main';
const id='c5bbfb85-0aab-40c7-aa47-a5589aa9e295';
const digest='sha256:'+'d'.repeat(64);
const input={environment:'dev',work_item_ref:'#589',source_sha:source,trusted_ref:ref};
const proof=(kind)=>({verified:true,kind,source_sha:source,trusted_ref:ref,work_item_ref:'#589'});

test('R5 exposes one read-only ops build plan; existing tasks and same connector preserved',()=>{
 assert.equal(CATALOG_VERSION,'589-r5-v1');
 assert.equal(TASK_CATALOG.plan_dev_ops_build.class,'OBSERVE');
 assert.deepEqual(validateTaskRequest('plan_dev_ops_build',{
   environment:'dev',source_sha:source,trusted_ref:ref,
 }).args,{environment:'dev',source_sha:source,trusted_ref:ref});
 for(const key of ['describe_execution','read_execution_logs','inspect_runtime_snapshot',
   'run_test_suite','describe_dev_runtime','describe_dev_build',
   'inspect_dev_rollout','plan_dev_deployment','run_dev_gcloud_script']) {
     assert.ok(TASK_CATALOG[key]);
   }
 assert.equal(TASK_CATALOG.submit_dev_ops_build,undefined);
});

test('R5 plan reuses fixed existing trusted build and says explicitly NOT AUTHORIZED',()=>{
 const out=planDevOpsBuild(input);
 assert.equal(out.project,'jscc-shared');
 assert.equal(out.region,'europe-west1');
 assert.equal(out.script,'scripts/gcp/build_remote_executor_dev.sh');
 assert.equal(out.config,'cloudbuild.ops.yaml');
 assert.equal(out.source_bucket,'jscc-shared-ops-cloudbuild-source');
 assert.equal(out.build_service_account,
   'projects/jscc-shared/serviceAccounts/jscc-ops-build@jscc-shared.iam.gserviceaccount.com');
 assert.equal(out.approval_verified,false);
 assert.equal(out.source_ref_verified,false);
 assert.equal(out.source_snapshot_verified,false);
 assert.equal(out.submission_enabled,false);
 assert.equal(out.estimated_incremental_cost,'UNVERIFIED');
});

test('R5 rejects untrusted source refs, TEST/PROD, arbitrary build config/flags and bad SHAs',()=>{
 for(const bad of [
  {...input,environment:'test'},
  {...input,environment:'prod'},
  {...input,source_sha:'main'},
  {...input,trusted_ref:'refs/heads/feature/589'},
  {...input,trusted_ref:'refs/tags/jscc-ops-approved/../escape'},
  {...input,trusted_ref:'refs/tags/jscc-ops-approved/a/b'},
  {...input,project:'jscc-prod'},
  {...input,command:'gcloud builds submit'},
  {...input,config:'evil.yaml'},
  {...input,work_item_ref:'foo'},
 ]) assert.throws(()=>planDevOpsBuild(bad));
 assert.equal(validateDevOpsBuildInput({
   ...input,trusted_ref:'refs/tags/jscc-ops-approved/r5-verified'
 }).trusted_ref,'refs/tags/jscc-ops-approved/r5-verified');
 assert.throws(()=>validateTaskRequest('plan_dev_ops_build',{
   environment:'dev',source_sha:source,trusted_ref:'refs/heads/random',
 }),/unapproved_source_ref/);
});

test('R5 cannot dispatch without trusted server-side admission callbacks',async()=>{
 await assert.rejects(()=>submitApprovedDevOpsBuild(input),/authorized_operator_not_configured/);
 let launches=0;
 const callbacks={
  verifyApproval:async()=>({verified:false,kind:'OWNER_APPROVAL'}),
  verifyTrustedRef:async()=>proof('TRUSTED_REF'),
  verifySourceSnapshot:async()=>({...proof('SOURCE_SNAPSHOT'),generation:'12',object_sha256:digest}),
  verifyCostAdmission:async()=>({...proof('COST_ADMISSION'),no_incremental_cost_proven:true}),
  dispatch:async()=>{launches++; return {build_id:id,project:'jscc-shared',region:'europe-west1',source_sha:source};},
 };
 await assert.rejects(()=>submitApprovedDevOpsBuild(input,callbacks),/OWNER_APPROVAL_not_verified/);
 assert.equal(launches,0);
});

test('R5 requires every proof and fail-closed cost before the sole fixed dispatch',async()=>{
 const cases=[
  {name:'TRUSTED_REF',change:{verifyTrustedRef:async()=>({...proof('TRUSTED_REF'),source_sha:'x'.repeat(40)})}},
  {name:'SOURCE_SNAPSHOT',change:{verifySourceSnapshot:async()=>({...proof('SOURCE_SNAPSHOT'),generation:'0',object_sha256:digest})}},
  {name:'COST_ADMISSION',change:{verifyCostAdmission:async()=>({...proof('COST_ADMISSION'),no_incremental_cost_proven:false})}},
 ];
 for(const c of cases) {
  let launches=0;
  const callbacks={
   verifyApproval:async()=>({...proof('OWNER_APPROVAL'),approval_ref:'#589/APPROVE_BUILD'}),
   verifyTrustedRef:async()=>proof('TRUSTED_REF'),
   verifySourceSnapshot:async()=>({...proof('SOURCE_SNAPSHOT'),generation:'12',object_sha256:digest}),
   verifyCostAdmission:async()=>({...proof('COST_ADMISSION'),no_incremental_cost_proven:true}),
   dispatch:async()=>{launches++;return {build_id:id,project:'jscc-shared',region:'europe-west1',source_sha:source};},
   ...c.change,
  };
  await assert.rejects(()=>submitApprovedDevOpsBuild(input,callbacks));
  assert.equal(launches,0,c.name+' must block dispatch');
 }
});

test('R5 authorized operator submits ONLY fixed existing build script, config and source',async()=>{
 const calls=[];
 const receipt=await submitApprovedDevOpsBuild(input,{
  verifyApproval:async(plan)=>{calls.push('approval'); return {...proof('OWNER_APPROVAL'),approval_ref:'#589/APPROVE_BUILD'};},
  verifyTrustedRef:async(plan)=>{calls.push('ref');return proof('TRUSTED_REF');},
  verifySourceSnapshot:async(plan)=>{calls.push('snapshot');return {...proof('SOURCE_SNAPSHOT'),
    generation:'12345',object_sha256:digest};},
  verifyCostAdmission:async(plan)=>{calls.push('cost');return {...proof('COST_ADMISSION'),
    no_incremental_cost_proven:true};},
  dispatch:async(x)=>{calls.push('dispatch');assert.deepEqual(x,{
   environment:'dev',work_item_ref:'#589',source_sha:source,trusted_ref:ref,
   script:'scripts/gcp/build_remote_executor_dev.sh',config:'cloudbuild.ops.yaml',
   project:'jscc-shared',region:'europe-west1',
   source_bucket:'jscc-shared-ops-cloudbuild-source',
   expected_build_service_account:'projects/jscc-shared/serviceAccounts/jscc-ops-build@jscc-shared.iam.gserviceaccount.com',
   approved_source_generation:'12345',approved_source_sha256:digest,
   approval_ref:'#589/APPROVE_BUILD',
  });return {build_id:id,project:'jscc-shared',region:'europe-west1',source_sha:source,
    approval_ref:'#589/APPROVE_BUILD'};},
 });
 assert.deepEqual(calls,['approval','ref','snapshot','cost','dispatch']);
 assert.equal(receipt.build_id,id);
 assert.equal(receipt.state,'SUBMITTED_UNVERIFIED');
 assert.equal(receipt.source_provenance,'UNVERIFIED');
 assert.equal(receipt.actor_approval_ref,'#589/APPROVE_BUILD');
});

test('R5 reject build receipt from a foreign project or source',()=>{
 for(const bad of [
  {build_id:id,project:'jscc-prod',region:'europe-west1',source_sha:source},
  {build_id:id,project:'jscc-shared',region:'global',source_sha:source},
  {build_id:id,project:'jscc-shared',region:'europe-west1',source_sha:'b'.repeat(40)},
  {build_id:'../secret',project:'jscc-shared',region:'europe-west1',source_sha:source},
 ]) assert.throws(()=>validateBuildReceipt(bad,planDevOpsBuild(input)),/build_receipt_mismatch/);
});

test('R5 track terminal SUCCESS with immutable images only and never infer source provenance',()=>{
 const expected={build_id:id,project:'jscc-shared',region:'europe-west1',source_sha:source};
 const raw={id,projectId:'jscc-shared',
  name:'projects/jscc-shared/locations/europe-west1/builds/'+id,
  status:'SUCCESS',source:{repoSource:{commitSha:'not-verified'}},
  substitutions:{_API_TOKEN:'do-not-leak'},
  results:{images:[
   {name:'europe-west1-docker.pkg.dev/jscc-shared/jscc-ops/jscc-ops-gateway:approved',digest},
   {name:'europe-west1-docker.pkg.dev/jscc-shared/other/secret:tag',digest},
   {name:'europe-west1-docker.pkg.dev/jscc-shared/jscc-ops/image:tag',digest:'mutable'},
  ]},
 };
 const state=projectDevBuildStatus(raw,expected);
 assert.equal(state.status,'SUCCESS');
 assert.equal(state.terminal,true);
 assert.equal(state.successful,true);
 assert.equal(state.source_provenance,'UNVERIFIED');
 assert.equal(state.immutable_image_count,1);
 assert.equal(state.images[0].digest,digest);
 assert.equal(JSON.stringify(state).includes('do-not-leak'),false);
 assert.equal(JSON.stringify(state).includes('not-verified'),false);
});

test('R5 distinguish queued, running, and failure; never produce images from failed builds',()=>{
 const expected={build_id:id,project:'jscc-shared',region:'europe-west1',source_sha:source};
 for(const [status,terminal,successful] of [
  ['PENDING',false,false],['QUEUED',false,false],['WORKING',false,false],
  ['TIMEOUT',true,false],['EXPIRED',true,false],['CANCELLED',true,false],['FAILURE',true,false],
  ['SUCCESS',true,true],
 ]) {
  const r=projectDevBuildStatus({
   id,projectId:'jscc-shared',name:'projects/jscc-shared/locations/europe-west1/builds/'+id,
   status,results:{images:[{name:'europe-west1-docker.pkg.dev/jscc-shared/jscc-ops/x:tag',digest}]},
  },expected);
  assert.equal(r.status,status);
  assert.equal(r.terminal,terminal);
  assert.equal(r.successful,successful);
  assert.equal(r.immutable_image_count,successful?1:0);
 }
});

test('R5 build status rejects untracked, foreign or tampered identity',()=>{
 const expected={build_id:id,project:'jscc-shared',region:'europe-west1',source_sha:source};
 const basic={id,projectId:'jscc-shared',
   name:'projects/jscc-shared/locations/europe-west1/builds/'+id,status:'SUCCESS'};
 for(const bad of [
  {...basic,id:'00000000-0000-0000-0000-000000000000'},
  {...basic,projectId:'jscc-prod'},
  {...basic,name:'projects/jscc-prod/locations/europe-west1/builds/'+id},
  {...basic,status:'UNKNOWN_USER_VALUE'},
  {...basic,results:{images:'arbitrary'}},
 ])assert.throws(()=>projectDevBuildStatus(bad,expected));
 assert.throws(()=>projectDevBuildStatus(basic,{...expected,project:'jscc-prod'}));
});

test('R5 build plan evidence is authenticated only and source plan is explicitly unverified',()=>{
 const plan=planDevOpsBuild(input);
 const x={operation_id:'op-test-1234567890',task:'plan_dev_ops_build',assertions:{
  requested_source_sha:plan.source_sha,trusted_ref:plan.trusted_ref,
  build_project:plan.project,submission_enabled:plan.submission_enabled,
  source_ref_verified:false,approval_verified:false,secret:'TOKEN',
 }};
 const pub=publicEvidence(x).assertions,auth=authenticatedEvidence(x).assertions;
 assert.equal(pub.trusted_ref,undefined);
 assert.equal(pub.requested_source_sha,undefined);
 assert.equal(auth.trusted_ref,ref);
 assert.equal(auth.submission_enabled,false);
 assert.equal(auth.secret,undefined);
});

test('R5 catalog bump rejects old R4 operations and bundles read-only planner',()=>{
 const dispatch={execution_name:'jscc-diagnostics-dev-abcdef',catalog_version:'589-r4-v1',
  ops_source_sha:source,worker_image_digest:digest,expires_at_ms:Date.now()+50000};
 assert.throws(()=>validateDispatchBinding(dispatch,dispatch.execution_name,{
  catalog_version:CATALOG_VERSION,ops_source_sha:source,worker_image_digest:digest,
 }),/catalog_version_mismatch/);
 const worker=readFileSync(new URL('../Dockerfile.worker',import.meta.url),'utf8');
 assert.match(worker,/COPY ops\/build\/dev-cloud-build-controller.mjs/);
 assert.match(worker,/USER node/);
});
