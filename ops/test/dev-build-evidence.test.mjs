import test from 'node:test';
import assert from 'node:assert/strict';
import {observeDevBuildArtifacts} from '../operator/dev_build_evidence.mjs';
import {projectOperatorResult} from '../src/dev_operator_contract.mjs';
const sha='a'.repeat(40),digest='sha256:'+'b'.repeat(64),id='254d3513-9c02-4f33-a974-e8e8f8935aa7';
const root='europe-west1-docker.pkg.dev/jscc-shared/jscc-ops/';
const packages=['jscc-ops-gateway','jscc-diagnostics','jscc-ops-operator','jscc-ops-publisher'];
const original={request:{source_sha:sha}};
const build={state:'SUCCEEDED',build_id:id,build_observation:{source_sha:sha,archive_generation:'123',
 archive_binding:'RESOLVED_MATCH',build_status:'SUCCESS',immutable_image_count:0,steps:[]}};
const entry=textPayload=>({resource:{type:'build',labels:{project_id:'jscc-shared',build_id:id}},
 logName:'projects/jscc-shared/logs/cloudbuild',textPayload});
const marker=p=>'Step #14 - "evidence": OPS_IMAGE='+root+p+':'+sha+'@'+digest;
const opts={observe:async()=>build,metadata:async input=>({state:'OBSERVED',metadata:{
 kind:'artifact_tag',package:input.package,source_sha:input.source_sha,immutable_tags:true,digest,uri:root+input.package+'@'+digest}})};
test('correlates exact original build and immutable registry tags with paginated fixed markers only',async()=>{
 let pages=0;
 const result=await observeDevBuildArtifacts(original,{...opts,fetchImpl:async(url,init)=>{
  assert.equal(url,'https://logging.googleapis.com/v2/entries:list');
  const q=JSON.parse(init.body);assert.ok(q.filter.includes(id));assert.equal(q.resourceNames.length,1);
  assert.match(q.resourceNames[0],/\/views\/jscc-ops-build-dev$/);
  if(++pages===1)return Response.json({entries:[entry(marker(packages[0])),entry('private-output')],nextPageToken:'next'});
  assert.equal(q.pageToken,'next');return Response.json({entries:packages.slice(1).map(p=>entry(marker(p)))});
 }});
 assert.equal(result.build_artifacts.correlation,'MATCHED_MARKERS');assert.equal(result.source_provenance,'UNVERIFIED');
 assert.equal(JSON.stringify(result).includes('private-output'),false);
 const req={action:'observe_build_artifacts',operation_id:'x',approval_hash:'y'};
 assert.deepEqual(projectOperatorResult(req,{generation:'1',data:{...result,...req}}).build_artifacts,result.build_artifacts);
});
test('missing logs, mismatch and denied access never become source provenance',async()=>{
 for(const [response,expected] of [[Response.json({entries:[]}), 'INCOMPLETE'],
  [Response.json({entries:[entry(marker(packages[0]).replace(digest,'sha256:'+'c'.repeat(64)))]}),'MISMATCH'],
  [new Response(null,{status:403}),'LOG_ACCESS_DENIED']]){
  const out=await observeDevBuildArtifacts(original,{...opts,fetchImpl:async()=>response});
  assert.equal(out.build_artifacts.correlation,expected);assert.equal(out.source_provenance,'UNVERIFIED');
 }
 await assert.rejects(()=>observeDevBuildArtifacts(original,{...opts,fetchImpl:async()=>Response.json({
  entries:[{...entry(marker(packages[0])),resource:{type:'build',labels:{project_id:'other',build_id:id}}}]})}),/binding_mismatch/);
});
