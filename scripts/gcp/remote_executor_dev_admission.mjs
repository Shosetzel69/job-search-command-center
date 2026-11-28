// #589: extend the existing R6 GCS CAS ledger to one-shot pair deployment.
// Trusted operator only. A separately verified evidence pin is not an MCP input.
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {gcsDevOperationStore} from '../../ops/control/dev-build-operation-ledger.mjs';

const BUCKET='jscc-dev-ops-state';
const HEX=/^[a-f0-9]{64}$/;
const SHA=/^[a-f0-9]{40}$/;
const DIGEST=/^sha256:[a-f0-9]{64}$/;
const REF=/^#589\/[1-9][0-9]{0,19}$/;
const GEN=/^[1-9][0-9]{0,19}$/;
const BUILD=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const REV=/^jscc-ops-gateway-dev-[a-z0-9-]{1,40}$/;
const CATALOG=/^[a-z0-9-]{1,80}$/;
const URI=new Set([
 'https://jscc-ops-gateway-dev-828902654738.europe-west1.run.app',
 'https://jscc-ops-gateway-dev-booykgjo4a-ew.a.run.app',
]);
const EVIDENCE_KEYS=['approval','independent_review','image_provenance','cost','maintenance_window',
 'rollback_authority','operator_access','tagged_revision_compatibility'];
const OBSERVED_KEYS=['source_sha','gateway_digest','worker_digest','revision','tags','uri',
 'gateway_template_hash','worker_template_hash','gateway_policy_hash','worker_policy_hash',
 'next_gateway_template_hash','next_worker_template_hash','protected_baseline'];
const HASH_KEYS=OBSERVED_KEYS.filter(x=>x.endsWith('_hash')||x==='protected_baseline');
const STEPS=new Set(['freeze','deploy_worker','deploy_gateway','verify_next','rollback_gateway',
 'rollback_worker','verify_previous','release']);
const TERMINALS=new Set(['SUCCEEDED','ROLLED_BACK','FREEZE_UNCERTAIN','ROLLBACK_BLOCKED',
 'UNFREEZE_UNCERTAIN','ADMISSION_BLOCKED']);
const MAX_WINDOW_MS=60*60*1000;
const MAX_EVENTS=32;

function require(ok,code){if(!ok)throw new Error(code);}
function plain(value){return value!==null&&typeof value==='object'&&!Array.isArray(value);}
function exact(value,keys){
 return plain(value)&&Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k));
}
function canonical(value){
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(plain(value))return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
 require(value===null||typeof value==='string'||typeof value==='boolean'||
  (typeof value==='number'&&Number.isSafeInteger(value)),'invalid_canonical_value');
 return JSON.stringify(value);
}
export function evidenceDigest(value){return createHash('sha256').update(canonical(value)).digest('hex');}
const same=(a,b)=>evidenceDigest(a)===evidenceDigest(b);
function deepFreeze(x){
 if(x&&typeof x==='object'){Object.values(x).forEach(deepFreeze);Object.freeze(x);}
 return x;
}
const match=(re,x)=>typeof x==='string'&&re.test(x);

function validateTags(tags){
 return plain(tags)&&Object.keys(tags).length<=20&&Object.entries(tags).every(([k,v])=>
  /^[a-z0-9][a-z0-9-]{0,62}$/.test(k)&&match(REV,v));
}
function validateObserved(x){
 require(exact(x,OBSERVED_KEYS)&&match(SHA,x.source_sha)&&match(DIGEST,x.gateway_digest)&&
  match(DIGEST,x.worker_digest)&&match(REV,x.revision)&&validateTags(x.tags)&&URI.has(x.uri)&&
  HASH_KEYS.every(k=>match(HEX,x[k])),'invalid_observed_anchor');
}
function validateBundle(bundle,pin){
 require(match(HEX,pin)&&exact(bundle,['schema_version','environment','work_item_ref','plan_hash',
  'previous','next','operator_source_sha','build_id','evidence','issued_at_ms','expires_at_ms']),
  'invalid_evidence_bundle');
 require(evidenceDigest(bundle)===pin,'evidence_pin_mismatch');
 require(bundle.schema_version==='1.0'&&bundle.environment==='dev'&&bundle.work_item_ref==='#589'&&
  match(HEX,bundle.plan_hash)&&match(SHA,bundle.operator_source_sha)&&match(BUILD,bundle.build_id),
  'evidence_scope_mismatch');
 validateObserved(bundle.previous);
 const next=bundle.next;
 require(exact(next,['source_sha','gateway_digest','worker_digest','catalog','previous_catalog'])&&
  match(SHA,next.source_sha)&&match(DIGEST,next.gateway_digest)&&match(DIGEST,next.worker_digest)&&
  match(CATALOG,next.catalog)&&match(CATALOG,next.previous_catalog),'invalid_target_binding');
 require(exact(bundle.evidence,EVIDENCE_KEYS)&&EVIDENCE_KEYS.every(k=>match(REF,bundle.evidence[k])),
  'missing_authoritative_evidence_reference');
 require(Number.isSafeInteger(bundle.issued_at_ms)&&Number.isSafeInteger(bundle.expires_at_ms)&&
  bundle.issued_at_ms>=0&&bundle.expires_at_ms>bundle.issued_at_ms&&
  bundle.expires_at_ms-bundle.issued_at_ms<=MAX_WINDOW_MS,'invalid_evidence_window');
}
// R708-F01: expiry stops forward dispatch, not bounded compensation in
// the already admitted session. The journal and owned lease remain mandatory.
function checkStepWindow(bundle,now,step,history){
 const current=now();
 require(Number.isSafeInteger(current)&&current>=bundle.issued_at_ms,'evidence_window_closed');
 if(current<bundle.expires_at_ms)return;
 const confirmed=name=>history.some(e=>e.step===name&&e.outcome==='CONFIRMED');
 const last=history.at(-1);
 const completion=['rollback_gateway','rollback_worker','verify_previous'].includes(step)||
  (step==='verify_next'&&confirmed('deploy_worker')&&confirmed('deploy_gateway'))||
  (step==='release'&&last?.outcome==='CONFIRMED'&&
   ['verify_next','verify_previous'].includes(last.step));
 require(completion&&confirmed('freeze'),'evidence_window_closed');
}

function checkWindow(bundle,now){
 const current=now();
 require(Number.isSafeInteger(current)&&current>=bundle.issued_at_ms&&current<bundle.expires_at_ms,
  'evidence_window_closed');
}

/** Pin must be obtained out of band from the independently reviewed evidence
 * selected through the standard GitHub connector. This module checks integrity
 * and scope; it cannot authenticate a GitHub author or certify cost itself.
 * Never calculate the trusted pin from the incoming bundle in a live caller.
 */
export function pinnedPairAdmission(bundle,trustedPin,now=Date.now){
 validateBundle(bundle,trustedPin);
 const admitted=deepFreeze(JSON.parse(canonical(bundle)));
 const assertFresh=()=>checkWindow(admitted,now);
 assertFresh();
 const base=p=>({verified:true,environment:'dev',work_item_ref:'#589',
  source_sha:p.source_sha,plan_hash:p.plan_hash});
 function bind(p,observed,target){
  assertFresh();
  require(p.environment==='dev'&&p.work_item_ref==='#589'&&p.plan_hash===admitted.plan_hash&&
   p.source_sha===admitted.next.source_sha&&same(observed,admitted.previous)&&
   same(target,admitted.next),'approved_plan_drift');
 }
 return Object.freeze({
  bundle:admitted,pin:trustedPin,assertFresh,bind,
  verifyApproval:async p=>({...base(p),kind:'OWNER_APPROVAL',approval_ref:admitted.evidence.approval}),
  verifyImagePair:async p=>({...base(p),kind:'IMMUTABLE_IMAGE_PAIR'}),
  verifyCost:async p=>({...base(p),kind:'COST_ADMISSION',no_incremental_cost_proven:true}),
  verifyMaintenanceWindow:async p=>({...base(p),kind:'MAINTENANCE_WINDOW',
   retrieve_and_deploy_excluded:true,tagged_revision_lease_compatible:true,
   rollback_authorized:true,operator_access_verified:true}),
 });
}

export function pairOperationIdentity(approvalRef){
 require(match(REF,approvalRef),'invalid_approval_ref');
 const key=evidenceDigest({environment:'dev',work_item_ref:'#589',operation:'dev-ops-pair',
  approval_ref:approvalRef});
 return Object.freeze({key,path:'control/v1/deployments/'+key+'.json',
  maintenance_id:'maintenance-'+key});
}
function validPath(path){return typeof path==='string'&&/^control\/v1\/deployments\/[a-f0-9]{64}\.json$/.test(path);}

/** Existing GCS store contract, with the separately authorized operator's
 * credentials rather than a gateway/worker metadata token. No new IAM here.
 */
export function operatorPairStore(options={}){
 return operatorStateStore(validPath,options);
}
export function operatorBuildStore(options={}){
 return operatorStateStore(path=>typeof path==='string'&&/^control\/v1\/builds\/[a-f0-9]{64}\.json$/.test(path),options);
}
// Separate, explicitly admitted product/DB release authority only. No default
// gcloud or generic operator credentials for this store.
export function operatorMigrationStore(options={}){
 require(typeof options.getToken==='function','migration_release_identity_required');
 return operatorStateStore(path=>typeof path==='string'&&/^control\/v1\/migrations\/[a-f0-9]{64}\.(?:claim|receipt)\.json$/.test(path),options);
}
export function operatorProductJobStore(options={}){
 require(typeof options.getToken==='function','product_job_release_identity_required');
 return operatorStateStore(path=>typeof path==='string'&&/^control\/v1\/product-job-steps\/[a-f0-9]{64}\.(?:claim|receipt)\.json$/.test(path),options);
}
function operatorStateStore(allowedPath,{getToken,fetchImpl=fetch}={}){
 const tokenProvider=getToken||asyncToken;
 async function request(bucket,path,{write=false,data,generation}={}){
  require(bucket===BUCKET&&allowedPath(path),'pair_store_path_denied');
  const token=await tokenProvider();
  require(typeof token==='string'&&token.length>0,'operator_token_missing');
  const root='https://storage.googleapis.com';
  const headers={Authorization:'Bearer '+token,Accept:'application/json'};
  let url=root+'/storage/v1/b/'+BUCKET+'/o/'+encodeURIComponent(path)+'?alt=media';
  const init={headers,redirect:'error',signal:AbortSignal.timeout(20000)};
  if(write){
   require(generation==='0'||match(GEN,generation),'invalid_generation');
   url=root+'/upload/storage/v1/b/'+BUCKET+'/o?'+new URLSearchParams({
    uploadType:'media',name:path,ifGenerationMatch:generation});
   init.method='POST';
   headers['Content-Type']='application/json';
   init.body=JSON.stringify(data);
  }
  const response=await fetchImpl(url,init);
  if(!write&&response.status===404)return null;
  if(write&&response.status===412)throw Error('generation_precondition_failed');
  require(response.ok,'pair_store_http_error');
  const value=await response.json();
  if(write){
   require(match(GEN,value?.generation),'pair_store_write_uncertain');
   return value;
  }
  const g=response.headers.get('x-goog-generation');
  require(match(GEN,g)&&plain(value),'pair_store_read_invalid');
  return {data:value,generation:g};
 }
 async function asyncToken(){
  const {stdout}=await promisify(execFile)('gcloud',['auth','print-access-token','--quiet'],
   {timeout:30000,maxBuffer:65536});
  return stdout.trim();
 }
 return gcsDevOperationStore(BUCKET,{
  read:(b,p)=>request(b,p),
  create:(b,p,data,generation)=>request(b,p,{write:true,data,generation:String(generation)}),
  replace:(b,p,data,generation)=>request(b,p,{write:true,data,generation}),
 });
}

function storeValid(store){
 require(['get','create','replace'].every(k=>typeof store?.[k]==='function'),'pair_store_required');
}
function checkedRecord(current,identity){
 const r=current?.data;
 require(match(GEN,current?.generation)&&exact(r,['schema_version','environment','operation_kind',
  'operation_id','maintenance_id','approval_ref','evidence_hash','bundle','state','history','updated_at_ms'])&&r.schema_version==='1.0'&&
  r.environment==='dev'&&r.operation_kind==='dev-ops-pair'&&
  r.operation_id===identity.key&&r.maintenance_id===identity.maintenance_id&&
  pairOperationIdentity(r.approval_ref).key===identity.key&&match(HEX,r.evidence_hash)&&
  Array.isArray(r.history)&&r.history.length<=MAX_EVENTS&&Number.isSafeInteger(r.updated_at_ms)&&
  (r.state==='RESERVED'||r.state==='RUNNING'||TERMINALS.has(r.state)),
  'pair_record_invalid');
 validateBundle(r.bundle,r.evidence_hash);
 require(r.bundle.evidence.approval===r.approval_ref,'pair_record_approval_mismatch');
 let pending=null;
 for(const e of r.history){
  require(exact(e,['step','outcome','at_ms'])&&STEPS.has(e.step)&&Number.isSafeInteger(e.at_ms),
   'invalid_pair_history');
  if(e.outcome==='INTENT'){require(pending===null,'unresolved_pair_intent');pending=e.step;}
  else{require(['CONFIRMED','UNKNOWN'].includes(e.outcome)&&pending===e.step,'invalid_pair_receipt');pending=null;}
 }
 require(r.state!=='RESERVED'||r.history.length===0,'invalid_pair_reservation');
 return r;
}

export async function readPairOperation(store,approvalRef){
 storeValid(store);
 const identity=pairOperationIdentity(approvalRef);
 const current=await store.get(identity.path);
 if(current===null)return null;
 return {identity,record:checkedRecord(current,identity),generation:current.generation};
}

export async function reservePairOperation(store,admission,now=Date.now){
 storeValid(store);
 admission.assertFresh();
 const identity=pairOperationIdentity(admission.bundle.evidence.approval);
 const record={schema_version:'1.0',environment:'dev',operation_kind:'dev-ops-pair',
  operation_id:identity.key,maintenance_id:identity.maintenance_id,
  approval_ref:admission.bundle.evidence.approval,evidence_hash:admission.pin,
  bundle:admission.bundle,state:'RESERVED',history:[],updated_at_ms:now()};
 try{
  await store.create(identity.path,record);
 }catch(e){
  if(e?.message!=='generation_precondition_failed')throw e;
  const existing=await readPairOperation(store,record.approval_ref);
  require(existing&&existing.record.evidence_hash===record.evidence_hash,'approval_already_consumed');
  return {created:false,...existing};
 }
 const current=await store.get(identity.path);
 require(same(checkedRecord(current,identity),record),'pair_reservation_unconfirmed');
 return {created:true,identity,record,generation:current.generation};
}

export class PairJournal {
 constructor(store,reservation,admission,now=Date.now){
  require(reservation.created===true,'duplicate_operation');
  this.store=store;this.identity=reservation.identity;this.record=reservation.record;
  this.generation=reservation.generation;this.admission=admission;this.now=now;
  this.poisoned=false;this.inFlight=false;
 }
 async persist(next){
  require(!this.poisoned,'pair_journal_uncertain');
  try{
   const updated={...this.record,...next,updated_at_ms:this.now()};
   await this.store.replace(this.identity.path,updated,this.generation);
   const current=await this.store.get(this.identity.path);
   require(same(checkedRecord(current,this.identity),updated)&&current.generation!==this.generation,
    'pair_journal_write_unconfirmed');
   this.record=updated;this.generation=current.generation;
  }catch(e){this.poisoned=true;throw e;}
 }
 async event(step,outcome){
  require(STEPS.has(step)&&['INTENT','CONFIRMED','UNKNOWN'].includes(outcome)&&
   this.record.history.length<MAX_EVENTS,'pair_journal_event_denied');
  const history=[...this.record.history,{step,outcome,at_ms:this.now()}];
  await this.persist({state:'RUNNING',history});
 }
 async step(step,invoke){
  require(!this.poisoned&&!this.inFlight&&!TERMINALS.has(this.record.state),'pair_journal_blocked');
  const history=this.record.history;
  checkStepWindow(this.admission.bundle,this.now,step,history);
  this.inFlight=true;
  try{
   // Confirm the write-ahead intent before dispatch. A compound gateway step
   // can include staging and traffic transfer; recovery never replays either.
   await this.event(step,'INTENT');
   let result;
   try{checkStepWindow(this.admission.bundle,this.now,step,history);result=await invoke();}
   catch(e){await this.event(step,'UNKNOWN');throw e;}
   await this.event(step,'CONFIRMED');
   return result;
  }finally{this.inFlight=false;}
 }
 async finish(state){
  require(TERMINALS.has(state)&&!this.inFlight,'invalid_pair_terminal_state');
  await this.persist({state});
 }
}

export function summarizePairRecord(record){
 return {operation_id:record.operation_id,state:record.state,
  last_event:record.history.at(-1)||null,automatic_retry:false};
}

/** Read-only reconciliation, never an approval to release or roll back. */
export function reconcilePairRecord(record,live){
 const b=record.bundle,old=b.previous,next=b.next;
 const observedBinding=x=>exact(x,['source_sha','gateway_digest','worker_digest'])&&
  match(SHA,x.source_sha)&&match(DIGEST,x.gateway_digest)&&match(DIGEST,x.worker_digest);
 require(exact(live,['gateway_binding','worker_binding','effective_binding','gateway_template_hash',
  'worker_template_hash','gateway_policy_hash','worker_policy_hash','revision','tags','uri','catalog',
  'protected_baseline','lease_state','lease_generation'])&&
  ['gateway_binding','worker_binding','effective_binding'].every(k=>observedBinding(live[k]))&&
  ['gateway_template_hash','worker_template_hash','gateway_policy_hash','worker_policy_hash',
   'protected_baseline'].every(k=>match(HEX,live[k]))&&match(REV,live.revision)&&validateTags(live.tags)&&
  URI.has(live.uri)&&match(CATALOG,live.catalog)&&
  ['OWNED_ACTIVE','OWNED_RELEASED','ABSENT','OTHER','AMBIGUOUS'].includes(live.lease_state)&&
  (['OWNED_ACTIVE','OWNED_RELEASED','AMBIGUOUS'].includes(live.lease_state)?
   match(GEN,live.lease_generation):live.lease_generation===null),
  'invalid_recovery_observation');
 const values=x=>({source_sha:x.source_sha,gateway_digest:x.gateway_digest,worker_digest:x.worker_digest});
 const bindingMatches=x=>['gateway_binding','worker_binding','effective_binding'].every(k=>same(live[k],values(x)));
 const common=live.gateway_policy_hash===old.gateway_policy_hash&&live.worker_policy_hash===old.worker_policy_hash&&
  same(live.tags,old.tags)&&live.uri===old.uri;
 const restored=common&&bindingMatches(old)&&live.revision===old.revision&&
  live.gateway_template_hash===old.gateway_template_hash&&live.worker_template_hash===old.worker_template_hash&&
  live.catalog===next.previous_catalog;
 const deployed=common&&bindingMatches(next)&&live.revision!==old.revision&&
  live.gateway_template_hash===old.next_gateway_template_hash&&live.worker_template_hash===old.next_worker_template_hash&&
  live.catalog===next.catalog;
 return {...summarizePairRecord(record),
  live_pair:restored?'PREVIOUS_PAIR':deployed?'PROPOSED_PAIR':'MIXED_OR_DRIFT',
  protected_match:live.protected_baseline===old.protected_baseline,
  lease_state:live.lease_state,lease_generation:match(GEN,live.lease_generation)?live.lease_generation:null,
  recovery_authorization_required:true,mutation_authorized:false};
}
