import assert from 'node:assert/strict';
import test from 'node:test';
import {
 operationIdentity,reserveDevBuildOperation,executeApprovedDevBuildOnce,
 observeDevBuildOnce,gcsDevOperationStore,
} from '../control/dev-build-operation-ledger.mjs';

const sourceSha='a'.repeat(40), digest='sha256:'+'c'.repeat(64);
const buildId='c5bbfb85-0aab-40c7-aa47-a5589aa9e295';
const actor='a'.repeat(64), ref='refs/heads/main';
const request={environment:'dev',work_item_ref:'#589',source_sha:sourceSha,trusted_ref:ref};
const identity=()=>operationIdentity({actor_sub_hash:actor,idempotency_key:'r6-case-12345',request});
const proof=kind=>({verified:true,kind,source_sha:sourceSha,trusted_ref:ref,work_item_ref:'#589'});
const callbacks=()=>({
 verifyApproval:async()=>({...proof('OWNER_APPROVAL'),approval_ref:'#589/APPROVE_BUILD'}),
 verifyTrustedRef:async()=>proof('TRUSTED_REF'),
 verifySourceSnapshot:async()=>({...proof('SOURCE_SNAPSHOT'),generation:'19',object_sha256:digest}),
 verifyCostAdmission:async()=>({...proof('COST_ADMISSION'),no_incremental_cost_proven:true}),
 dispatch:async()=>({build_id:buildId,project:'jscc-shared',region:'europe-west1',
   source_sha:sourceSha,approval_ref:'#589/APPROVE_BUILD'}),
});

function fakeStore() {
 const objects=new Map(), events=[];
 return {
  events,
  get:async name=>{
   const x=objects.get(name);
   return x?{data:JSON.parse(JSON.stringify(x.data)),generation:String(x.generation)}:null;
  },
  create:async(name, data)=>{
   if(objects.has(name))throw Error('generation_precondition_failed');
   objects.set(name,{data:JSON.parse(JSON.stringify(data)),generation:1});
   events.push('create');
  },
  replace:async(name,data,generation)=>{
   const x=objects.get(name);
   if(!x || String(x.generation)!==String(generation))
     throw Error('generation_precondition_failed');
   objects.set(name,{data:JSON.parse(JSON.stringify(data)),generation:x.generation+1});
   events.push('replace:'+data.state);
  },
 };
}

test('R6 ledger binds opaque actor, exact request and idempotency key to GCS path',()=>{
 const a=identity(),b=identity();
 assert.deepEqual(a,b);
 assert.match(a.path,/^control\/v1\/builds\/[a-f0-9]{64}\.json$/);
 assert.equal(a.path.includes('#589'),false);
 assert.throws(()=>operationIdentity({actor_sub_hash:'USER_EMAIL',idempotency_key:'short',request}));
 assert.throws(()=>operationIdentity({actor_sub_hash:actor,idempotency_key:'short',request}));
 assert.throws(()=>operationIdentity({actor_sub_hash:actor,idempotency_key:['valid','key','123'].join('-'),
    request:{...request,environment:'prod'}}));
});

test('R6 existing GCS generation API adapter is fixed to DEV bucket only',async()=>{
 const log=[];
 const adapter=gcsDevOperationStore('jscc-dev-ops-state',{
  read:async(bucket,path)=>{log.push(['read',bucket,path]);return null;},
  create:async(bucket,path,data,generation)=>{log.push(['create',bucket,path,generation]);},
  replace:async(bucket,path,data,generation)=>{log.push(['replace',bucket,path,generation]);},
 });
 await adapter.get('control/v1/builds/a.json');
 await adapter.create('control/v1/builds/a.json',{state:'RESERVED'});
 await adapter.replace('control/v1/builds/a.json',{state:'SUBMITTED'},'1');
 assert.deepEqual(log.map(x=>x[0]),['read','create','replace']);
 assert.equal(log[1][3],0);
 assert.equal(log[2][3],'1');
 assert.throws(()=>gcsDevOperationStore('jscc-prod-ops-state'),/invalid_dev_state_bucket/);
});

test('R6 exactly one dispatch across repeated user calls with same idempotency key',async()=>{
 const store=fakeStore(),a=identity(),cb=callbacks();let dispatches=0;
 cb.dispatch=async(req)=>{dispatches++;return callbacks().dispatch(req);};
 const first=await executeApprovedDevBuildOnce(a,store,cb);
 assert.equal(first.state,'SUBMITTED');
 assert.equal(first.build_id,buildId);
 const dup=await executeApprovedDevBuildOnce(a,store,cb);
 assert.equal(dup.duplicate,true);
 assert.equal(dup.state,'SUBMITTED');
 assert.equal(dup.retry_dispatched,false);
 assert.equal(dispatches,1);
 assert.deepEqual(store.events.slice(0,4),['create','replace:VERIFYING','replace:SUBMITTED']);
});

test('R6 gate denial leaves BLOCKED record and never dispatches upon retry',async()=>{
 const store=fakeStore(),a=identity(),cb=callbacks();let launches=0;
 cb.verifyApproval=async()=>({...proof('OWNER_APPROVAL'),verified:false});
 cb.dispatch=async()=>{launches++;return callbacks().dispatch();};
 const first=await executeApprovedDevBuildOnce(a,store,cb);
 assert.equal(first.state,'BLOCKED');
 const again=await executeApprovedDevBuildOnce(a,store,cb);
 assert.equal(again.state,'BLOCKED');
 assert.equal(again.duplicate,true);
 assert.equal(launches,0);
});

test('R6 lost submit acknowledgement requires manual reconciliation, never retries build',async()=>{
 const store=fakeStore(),a=identity(),cb=callbacks();let n=0;
 cb.dispatch=async()=>{n++;throw Error('transport_lost_after_possible_submission');};
 const first=await executeApprovedDevBuildOnce(a,store,cb);
 assert.equal(first.state,'SUBMISSION_UNKNOWN');
 const retry=await executeApprovedDevBuildOnce(a,store,cb);
 assert.equal(retry.state,'SUBMISSION_UNKNOWN');
 assert.equal(retry.retry_dispatched,false);
 assert.equal(n,1);
});

test('R6 uncertain GCS write after dispatch fails closed, duplicate does not re-submit',async()=>{
 const store=fakeStore(),a=identity(),cb=callbacks();
 const replace=store.replace;let n=0,failed=false;
 store.replace=async(name,data,gen)=>{
  if(data.state==='SUBMITTED'&&!failed){failed=true;throw Error('gcs_read_500');}
  return replace(name,data,gen);
 };
 cb.dispatch=async(req)=>{n++;return callbacks().dispatch(req);};
 const result=await executeApprovedDevBuildOnce(a,store,cb);
 assert.equal(result.state,'SUBMISSION_UNKNOWN');
 assert.equal(n,1);
 const duplicate=await executeApprovedDevBuildOnce(a,store,cb);
 assert.equal(duplicate.duplicate,true);
 assert.equal(n,1);
});

test('R6 read status can poll tracked build without exposing substitutions',async()=>{
 const store=fakeStore(),a=identity();
 await executeApprovedDevBuildOnce(a,store,callbacks());
 const makeBuild=status=>({
  id:buildId,projectId:'jscc-shared',
  name:'projects/jscc-shared/locations/europe-west1/builds/'+buildId,
  serviceAccount:'projects/jscc-shared/serviceAccounts/jscc-ops-build@jscc-shared.iam.gserviceaccount.com',
  status,substitutions:{_SECRET:'dont_return_me'},
  results:{images:[{name:'europe-west1-docker.pkg.dev/jscc-shared/jscc-ops/jscc-ops-gateway:v1',digest}]},
 });
 const working=await observeDevBuildOnce(a,store,{getBuild:async()=>makeBuild('WORKING')});
 assert.equal(working.state,'WORKING');
 const success=await observeDevBuildOnce(a,store,{getBuild:async()=>makeBuild('SUCCESS')});
 assert.equal(success.state,'SUCCEEDED');
 assert.equal(success.immutable_image_count,1);
 assert.equal(success.source_provenance,'UNVERIFIED');
 assert.equal(JSON.stringify(success).includes('dont_return_me'),false);
 const final=await observeDevBuildOnce(a,store,{getBuild:async()=>{throw Error('no_more_calls');}});
 assert.deepEqual(final,{operation_id:a.key,state:'SUCCEEDED',unchanged:true});
});

test('R6 build observation cannot run before trusted receipt or after unknown submission',async()=>{
 const store=fakeStore(),a=identity();
 await reserveDevBuildOperation(a,store);
 await assert.rejects(()=>observeDevBuildOnce(a,store,{getBuild:async()=>{}}),
  /submission_not_reconciled/);
 const other={...a,request_hash:'f'.repeat(64)};
 await assert.rejects(()=>observeDevBuildOnce(other,store,{getBuild:async()=>{}}),
  /operation_not_found/);
});

test('R6 optimistic CAS rejects concurrent conflicting mutation',async()=>{
 const store=fakeStore(),a=identity();
 await reserveDevBuildOperation(a,store);
 const x=await store.get(a.path);
 await store.replace(a.path,{...x.data,state:'SUBMITTING'},x.generation);
 await assert.rejects(()=>store.replace(a.path,{...x.data,state:'SUBMITTED'},x.generation),
  /generation_precondition_failed/);
 const duplicate=await reserveDevBuildOperation(a,store);
 assert.equal(duplicate.created,false);
 assert.equal(duplicate.record.state,'SUBMITTING');
});
