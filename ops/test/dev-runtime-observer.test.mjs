import assert from 'node:assert/strict';
import test from 'node:test';
import { admitDevRequest, createDevObserver, DEV_OBSERVATION_TARGETS } from '../observation/dev-runtime-observer.mjs';

const service = 'jscc-dev-workspace-manager';
const servicePath = `projects/jscc-dev/locations/europe-west1/services/${service}`;
const rev1 = `${service}-00002-42q`;
const rev2 = `${service}-00001-lbp`;
const sha = 'a'.repeat(64);

function mock({ traffic = [{revision:rev1,percent:100}], fail = null,
                  mismatched = false, expose = false } = {}) {
  const requests = [];
  const transport = async request => {
    requests.push(request);
    if (fail !== null) return { status:fail, body:{error:'sensitive backend error'} };
    if (request.path.endsWith('/revisions/' + rev1)) {
      return { status:200, body:{
        name: servicePath+'/revisions/'+(mismatched?'bad':rev1),
        containers: [{image:'repo/image@sha256:'+sha}],
        env:[{name:'SECRET',value:'not-for-client'}],
      }};
    }
    if (request.path.endsWith('/revisions/' + rev2)) {
      return { status:200, body:{
        name:servicePath+'/revisions/'+rev2,
        containers:[{image:'repo/image:unpinned'}],
      }};
    }
    if (request.path.endsWith('/services/' + service)) {
      return { status:200, body:{
        name:servicePath, trafficStatuses:traffic,
        latestReadyRevision:rev2, env:[{name:'DB_PASSWORD',value:'leak'}],
      }};
    }
    if (request.path.includes('/builds/')) {
      const id=request.path.split('/').at(-1);
      return {status:200,body:{id,status:'SUCCESS',
        source:{repoSource:{commitSha:expose?'b'.repeat(40):'c'.repeat(40)}},
        secrets:['should-not-appear'] }};
    }
    return {status:404};
  };
  return { observer:createDevObserver({transport,now:()=> '2026-11-04T00:00:00Z'}), requests };
}
test('allowlist includes only four DEV services', () => {
  assert.equal(DEV_OBSERVATION_TARGETS.length,4);
  for (const name of DEV_OBSERVATION_TARGETS)
    assert.equal(admitDevRequest({environment:'dev',task:'describe_dev_runtime',service:name}).service,name);
});
test('deny TEST PROD and cross-project or mutation strings', () => {
  for (const environment of ['test','prod','DEV',undefined])
    assert.throws(()=>admitDevRequest({environment,task:'describe_dev_runtime',service}),/environment_denied/);
  for (const name of ['jscc-prod','jscc-test-foo','jscc-dev-workspace-manager/../foo',''])
    assert.throws(()=>admitDevRequest({environment:'dev',task:'describe_dev_runtime',service:name}),/resource_denied/);
  assert.throws(()=>admitDevRequest({environment:'dev',task:'run_gcloud',service}),/task_denied/);
  assert.throws(()=>admitDevRequest({environment:'dev',task:'describe_dev_runtime',service,project:'jscc-prod'}),/resource_denied/);
  assert.throws(()=>admitDevRequest({environment:'dev',task:'describe_dev_runtime',service,approval:'magic'}),/resource_denied/);
  assert.throws(()=>admitDevRequest({environment:'dev',task:'describe_dev_runtime',service,method:'POST'}),/resource_denied/);
  assert.throws(()=>admitDevRequest(null),/invalid_request/);
  assert.throws(()=>admitDevRequest({environment:'dev',task:'describe_dev_runtime',service,buildId:'x'}),/resource_denied/);
});
test('effective traffic not latest ready; image digest redacted and source unknown', async () => {
  const {observer,requests}=mock();
  const result=await observer.describe({environment:'dev',task:'describe_dev_runtime',service});
  assert.deepEqual(result.effective_revisions,[{revision:rev1,percent:100,image_digest:'sha256:'+sha}]);
  assert.equal(result.source_sha,'UNKNOWN');
  assert.equal(result.observed_at,'2026-11-04T00:00:00Z');
  assert.equal(requests.length,2);
  assert.equal(JSON.stringify(result).includes('not-for-client'),false);
});
test('multiple traffic revisions remain separate with unknown digest fail-closed',async()=>{
  const {observer}=mock({traffic:[{revision:rev1,percent:80},{revision:rev2,percent:20}]});
  const r=await observer.describe({environment:'dev',task:'describe_dev_runtime',service});
  assert.equal(r.effective_revisions.length,2);
  assert.equal(r.effective_revisions[1].image_digest,'UNKNOWN');
});
test('reject incomplete traffic and mismatching revision identity',async()=>{
  const bad=mock({traffic:[{revision:rev1,percent:90}]});
  await assert.rejects(()=>bad.observer.describe({environment:'dev',task:'describe_dev_runtime',service}),/INSUFFICIENT_EVIDENCE/);
  const mismatch=mock({mismatched:true});
  await assert.rejects(()=>mismatch.observer.describe({environment:'dev',task:'describe_dev_runtime',service}),/RESOURCE_MISMATCH/);
});
test('403 and 401 fail closed and never return raw upstream body',async()=>{
  for(const status of [401,403]){
    const {observer}=mock({fail:status});
    await assert.rejects(()=>observer.describe({environment:'dev',task:'describe_dev_runtime',service}),e=>e.message==='PERMISSION_BLOCKED');
  }
  const {observer}=mock({fail:503});
  await assert.rejects(()=>observer.describe({environment:'dev',task:'describe_dev_runtime',service}),/OBSERVATION_UNAVAILABLE/);
});
test('Cloud Build ID strict and output is sanitized',async()=>{
  const id='c5bbfb85-0aab-40c7-aa47-a5589aa9e295';
  const {observer,requests}=mock({expose:true});
  const response=await observer.describe({environment:'dev',task:'describe_dev_build',buildId:id});
  assert.equal(response.build_status,'SUCCESS');
  assert.equal(response.source_sha,'UNKNOWN');
  assert.equal(JSON.stringify(response).includes('secrets'),false);
  assert.deepEqual(requests[0],{api:'cloudbuild.googleapis.com',path:'/v1/projects/jscc-shared/locations/europe-west1/builds/'+id});
  assert.throws(()=>admitDevRequest({environment:'dev',task:'describe_dev_build',buildId:'../secrets'}),/resource_denied/);
});

test('desired traffic without observed traffic cannot be used as effective state', async () => {
  const id = `projects/jscc-dev/locations/europe-west1/services/${service}`;
  const observer = createDevObserver({transport: async()=>({status:200,body:{
    name:id,traffic:[{revision:rev1,percent:100}],latestReadyRevision:rev1,
  }})});
  await assert.rejects(()=>observer.describe({environment:'dev',task:'describe_dev_runtime',service}),
    /INSUFFICIENT_EVIDENCE/);
});
test('fully qualified Cloud Run revision names normalize without cross-project acceptance',async()=>{
  const qualified=`projects/jscc-dev/locations/europe-west1/services/${service}/revisions/${rev1}`;
  const {observer}=mock({traffic:[{revision:qualified,percent:100}]});
  const result=await observer.describe({environment:'dev',task:'describe_dev_runtime',service});
  assert.equal(result.effective_revisions[0].revision,rev1);
  const cross=`projects/jscc-prod/locations/europe-west1/services/${service}/revisions/${rev1}`;
  const {observer:blocked}=mock({traffic:[{revision:cross,percent:100}]});
  await assert.rejects(()=>blocked.describe({environment:'dev',task:'describe_dev_runtime',service}),
    /INSUFFICIENT_EVIDENCE/);
});
test('mismatched Cloud Build resource cannot be reported as a successful build',async()=>{
  const id='c5bbfb85-0aab-40c7-aa47-a5589aa9e295';
  const observer=createDevObserver({transport:async()=>({status:200,body:{id:'deadbeef-0aab-40c7-aa47-a5589aa9e295',status:'SUCCESS'}})});
  await assert.rejects(()=>observer.describe({environment:'dev',task:'describe_dev_build',buildId:id}),/RESOURCE_MISMATCH/);
});
