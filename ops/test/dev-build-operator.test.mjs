import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {admitBuildBundle,runApprovedBuild,observeApprovedBuild}
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
