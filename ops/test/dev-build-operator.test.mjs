import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {admitBuildBundle,runApprovedBuild,observeApprovedBuild,observeApprovedBuildEvidence,cancelApprovedBuild,reconcileApprovedBuild}
 from '../../scripts/gcp/remote_executor_dev_build.mjs';
import {evidenceDigest,operatorBuildStore,operatorPairStore}
 from '../../scripts/gcp/remote_executor_dev_admission.mjs';

const now=()=>Date.parse('2026-11-28T00:00:00Z');
const sha='a'.repeat(40),yamlHash='b'.repeat(64),actor='c'.repeat(64);
const archiveBytes=Buffer.from('independently approved synthetic archive bytes');
const archiveDigest='sha256:'+createHash('sha256').update(archiveBytes).digest('hex');
const bucket='jscc-shared-ops-cloudbuild-source',object='source/approved.tar.gz',generation='123456789';
const id='254d3513-9c02-4f33-a974-e8e8f8935aa7';
const parent='projects/jscc-shared/locations/europe-west1/builds';
const sa='projects/jscc-shared/serviceAccounts/jscc-ops-build@jscc-shared.iam.gserviceaccount.com';
const registry='europe-west1-docker.pkg.dev/jscc-shared/jscc-ops/';
const lifecycle=JSON.parse(readFileSync(new URL('../../scripts/gcp/remote_executor_dev_lifecycle.json',import.meta.url)));
function bundle(){
 return {schema_version:'1.0',request:{environment:'dev',work_item_ref:'#589',source_sha:sha,trusted_ref:'refs/heads/main'},
  actor_sub_hash:actor,idempotency_key:'approved-build-123',
  archive:{bucket,object,generation,sha256:archiveDigest},config_yaml_sha256:yamlHash,
  // Synthetic, independently pinned structural fixture. Never usable as a live build config.
  build_config:{steps:['trusted-source-admission','materialize-verified-source','validate-candidate',
   'python-contract-tests','ops-contract-tests','registry-immutability','detect-existing-images',
   'build-gateway','build-worker','build-operator','verify-image-source','push-gateway','push-worker','push-operator','evidence'].map(id=>({id})),
   substitutions:{_GIT_SHA:'',_TRUSTED_REF:'',_GATEWAY_IMAGE:registry+'jscc-ops-gateway',
    _WORKER_IMAGE:registry+'jscc-diagnostics',_OPERATOR_IMAGE:registry+'jscc-ops-operator'},serviceAccount:sa,options:{logging:'CLOUD_LOGGING_ONLY'}},
  evidence:{approval:'#589/1',independent_review:'#589/2',source_snapshot:'#589/3',
   config_equivalence:'#589/4',cost:'#589/5',operator_access:'#589/6',lifecycle:'#589/7'},
  issued_at_ms:now()-1000,expires_at_ms:now()+1000};
}
function setup({badArchive=false,badLifecycle=false,badReceipt=false}={}){
 const records=new Map(),calls=[];
 const store={
  get:async p=>records.get(p)?structuredClone(records.get(p)):null,
  create:async(p,data)=>{
   if(records.has(p))throw Error('generation_precondition_failed');
   records.set(p,{data:structuredClone(data),generation:'1'});
  },
  replace:async(p,data,g)=>{
   if(records.get(p)?.generation!==g)throw Error('generation_precondition_failed');
   records.set(p,{data:structuredClone(data),generation:String(Number(g)+1)});
  },
 };
 const json=v=>new Response(JSON.stringify(v),{headers:{'content-type':'application/json'}});
 const fetchImpl=async(url,init)=>{
  calls.push({url,method:init.method,body:init.body?JSON.parse(init.body):null});
  assert.equal(init.redirect,'error');
  if(url.includes('/b/jscc-dev-ops-state?'))return json({name:'jscc-dev-ops-state',
   location:'EUROPE-WEST1',lifecycle:badLifecycle?{}:lifecycle,updated:'2026-11-26T00:00:00Z'});
  if(url.includes('/b/'+bucket+'/o/')){
   assert.equal(new URL(url).searchParams.get('generation'),generation);
   return new Response(badArchive?'different':archiveBytes,{headers:{'x-goog-generation':generation}});
  }
  if(init.method==='POST'&&url.endsWith('/builds?projectId=jscc-shared')){
   const body=JSON.parse(init.body);
   assert.equal([...records.values()].some(x=>x.data.state==='SUBMITTING'),true);
   assert.deepEqual(body.source.storageSource,{bucket,object,generation});
   assert.equal(body.substitutions._GIT_SHA,sha);
   return json({metadata:{build:{id,name:parent+'/'+id,serviceAccount:sa,substitutions:body.substitutions,
    source:{storageSource:{...body.source.storageSource,generation:badReceipt?'999':generation}}}}});
  }
  if(url.endsWith('/builds/'+id))return json({id,name:parent+'/'+id,serviceAccount:sa,status:'SUCCESS'});
  throw Error('unexpected_call');
 };
 return {calls,records,options:{getToken:async()=>'fixture-token',fetchImpl,store,readSource:async()=>yamlHash,now}};
}
const run=(x,options)=>runApprovedBuild({bundle:x,trustedEvidenceHash:evidenceDigest(x)},options);

test('R5 real operator adapter posts exact regional generation-pinned build after durable intent',async()=>{
 const x=bundle(),s=setup();
 const result=await run(x,s.options);
 assert.equal(result.state,'SUBMITTED');
 assert.equal(result.build_id,id);
 const observed=await observeApprovedBuild(admitBuildBundle(x,evidenceDigest(x),now).identity,s.options);
 assert.equal(observed.state,'SUCCEEDED');
 assert.equal(observed.source_provenance,'UNVERIFIED');
 assert.equal(observed.immutable_image_count,0);
 const another={...x,idempotency_key:'different-approval-key'};
 assert.equal((await run(another,s.options)).state,'BLOCKED');
 assert.equal(s.calls.filter(c=>c.method==='POST').length,1);
});

test('R5 operator denies wrong pin, foreign resource, expired evidence and config changes before I/O',async()=>{
 const x=bundle(),s=setup();
 await assert.rejects(()=>runApprovedBuild({bundle:x,trustedEvidenceHash:'0'.repeat(64)},s.options),/pin_mismatch/);
 for(const wrong of [
  {...x,request:{...x.request,environment:'prod'}},
  {...x,archive:{...x.archive,bucket:'other-bucket'}},
  {...x,expires_at_ms:now()-1},
  {...x,build_config:{...x.build_config,serviceAccount:'other'}},
 ])await assert.rejects(()=>run(wrong,s.options));
 assert.equal(s.calls.length,0);
 assert.equal(s.records.size,0);
});

test('R5 lifecycle mismatch blocks ledger; bad archive prevents submission; bad receipt is uncertain',async()=>{
 const x=bundle();
 const l=setup({badLifecycle:true});
 await assert.rejects(()=>run(x,l.options),/lifecycle_not_settled/);
 assert.equal(l.records.size,0);
 const a=setup({badArchive:true});
 assert.equal((await run(x,a.options)).state,'BLOCKED');
 assert.equal(a.calls.filter(c=>c.method==='POST').length,0);
 const r=setup({badReceipt:true});
 assert.equal((await run(x,r.options)).state,'SUBMISSION_UNKNOWN');
 assert.equal((await run(x,r.options)).duplicate,true);
 assert.equal(r.calls.filter(c=>c.method==='POST').length,1);
});

test('R5 build and pair operator stores retain distinct exact GCS prefixes',async()=>{
 const calls=[];
 const opts={getToken:async()=>'fixture',fetchImpl:async url=>{
  calls.push(url);return new Response(null,{status:404});
 }};
 const build='control/v1/builds/'+'a'.repeat(64)+'.json';
 const pair='control/v1/deployments/'+'a'.repeat(64)+'.json';
 assert.equal(await operatorBuildStore(opts).get(build),null);
 assert.equal(await operatorPairStore(opts).get(pair),null);
 await assert.rejects(()=>operatorBuildStore(opts).get(pair),/path_denied/);
 await assert.rejects(()=>operatorPairStore(opts).get(build),/path_denied/);
 assert.equal(calls.length,2);
});

test('approved cancellation binds exact durable original, regional resource and provider source',async()=>{
 const x=bundle(),s=setup();
 await run(x,s.options);
 const calls=[];
 const provider=status=>({id,name:parent+'/'+id,serviceAccount:sa,status,
  substitutions:{_GIT_SHA:sha,_TRUSTED_REF:x.request.trusted_ref},
  source:{storageSource:{bucket,object,generation}}});
 let state='WORKING';
 const opts={...s.options,assertFresh:()=>{},fetchImpl:async(url,init)=>{
  calls.push({url,method:init.method});
  if(url.includes('/b/jscc-dev-ops-state?'))return s.options.fetchImpl(url,init);
  if(url.endsWith(':cancel')){
   assert.equal(init.method,'POST');
   assert.deepEqual(JSON.parse(init.body),{projectId:'jscc-shared',id});
   assert.equal(url,'https://cloudbuild.googleapis.com/v1/'+parent+'/'+id+':cancel');
   state='CANCELLED';
  }
  return Response.json(provider(state));
 }};
 await assert.rejects(()=>cancelApprovedBuild(x,'11111111-1111-1111-1111-111111111111',opts),/original_mismatch/);
 assert.equal(calls.length,0);
 const result=await cancelApprovedBuild(x,id,opts);
 assert.equal(result.state,'CANCELLED');
 assert.equal(calls.filter(c=>c.method==='POST').length,1);
 assert.equal((await cancelApprovedBuild(x,id,opts)).state,'CANCELLED');
 assert.equal(calls.filter(c=>c.method==='POST').length,1);
});

test('cancel fails closed on lost response, expired approval or provider source drift',async()=>{
 const x=bundle(),s=setup();await run(x,s.options);
 let posts=0,drift=true,expired=false;
 const opts={...s.options,assertFresh:()=>{if(expired)throw Error('expired');},fetchImpl:async(url,init)=>{
  if(url.includes('/b/jscc-dev-ops-state?'))return s.options.fetchImpl(url,init);
  if(init.method==='POST'){posts++;throw Error('lost_receipt');}
  return Response.json({id,name:parent+'/'+id,serviceAccount:sa,status:'WORKING',
   substitutions:{_GIT_SHA:drift?'b'.repeat(40):sha,_TRUSTED_REF:x.request.trusted_ref},
   source:{storageSource:{bucket,object,generation}}});
 }};
 await assert.rejects(()=>cancelApprovedBuild(x,id,opts),/provider_binding_mismatch/);
 assert.equal(posts,0);
 drift=false;expired=true;
 await assert.rejects(()=>cancelApprovedBuild(x,id,opts),/expired/);
 assert.equal(posts,0);
 expired=false;
 await assert.rejects(()=>cancelApprovedBuild(x,id,opts),/lost_receipt/);
 assert.equal(posts,1);
 const rec=[...s.records.values()].find(x=>x.data.operation_kind==='dev-ops-build');
 assert.equal(rec.data.state,'SUBMITTED');
});


test('build evidence binds resolved archive generation and fixed steps, including terminal readback',async()=>{
 const x=bundle(),s=setup();await run(x,s.options);
 const storageSource={bucket,object,generation};
 const raw={id,name:parent+'/'+id,serviceAccount:sa,status:'SUCCESS',
  source:{storageSource},sourceProvenance:{resolvedStorageSource:storageSource},
  substitutions:{_GIT_SHA:sha,_TRUSTED_REF:x.request.trusted_ref,private:'not-returned'},
  steps:x.build_config.steps.map(y=>({...y,status:'SUCCESS',args:['private']}))};
 const opts={...s.options,fetchImpl:async(url,init)=>{
  assert.equal(init.method,'GET');assert.equal(url,'https://cloudbuild.googleapis.com/v1/'+parent+'/'+id);
  return Response.json(raw);
 }};
 const first=await observeApprovedBuildEvidence(x,opts);
 assert.equal(first.state,'SUCCEEDED');
 assert.equal(first.build_observation.archive_binding,'RESOLVED_MATCH');
 assert.equal(first.build_observation.steps.length,x.build_config.steps.length);
 assert.equal(first.source_provenance,'UNVERIFIED');
 assert.equal(JSON.stringify(first).includes('private'),false);
 const second=await observeApprovedBuildEvidence(x,opts);
 assert.deepEqual(second,first);
 raw.sourceProvenance={resolvedStorageSource:{...storageSource,generation:'999'}};
 await assert.rejects(()=>observeApprovedBuildEvidence(x,opts),/resolved_source_mismatch/);
 raw.sourceProvenance=undefined;
 assert.equal((await observeApprovedBuildEvidence(x,opts)).build_observation.archive_binding,'REQUEST_MATCH_ONLY');
 raw.steps[0].id='unapproved';
 await assert.rejects(()=>observeApprovedBuildEvidence(x,opts),/step_identity_mismatch/);
});

test('workspace R2 build reuses approved ops lineage and fixed paired configuration',async()=>{
 const {planDevOpsBuild,submitApprovedDevOpsBuild}=await import('../build/dev-cloud-build-controller.mjs');
 const x=bundle();
 x.request.build_kind='workspace_r2';
 const repo='europe-west1-docker.pkg.dev/jscc-shared/jscc-ops/';
 x.build_config.substitutions={_GIT_SHA:'',_TRUSTED_REF:'',
  _MANAGER_BASE:repo+'jscc-dev-workspace-manager-r2@sha256:ac80ef6e88a57b78c51c958930bc345141fa85d569544cf085f10c33323b99f1',
  _MANAGER_IMAGE:repo+'jscc-dev-workspace-manager-r2',
  _WORKER_BASE:repo+'jscc-dev-workspace-worker-cap100@sha256:1dc1354d2777b0e7e65a1d07758d012c66f15d223fd1fec4fee3e82cd02ce617',
  _WORKER_IMAGE:repo+'jscc-dev-workspace-worker-cap100'};
 x.build_config.steps=['trusted-source-admission','materialize-verified-source','immutable-workspace-baselines',
  'workspace-manager-contract-tests','build-manager-r2','build-worker-r2','worker-image-cwd-smoke',
  'manager-image-route-smoke','verify-workspace-image-source','push-manager-r2','push-worker-r2','digest-evidence'].map(id=>({id}));
 const admitted=admitBuildBundle(x,evidenceDigest(x),now);
 assert.equal(admitted.plan.config,'cloudbuild.workspace-manager-r2.yaml');
 assert.equal(admitted.plan.build_service_account,x.build_config.serviceAccount);
 assert.notEqual(admitted.identity.request_hash,admitBuildBundle(bundle(),evidenceDigest(bundle()),now).identity.request_hash);
 const proof=kind=>({verified:true,kind,work_item_ref:'#589',source_sha:x.request.source_sha,trusted_ref:x.request.trusted_ref});
 const receipt=await submitApprovedDevOpsBuild(x.request,{
  verifyApproval:async()=>({...proof('OWNER_APPROVAL'),approval_ref:x.evidence.approval}),
  verifyTrustedRef:async()=>proof('TRUSTED_REF'),
  verifySourceSnapshot:async()=>({...proof('SOURCE_SNAPSHOT'),object:x.archive.object,generation:x.archive.generation,object_sha256:x.archive.sha256}),
  verifyCostAdmission:async()=>({...proof('COST_ADMISSION'),no_incremental_cost_proven:true}),
  dispatch:async req=>{
   assert.equal(req.config,'cloudbuild.workspace-manager-r2.yaml');
   assert.equal(req.script,'scripts/gcp/remote_executor_dev_build.mjs');
   return {build_id:id,project:'jscc-shared',region:'europe-west1',source_sha:x.request.source_sha,approval_ref:x.evidence.approval};
  }
 });
 assert.equal(receipt.build_id,id);
 for(const key of ['_MANAGER_BASE','_WORKER_BASE','_WORKER_IMAGE']){
  const bad=structuredClone(x);bad.build_config.substitutions[key]='arbitrary';
  assert.throws(()=>admitBuildBundle(bad,evidenceDigest(bad),now),/build_config_scope_denied/);
 }
 assert.throws(()=>planDevOpsBuild({...x.request,build_kind:'arbitrary'}),/build_kind_denied/);
 assert.throws(()=>planDevOpsBuild({...x.request,work_item_ref:'#123'}),/build_kind_denied/);
});


test('recovery binds unique archive and original approval after lost receipt without resubmission',async()=>{
 const x=bundle(),s=setup();
 x.archive.object='source/dev-'+sha+'-'+createHash('sha256').update(x.evidence.approval).digest('hex')+'.tar.gz';
 const orig=s.options.fetchImpl;
 const options={...s.options,fetchImpl:async(url,init)=>{
  if(init.method==='POST'&&url.endsWith('/builds?projectId=jscc-shared')){
   s.calls.push({url,method:'POST'});throw Error('lost receipt');
  }
  return orig(url,init);
 }};
 assert.equal((await run(x,options)).state,'SUBMISSION_UNKNOWN');
 const intent=admitBuildBundle(x,evidenceDigest(x),now).identity;
 const record=await s.options.store.get(intent.path);
 await s.options.store.replace(intent.path,{...record.data,created_at:new Date(now()-1000).toISOString()},record.generation);
 const raw={id,name:parent+'/'+id,serviceAccount:sa,status:'SUCCESS',createTime:new Date(now()).toISOString(),
  source:{storageSource:{bucket,object:x.archive.object,generation}},
  sourceProvenance:{resolvedStorageSource:{bucket,object:x.archive.object,generation}},
  substitutions:{...x.build_config.substitutions,_GIT_SHA:sha,_TRUSTED_REF:'refs/heads/main'},
  steps:x.build_config.steps,options:x.build_config.options};
 const recovery={...options,assertFresh:()=>{},fetchImpl:async(url,init)=>{
  if(url.endsWith('/builds/'+id))return Response.json(raw);
  return options.fetchImpl(url,init);
 }};
 await assert.rejects(()=>reconcileApprovedBuild(x,id,{...recovery,fetchImpl:async(url,init)=>url.endsWith('/builds/'+id)?
  Response.json({...raw,sourceProvenance:{resolvedStorageSource:{bucket,object:x.archive.object,generation:'999'}}}):recovery.fetchImpl(url,init)}),/provider_binding_mismatch/);
 const out=await reconcileApprovedBuild(x,id,recovery);
 assert.equal(out.state,'SUCCEEDED');assert.equal(out.reconciled_submission,true);
 assert.equal(out.retry_dispatched,false);assert.equal(out.source_provenance,'UNVERIFIED');
 await assert.rejects(()=>reconcileApprovedBuild(x,id,recovery),/ledger_mismatch/);
 assert.equal(s.calls.filter(c=>c.method==='POST').length,1);
});
