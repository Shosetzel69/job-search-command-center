import test from 'node:test';
import assert from 'node:assert/strict';
import {runApprovedPair,inspectPairAdmission,observePairRecovery} from './gcp/remote_executor_dev_pair.mjs';
import {evidenceDigest,operatorPairStore,pairOperationIdentity} from './gcp/remote_executor_dev_admission.mjs';

const old={source_sha:'a'.repeat(40),gateway_digest:'sha256:'+'b'.repeat(64),
 worker_digest:'sha256:'+'c'.repeat(64),revision:'jscc-ops-gateway-dev-00015-lxb',tags:{},
 uri:'https://jscc-ops-gateway-dev-828902654738.europe-west1.run.app',
 gateway_template_hash:'1'.repeat(64),worker_template_hash:'2'.repeat(64),
 gateway_policy_hash:'3'.repeat(64),worker_policy_hash:'4'.repeat(64),
 next_gateway_template_hash:'5'.repeat(64),next_worker_template_hash:'6'.repeat(64),
 protected_baseline:'7'.repeat(64)};
const next={source_sha:'d'.repeat(40),gateway_digest:'sha256:'+'e'.repeat(64),
 worker_digest:'sha256:'+'f'.repeat(64),catalog:'589-nile-api-v1',previous_catalog:'589-nile-api-v1'};
const operatorSha='8'.repeat(40), approvalRef='#589/1001';
const root='europe-west1-docker.pkg.dev/jscc-shared/jscc-ops/';
const NOW=1700000000000;
function pair(v){return {gateway_image:root+'jscc-ops-gateway@'+v.gateway_digest,
 worker_image:root+'jscc-diagnostics@'+v.worker_digest};}
function values(v){return {source_sha:v.source_sha,gateway_digest:v.gateway_digest,worker_digest:v.worker_digest};}
function live(proposed=false){
 const v=proposed?next:old;
 return {gateway_binding:values(v),worker_binding:values(v),effective_binding:values(v),
  gateway_template_hash:proposed?old.next_gateway_template_hash:old.gateway_template_hash,
  worker_template_hash:proposed?old.next_worker_template_hash:old.worker_template_hash,
  gateway_policy_hash:old.gateway_policy_hash,worker_policy_hash:old.worker_policy_hash,
  revision:proposed?'jscc-ops-gateway-dev-00016-abc':old.revision,tags:{},uri:old.uri,
  catalog:v.catalog||next.previous_catalog,protected_baseline:old.protected_baseline,
  lease_state:'OWNED_ACTIVE',lease_generation:'42'};
}
function fakeStore(){
 let current=null, generation=0;
 return {
  failReplace:null,
  get current(){return structuredClone(current);},
  async get(path){assert.equal(path,pairOperationIdentity(approvalRef).path);return structuredClone(current);},
  async create(path,data){
   assert.equal(path,pairOperationIdentity(approvalRef).path);
   if(current)throw Error('generation_precondition_failed');
   current={data:structuredClone(data),generation:String(++generation)};
  },
  async replace(path,data,gen){
   assert.equal(path,pairOperationIdentity(approvalRef).path);
   if(!current||gen!==current.generation)throw Error('generation_precondition_failed');
   if(this.failReplace?.(data))throw Error('fixture_write_lost');
   current={data:structuredClone(data),generation:String(++generation)};
  },
 };
}
async function fixture(failMethod=null){
 const events=[],store=fakeStore();
 let observation=live(),capture=old,currentTime=NOW;
 const stepName=(method,args)=>method==='verify_pair'?(args[0]?'verify_previous':'verify_next'):method;
 const factory=()=>({call:async(method,...args)=>{
  events.push(method+(method==='verify_pair'?':'+args[0]:''));
  if(method==='capture')return capture;
  if(method==='observe_recovery')return observation;
  assert.deepEqual(store.current.data.history.at(-1),{
   step:stepName(method,args),outcome:'INTENT',at_ms:currentTime});
  if(method==='freeze')assert.equal(args[0],pairOperationIdentity(approvalRef).maintenance_id);
  if(method===failMethod)throw Error('fixture_failure');
  if(method==='verify_pair')return pair(args[0]?old:next);
  return true;
 },close(){events.push('close');}});
 const preflight=await inspectPairAdmission(next,factory);
 assert.equal(preflight.mutation_authorized,false);
 events.length=0;
 const bundle={schema_version:'1.0',environment:'dev',work_item_ref:'#589',plan_hash:preflight.plan.plan_hash,
  previous:old,next,operator_source_sha:operatorSha,build_id:'c5bbfb85-0aab-40c7-aa47-a5589aa9e295',
  evidence:{approval:approvalRef,independent_review:'#589/1002',image_provenance:'#589/1003',
   cost:'#589/1004',maintenance_window:'#589/1005',rollback_authority:'#589/1006',
   operator_access:'#589/1007',tagged_revision_compatibility:'#589/1008'},
  issued_at_ms:NOW-1000,expires_at_ms:NOW+10000};
 const args={bundle,trustedEvidenceHash:evidenceDigest(bundle),store,now:()=>currentTime};
 const run=(overrides={},source=async()=>operatorSha)=>runApprovedPair({...args,...overrides},factory,source);
 return {args,events,store,factory,run,setObservation:x=>{observation=x;},
  setCapture:x=>{capture=x;},setTime:x=>{currentTime=x;}};
}
test('R6 pinned admission journals all intents before calls and verifies before release',async()=>{
 const f=await fixture();
 const result=await f.run();
 assert.equal(result.state,'SUCCEEDED');
 assert.equal(result.automatic_retry,false);
 assert.deepEqual(f.events,['capture','freeze','deploy_worker','deploy_gateway','verify_pair:false','release','close']);
 assert.equal(f.store.current.data.state,'SUCCEEDED');
 assert.equal(f.store.current.data.history.at(-1).step,'release');
 assert.equal(f.store.current.data.history.at(-1).outcome,'CONFIRMED');
});
test('missing pin, tampered evidence, unproven cost, wrong checkout or expired window never reserves',async()=>{
 const f=await fixture();
 await assert.rejects(f.run({trustedEvidenceHash:null}),/invalid_evidence_bundle/);
 await assert.rejects(f.run({bundle:{...f.args.bundle,build_id:'c5bbfb85-0aab-40c7-aa47-a5589aa9e296'}}),/evidence_pin_mismatch/);
 const bad=structuredClone(f.args.bundle);delete bad.evidence.cost;
 await assert.rejects(f.run({bundle:bad,trustedEvidenceHash:evidenceDigest(bad)}),/missing_authoritative_evidence_reference/);
 await assert.rejects(f.run({},async()=> '9'.repeat(40)),/operator_source_mismatch/);
 f.setTime(NOW+10000);
 await assert.rejects(f.run(),/evidence_window_closed/);
 assert.equal(f.store.current,null);assert.deepEqual(f.events,[]);
});
test('drift in exact previous anchor prevents reservation and freeze',async()=>{
 const f=await fixture();
 f.setCapture({...old,protected_baseline:'9'.repeat(64)});
 await assert.rejects(f.run(),/approved_plan_drift/);
 assert.equal(f.store.current,null);
 assert.deepEqual(f.events,['capture','close']);
});
test('consumed approval never dispatches again, including different pinned evidence',async()=>{
 const f=await fixture();
 await f.run();
 const events=f.events.slice();
 const dup=await f.run();
 assert.equal(dup.duplicate,true);assert.equal(dup.state,'SUCCEEDED');
 assert.deepEqual(f.events,events);
 const other={...f.args.bundle,build_id:'c5bbfb85-0aab-40c7-aa47-a5589aa9e296'};
 await assert.rejects(f.run({bundle:other,trustedEvidenceHash:evidenceDigest(other)}),/approval_already_consumed/);
 assert.deepEqual(f.events,events);
});
test('create-only reservation admits only one concurrent operation',async()=>{
 const f=await fixture();
 const results=await Promise.all([f.run(),f.run()]);
 assert.equal(results.filter(x=>x.duplicate===true).length,1);
 assert.equal(f.events.filter(x=>x==='freeze').length,1);
});
test('R6 restores both resources, verifies restored pair, then releases',async()=>{
 const f=await fixture('deploy_gateway');
 const result=await f.run();
 assert.equal(result.state,'ROLLED_BACK');
 assert.deepEqual(f.events,['capture','freeze','deploy_worker','deploy_gateway','rollback_gateway',
 'rollback_worker','verify_pair:true','release','close']);
 assert.ok(f.store.current.data.history.some(x=>x.step==='deploy_gateway'&&x.outcome==='UNKNOWN'));
});
test('uncertain release never initiates rollback after exclusion may be lost',async()=>{
 const f=await fixture('release');
 const result=await f.run();
 assert.equal(result.state,'UNFREEZE_UNCERTAIN');
 assert.equal(result.manual_intervention_required,true);
 assert.equal(result.rollback_attempted,false);
 assert.deepEqual(f.events,['capture','freeze','deploy_worker','deploy_gateway','verify_pair:false','release','close']);
});
test('lost receipt poisons journal and forbids any further mutation or replay',async()=>{
 const f=await fixture();
 f.store.failReplace=r=>r.history.at(-1)?.step==='deploy_worker'&&r.history.at(-1)?.outcome==='CONFIRMED';
 const result=await f.run();
 assert.equal(result.state,'RECOVERY_REQUIRED');
 assert.deepEqual(f.events,['capture','freeze','deploy_worker','close']);
 assert.equal(f.store.current.data.history.at(-1).outcome,'INTENT');
 assert.equal((await f.run()).duplicate,true);
 assert.deepEqual(f.events,['capture','freeze','deploy_worker','close']);
});
test('failed intent write prevents dispatch',async()=>{
 const f=await fixture();
 f.store.failReplace=r=>r.history.at(-1)?.step==='freeze';
 const result=await f.run();
 assert.equal(result.state,'RECOVERY_REQUIRED');
 assert.deepEqual(f.events,['capture','close']);
 assert.equal(f.store.current.data.state,'RESERVED');
});
test('restart observation classifies pair and lease without journal or workload writes',async()=>{
 const f=await fixture('release');
 await f.run();const saved=f.store.current;
 f.events.length=0;
 const observe=()=>observePairRecovery({approvalRef,store:f.store},f.factory);
 const a=await observe();
 assert.equal(a.live_pair,'PREVIOUS_PAIR');assert.equal(a.lease_state,'OWNED_ACTIVE');
 assert.equal(a.mutation_authorized,false);assert.equal(a.recovery_authorization_required,true);
 f.setObservation(live(true));
 assert.equal((await observe()).live_pair,'PROPOSED_PAIR');
 f.setObservation({...live(true),worker_binding:values(old),protected_baseline:'9'.repeat(64)});
 const mixed=await observe();
 assert.equal(mixed.live_pair,'MIXED_OR_DRIFT');assert.equal(mixed.protected_match,false);
 assert.deepEqual(f.store.current,saved);
 assert.deepEqual(f.events,['observe_recovery','close','observe_recovery','close','observe_recovery','close']);
});
test('operator GCS adapter uses fixed path, generation preconditions and no redirect',async()=>{
 const calls=[],path=pairOperationIdentity(approvalRef).path;
 const store=operatorPairStore({getToken:async()=> 'fixture',fetchImpl:async(url,init)=>{
  calls.push({url,init});
  if(init.method==='POST')return new Response(JSON.stringify({generation:'2'}),{status:200});
  return new Response(JSON.stringify({state:'fixture'}),{headers:{'x-goog-generation':'1'}});
 }});
 assert.equal((await store.get(path)).generation,'1');
 await store.create(path,{state:'fixture'});
 await store.replace(path,{state:'fixture'},'1');
 assert.equal(new URL(calls[1].url).searchParams.get('ifGenerationMatch'),'0');
 assert.equal(new URL(calls[2].url).searchParams.get('ifGenerationMatch'),'1');
 assert.ok(calls.every(x=>x.init.redirect==='error'));
 await assert.rejects(store.get('leases/diagnostics.json'),/pair_store_path_denied/);
 const conflict=operatorPairStore({getToken:async()=> 'fixture',
  fetchImpl:async()=>new Response('{}',{status:412})});
 await assert.rejects(conflict.create(path,{}),/generation_precondition_failed/);
});
