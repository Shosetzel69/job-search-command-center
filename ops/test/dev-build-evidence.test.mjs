import test from 'node:test';
import assert from 'node:assert/strict';
import {observeDevBuildArtifacts,observeOpsDelivery} from '../operator/dev_build_evidence.mjs';
import {projectOperatorResult,operatorHash,operatorPaths,operatorRequest,validateOperatorApproval} from '../src/dev_operator_contract.mjs';
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


test('ops delivery binds the original build to exact artifact and pair evidence without dispatch or acceptance claim',async()=>{
 const actor='f'.repeat(64),now=1700000000000,records=new Map(),buildRef='#589/21',artifactRef='#589/22',pairRef='#589/23';
 function put(ref,action,bundle,result){
  const a={schema_version:'1.0',environment:'dev',work_item_ref:'#589',approval_ref:ref,action,
   actor_sub_hash:actor,operator_source_sha:sha,bundle,bundle_hash:operatorHash(bundle),cost_ref:'#589/90',
   review_ref:'#589/91',issued_at_ms:now-1000,expires_at_ms:now+1000};
  const record={generation:'1',data:a},admitted=validateOperatorApproval(record,{ref,actor,sourceSha:sha,now});
  const paths=operatorPaths(ref),req=operatorRequest(admitted,now);
  records.set(paths.approval,record);records.set(paths.request,{generation:'2',data:req});
  if(result)records.set(paths.result,{generation:'3',data:{...result,operation_id:req.operation_id,approval_hash:req.approval_hash,action}});
 }
 put(buildRef,'build',{actor_sub_hash:actor,request:{source_sha:sha},archive:{generation:'123'},
  evidence:{approval:buildRef,cost:'#589/90',independent_review:'#589/91'}},{state:'SUBMITTED',build_id:id});
 put(artifactRef,'observe_build_artifacts',{original_approval_ref:buildRef},{...build,state:'OBSERVED',build_artifacts:{
  log_search_complete:true,correlation:'MATCHED_MARKERS',images:packages.map(p=>({package:p,digest,marker:'MATCH'}))}});
 const input={environment:'dev',source_sha:sha,build_approval_ref:buildRef,artifact_approval_ref:artifactRef,pair_approval_ref:null};
 const key='e'.repeat(64),pairBundle={operator_source_sha:sha,build_id:id,next:{source_sha:sha,gateway_digest:digest,worker_digest:digest},
  evidence:{approval:pairRef,cost:'#589/90',independent_review:'#589/91'}};
 const get=async path=>records.get(path)??null;
 const journal={generation:'4',identity:{key},record:{bundle:pairBundle,state:'SUCCEEDED',history:
  ['freeze','deploy_worker','deploy_gateway','verify_next','release'].map(step=>({step,outcome:'CONFIRMED'}))}};
 const options={actor,get,readPair:async()=>journal,observePair:async()=>({operation_id:key,state:'SUCCEEDED',
  live_pair:'PROPOSED_PAIR',protected_match:true,lease_state:'OWNED_RELEASED'})};
 const pending=await observeOpsDelivery(input,options);assert.equal(pending.ops_delivery.disposition,'PAIR_APPROVAL_REQUIRED');
 put(pairRef,'deploy_ops_pair',pairBundle,{state:'SUCCEEDED',controller_operation_id:key});
 const request={...input,pair_approval_ref:pairRef};
 const delivered=await observeOpsDelivery(request,options);
 assert.equal(delivered.ops_delivery.disposition,'INDEPENDENT_ACCEPTANCE_REQUIRED');
 assert.equal(delivered.ops_delivery.acceptance,'PENDING');assert.equal(delivered.ops_delivery.automatic_retry,false);
 const req={action:'observe_ops_delivery',operation_id:'op',approval_hash:'hash'};
 assert.deepEqual(projectOperatorResult(req,{generation:'1',data:{...req,...delivered}}).ops_delivery,delivered.ops_delivery);
 const drift=await observeOpsDelivery(request,{...options,observePair:async()=>({operation_id:key,state:'SUCCEEDED',
  live_pair:'MIXED_OR_DRIFT',protected_match:false,lease_state:'OWNED_RELEASED'})});
 assert.equal(drift.ops_delivery.disposition,'RECOVERY_REQUIRED');
 await assert.rejects(()=>observeOpsDelivery({...request,environment:'test'},options));
});
