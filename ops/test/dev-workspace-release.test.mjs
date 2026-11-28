import test from 'node:test';
import assert from 'node:assert/strict';
import {observeWorkspaceRelease,executeWorkspaceReleaseStep,cleanupWorkspaceRevision,observeWorkspaceDelivery} from '../operator/dev_workspace_release.mjs';
import {projectOperatorResult,validateWorkspaceReleaseBundle,validateWorkspaceDelivery} from '../src/dev_operator_contract.mjs';
const sha='a'.repeat(40),root='projects/jscc-dev/locations/europe-west1',registry='europe-west1-docker.pkg.dev/jscc-shared/jscc-ops/';
const service={manager:'jscc-dev-workspace-manager',worker:'jscc-dev-sandbox-worker'};
const packages={manager:'jscc-dev-workspace-manager-r2',worker:'jscc-dev-workspace-worker-cap100'};
const TYPE='TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION';
const previous=Object.fromEntries(Object.keys(service).map(k=>[k,{revision:service[k]+'-00001-old',
 image:registry+packages[k]+'@sha256:'+'b'.repeat(64)}]));
const candidate={manager:'sha256:'+'c'.repeat(64),worker:'sha256:'+'d'.repeat(64)};
const target=k=>service[k]+'-r2-'+sha.slice(0,12);
const image=k=>registry+packages[k]+'@'+candidate[k];
const tag='r2-'+sha.slice(0,12);
function fixture(){
 const states={},revisions={},patches=[],healths=[];
 for(const role of Object.keys(service)){
  const name=root+'/services/'+service[role],sa=service[role]+'@jscc-dev.iam.gserviceaccount.com';
  const t={revision:previous[role].revision,serviceAccount:sa,containers:[{image:previous[role].image,
   env:[{name:'SECRET_REF',valueSource:{secretKeyRef:{secret:'private',version:'1'}}}]}]};
  const traffic=[{type:TYPE,revision:previous[role].revision,percent:100}];
  states[role]={name,generation:'1',observedGeneration:'1',etag:'etag-1',terminalCondition:{state:'CONDITION_SUCCEEDED'},
   template:t,latestReadyRevision:previous[role].revision,latestCreatedRevision:previous[role].revision,
   traffic,trafficStatuses:structuredClone(traffic),uri:'https://'+service[role]+'-fixture.run.app',ingress:'INGRESS_TRAFFIC_INTERNAL_ONLY'};
  revisions[name+'/revisions/'+previous[role].revision]={name:name+'/revisions/'+previous[role].revision,
   serviceAccount:sa,containers:structuredClone(t.containers),conditions:[{type:'Ready',state:'CONDITION_SUCCEEDED'}]};
 }
 const fetchImpl=async(url,init)=>{
  const u=new URL(url),path=u.pathname.slice(4);
  if(path.includes('/revisions/'))return Response.json(revisions[path]);
  const role=Object.keys(service).find(k=>path===states[k].name);assert.ok(role);
  const state=states[role];
  if(init.method==='GET')return Response.json(state);
  assert.equal(init.method,'PATCH');assert.equal(u.searchParams.get('allowMissing'),'false');
  const body=JSON.parse(init.body);assert.equal(body.etag,state.etag);
  patches.push({role,validate:u.searchParams.get('validateOnly'),mask:u.searchParams.get('updateMask'),body});
  if(u.searchParams.get('validateOnly')==='false'){
   if(body.template){
    assert.equal(u.searchParams.get('updateMask'),'template');
    state.template=body.template;state.latestReadyRevision=body.template.revision;state.latestCreatedRevision=body.template.revision;
    const name=state.name+'/revisions/'+body.template.revision;
    revisions[name]={name,serviceAccount:body.template.serviceAccount,containers:structuredClone(body.template.containers),
     conditions:[{type:'Ready',state:'CONDITION_SUCCEEDED'}]};
   }else{
    state.traffic=body.traffic;state.trafficStatuses=body.traffic.map(t=>({...t,...(t.tag?{uri:'https://'+t.tag+'---'+service[role]+'-fixture.run.app'}:{})}));
   }
   state.generation=String(Number(state.generation)+1);state.observedGeneration=state.generation;state.etag='etag-'+state.generation;
  }
  return Response.json({name:root+'/operations/op',done:true});
 };
 const options={fetchImpl,healthProbe:async(role,raw,opts)=>{healths.push({role,tag:opts?.tag??null});assert.equal(raw.name,states[role].name);},
  observeBuild:async()=>({state:'SUCCEEDED',build_observation:{build_kind:'workspace_r2',source_sha:sha,archive_binding:'RESOLVED_MATCH'}}),
  metadata:async x=>({state:'OBSERVED',metadata:{immutable_tags:true,package:x.package,source_sha:sha,
   digest:candidate[x.package===packages.manager?'manager':'worker'],uri:image(x.package===packages.manager?'manager':'worker')}}),
  assertFresh:()=>{},wait:async()=>{}};
 const action=async(phase,role,extra={})=>{
  const p=await observeWorkspaceRelease({fetchImpl});
  return executeWorkspaceReleaseStep({environment:'dev',phase,role,source_sha:sha,build_approval_ref:'#589/22',
   expected_pair_sha256:p.workspace_release.pair_sha256,previous,candidate,...extra},options);
 };
 return {states,revisions,patches,healths,options,action};
}
test('workspace staged release is exact etag bound, zero-traffic first, worker-before-manager, rollback reverse order',async()=>{
 const f=fixture();
 await f.action('stage','worker');await f.action('tag','worker');
 assert.equal(f.states.worker.traffic.find(x=>x.percent===100).revision,previous.worker.revision);
 await f.action('stage','manager');await f.action('tag','manager');
 await assert.rejects(()=>f.action('cutover','manager'),/cutover_order_denied/);
 await f.action('cutover','worker');await f.action('cutover','manager');
 assert.equal(f.states.worker.traffic.find(x=>x.percent===100).revision,target('worker'));
 assert.equal(f.states.manager.traffic.find(x=>x.percent===100).revision,target('manager'));
 await assert.rejects(()=>f.action('rollback','worker'),/rollback_order_denied/);
 await f.action('rollback','manager');await f.action('rollback','worker');
 await f.action('retire_tag','manager');const result=await f.action('retire_tag','worker');
 assert.equal(result.workspace_release.services.worker.revision,previous.worker.revision);
 assert.equal(result.workspace_release.services.manager.revision,previous.manager.revision);
 assert.equal(result.workspace_release.functional_acceptance,'PENDING');
 assert.equal(f.patches.filter(x=>x.validate==='false').length,10);
 assert.equal(f.patches.filter(x=>x.validate==='true').length,10);
 const req={action:'workspace_release_step',operation_id:'op',approval_hash:'hash'};
 assert.deepEqual(projectOperatorResult(req,{generation:'1',data:{...req,...result}}).workspace_release,result.workspace_release);
 assert.equal(JSON.stringify(result).includes('private'),false);
});
test('foreign target, pair drift, unpinned traffic or wrong immutable build cannot mutate',async()=>{
 const f=fixture();
 await assert.rejects(()=>f.action('stage','worker',{expected_pair_sha256:'0'.repeat(64)}),/pair_drift/);
 await assert.rejects(()=>f.action('stage','worker',{environment:'prod'}),/bundle_denied/);
 f.options.observeBuild=async()=>({state:'SUCCEEDED',build_observation:{source_sha:sha,build_kind:'ops'}});
 await assert.rejects(()=>f.action('stage','worker'),/build_evidence_missing/);
 assert.equal(f.patches.length,0);
});

test('workspace cleanup deletes only one reviewed obsolete revision, retains rollback and never touches registry',async()=>{
 const f=fixture(),role='manager',servicePath=root+'/services/'+service[role],rev=service[role]+'-old-retired',
  rollback=service[role]+'-old-retained',path=servicePath+'/revisions/'+rev;
 const oldImage=registry+packages[role]+'@sha256:'+'e'.repeat(64),retainedImage=registry+packages[role]+'@sha256:'+'f'.repeat(64);
 const make=(name,image)=>({name:servicePath+'/revisions/'+name,etag:'revision-etag',
  serviceAccount:f.states[role].template.serviceAccount,containers:[{image}],conditions:[{type:'Ready',state:'CONDITION_SUCCEEDED'}]});
 f.revisions[path]=make(rev,oldImage);f.revisions[servicePath+'/revisions/'+rollback]=make(rollback,retainedImage);
 const deletes=[],fetchImpl=async(url,init)=>{
  const u=new URL(url);
  if(u.pathname==='/v2/'+path){
   if(init.method==='DELETE'){
    assert.equal(u.searchParams.get('etag'),'revision-etag');assert.equal(init.body,undefined);
    deletes.push(u.searchParams.get('validateOnly'));
    if(deletes.at(-1)==='false')delete f.revisions[path];
    return Response.json({name:root+'/operations/op',done:true});
   }
   if(!f.revisions[path])return new Response(null,{status:404});
  }
  assert.equal(init.method,'GET');
  return f.options.fetchImpl(url,init);
 };
 const p=await observeWorkspaceRelease({fetchImpl});
 const bundle={environment:'dev',role,revision:rev,image:oldImage,revision_etag:'revision-etag',
  expected_pair_sha256:p.workspace_release.pair_sha256,retained_revision:rollback,retained_image:retainedImage,
  retention_review_ref:'#589/22'};
 const opts={...f.options,fetchImpl};
 await assert.rejects(()=>cleanupWorkspaceRevision({...bundle,revision:f.states[role].latestReadyRevision},opts),/revision_protected/);
 await assert.rejects(()=>cleanupWorkspaceRevision({...bundle,revision_etag:'wrong'},opts),/target_drift/);
 assert.equal(deletes.length,0);
 const out=await cleanupWorkspaceRevision(bundle,opts);
 assert.deepEqual(deletes,['true','false']);
 assert.equal(out.revision_cleanup.target_absent,true);assert.equal(out.revision_cleanup.image_deletion_authorized,false);
 const req={action:'workspace_revision_cleanup',operation_id:'op',approval_hash:'hash'};
 assert.deepEqual(projectOperatorResult(req,{generation:'1',data:{...req,...out}}).revision_cleanup,out.revision_cleanup);
});

test('workspace delivery input binds unique ordered approval refs, never arbitrary commands or environments',()=>{
 const args={environment:'dev',source_sha:sha,build_approval_ref:'#589/21',artifact_approval_ref:'#589/22',
  initial_pair_sha256:'b'.repeat(64),steps:['#589/23']};
 assert.deepEqual(validateWorkspaceDelivery(args),args);
 for(const bad of [{...args,environment:'prod'},{...args,steps:['#589/22']},{...args,steps:Array(7).fill('#589/23')},
  {...args,command:'gcloud'}])assert.throws(()=>validateWorkspaceDelivery(bad),/bundle_denied/);
});
test('workspace delivery result reports the next separately authorized step, not automatic dispatch',()=>{
 const h='c'.repeat(64),v={source_sha:sha,last_pair_sha256:h,live_pair_sha256:h,completed_steps:[],
  disposition:'NEXT_APPROVAL_REQUIRED',next_step:'stage:worker',automatic_retry:false,acceptance:'PENDING'};
 const req={action:'observe_workspace_delivery',operation_id:'op',approval_hash:'hash'};
 assert.deepEqual(projectOperatorResult(req,{generation:'1',data:{...req,state:'OBSERVED',workspace_delivery:v}}).workspace_delivery,v);
 assert.throws(()=>projectOperatorResult(req,{generation:'1',data:{...req,state:'OBSERVED',workspace_delivery:{...v,next_step:'cutover:manager'}}}));
});
