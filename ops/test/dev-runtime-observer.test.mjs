import assert from 'node:assert/strict';
import test from 'node:test';
import { admitDevRequest, createDevObserver, DEV_OBSERVATION_TARGETS } from '../observation/dev-runtime-observer.mjs';

const service = 'jscc-dev-workspace-manager';
const servicePath = `projects/jscc-dev/locations/europe-west1/services/${service}`;
const rev1 = `${service}-00002-42q`;
const rev2 = `${service}-00001-lbp`;
const sha = 'a'.repeat(64);

function mock({ traffic = [{revision:rev1,percent:100}], fail = null,
                  mismatched = false, expose = false, latestReadyRevision = rev2,
                  sidecarFirst = false } = {}) {
  const requests = [];
  const transport = async request => {
    requests.push(request);
    if (fail !== null) return { status:fail, body:{error:'sensitive backend error'} };
    if (request.path.endsWith('/revisions/' + rev1)) {
      return { status:200, body:{
        name: servicePath+'/revisions/'+(mismatched?'bad':rev1),
        containers: [{name:'app',image:'repo/image:mutable-tag'}],
        containerStatuses:sidecarFirst ? [
          {name:'sidecar',imageDigest:'repo/sidecar@sha256:'+'c'.repeat(64)},
          {name:'app',imageDigest:'repo/image@sha256:'+sha}
        ] : [{name:'app',imageDigest:'repo/image@sha256:'+sha}],
        env:[{name:'SECRET',value:'not-for-client'}],
      }};
    }
    if (request.path.endsWith('/revisions/' + rev2)) {
      return { status:200, body:{
        name:servicePath+'/revisions/'+rev2,
        containers:[{name:'app',image:'repo/image:unpinned'}],
      }};
    }
    if (request.path.endsWith('/services/' + service)) {
      return { status:200, body:{
        name:servicePath, trafficStatuses:traffic,
        latestReadyRevision,
        template:{serviceAccount:'jscc-dev-workspace-manager@jscc-dev.iam.gserviceaccount.com',
          containers:[{env:[{name:'DB_PASSWORD',value:'leak'}]}]},
        env:[{name:'DB_PASSWORD',value:'leak'}],
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
  assert.equal(result.service_account,'jscc-dev-workspace-manager@jscc-dev.iam.gserviceaccount.com');
  assert.equal(result.environment_variable_count,1);
  assert.equal(result.observed_at,'2026-11-04T00:00:00Z');
  assert.equal(requests.length,2);
  assert.equal(JSON.stringify(result).includes('not-for-client'),false);
  assert.equal(JSON.stringify(result).includes('DB_PASSWORD'),false);
  assert.equal(JSON.stringify(result).includes('leak'),false);
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

test('image tag is never treated as proof of an immutable digest',async()=>{
 const {observer}=mock({traffic:[{revision:rev2,percent:100}]});
 const out=await observer.describe({environment:'dev',task:'describe_dev_runtime',service});
 assert.equal(out.effective_revisions[0].image_digest,'UNKNOWN');
});

test('F2: observed LATEST allocation resolves an omitted revision only from latestReadyRevision',async()=>{
 const {observer,requests}=mock({
   traffic:[{type:'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST',percent:100}],
 });
 const result=await observer.describe({environment:'dev',task:'describe_dev_runtime',service});
 assert.deepEqual(result.effective_revisions,[{
   revision:rev2,percent:100,resolved_from:'latest_ready',image_digest:'UNKNOWN'
 }]);
 assert.equal(requests.length,2);
 assert.equal(requests[1].path.endsWith('/revisions/'+rev2),true);
});

test('F2: explicit observed LATEST revision wins over latestReadyRevision',async()=>{
 const {observer}=mock({
   traffic:[{type:'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST',revision:rev1,percent:100}],
 });
 const result=await observer.describe({environment:'dev',task:'describe_dev_runtime',service});
 assert.deepEqual(result.effective_revisions,[{
   revision:rev1,percent:100,image_digest:'sha256:'+sha,
 }]);
});

test('F2: missing revision is never inferred for non-LATEST allocation',async()=>{
 for(const traffic of [
   [{type:'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION',percent:100}],
   [{percent:100}],
   [{type:'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST',revision:'projects/jscc-prod/locations/europe-west1/services/'+service+'/revisions/'+rev1,percent:100}],
 ]) {
  const {observer}=mock({traffic});
  await assert.rejects(()=>observer.describe({environment:'dev',task:'describe_dev_runtime',service}),
   /INSUFFICIENT_EVIDENCE/);
 }
});

test('F2: absent or foreign latest-ready revision fails closed',async()=>{
 for(const latestReadyRevision of [
   null,
   'projects/jscc-prod/locations/europe-west1/services/'+service+'/revisions/'+rev1,
 ]) {
  const {observer}=mock({
    traffic:[{type:'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST',percent:100}],
    latestReadyRevision,
  });
  await assert.rejects(()=>observer.describe({environment:'dev',task:'describe_dev_runtime',service}),
    /INSUFFICIENT_EVIDENCE/);
 }
});

test('F4: containerStatuses are joined by name, never by array order',async()=>{
 const {observer}=mock({sidecarFirst:true});
 const result=await observer.describe({environment:'dev',task:'describe_dev_runtime',service});
 assert.equal(result.effective_revisions[0].image_digest,'sha256:'+sha);
});
