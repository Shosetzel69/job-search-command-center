// #589: extend the existing guarded DEV product Job release procedure.
// Separate release authority only. Not a generic MCP action, not a new
// product release route, no Search execution, SQL, lock acquisition/release.
import {operatorExact,operatorHash,operatorRequire as require,operatorLro} from '../../ops/src/dev_operator_contract.mjs';
import {operatorProductJobStore} from './remote_executor_dev_admission.mjs';
import {transport,verifyLock,verifyIdle} from './remote_executor_dev_nile_013.mjs';
const ROOT='projects/jscc-dev/locations/europe-west1',RUN='https://run.googleapis.com/v2/';
const REG='projects/jscc-shared/locations/europe-west1/repositories/jscc';
const IMAGE='europe-west1-docker.pkg.dev/jscc-shared/jscc/';
const SA='jscc-dev-runtime@jscc-dev.iam.gserviceaccount.com';
const BUILDER='projects/jscc-shared/serviceAccounts/jscc-build@jscc-shared.iam.gserviceaccount.com';
const JOBS={search:'jscc-search-dev',migration:'jscc-db-migrate-dev'};
const PKG={search:'jscc',migration:'jscc-service'};
const SHA=/^[a-f0-9]{40}$/,HEX=/^[a-f0-9]{64}$/,DIGEST=/^sha256:[a-f0-9]{64}$/;
const REF=/^#589\/[1-9][0-9]{0,19}$/,GEN=/^[1-9][0-9]{0,19}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const REV=/^jscc-command-api-dev-[a-z0-9-]{1,44}$/;
const match=(r,x)=>typeof x==='string'&&r.test(x);
const same=(a,b)=>operatorHash(a)===operatorHash(b);
const bound=(x,path)=>x===path||x===path.replace('projects/jscc-dev/','projects/828902654738/');
const jobPath=role=>ROOT+'/jobs/'+JOBS[role];
const image=(role,digest)=>IMAGE+PKG[role]+'@'+digest;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function admit(record,pin,now){
 const keys=['schema_version','environment','work_item_ref','role','phase','source_sha','lock_generation',
  'lock_payload_sha256','catalog_generation','previous','candidate','service_revision','service_digest',
  'approval_ref','review_ref','cost_ref','access_ref','compatibility_ref','issued_at_ms','expires_at_ms'];
 const align=record?.phase==='align';
 if(align)keys.push('service_release_ref','service_build_id','schema_change_required');
 const identity=x=>operatorExact(x,['source_sha','digest','template_sha256','build_id'])&&match(SHA,x.source_sha)&&
  match(DIGEST,x.digest)&&match(HEX,x.template_sha256)&&match(UUID,x.build_id);
 require(operatorExact(record,keys)&&match(HEX,pin)&&operatorHash(record)===pin&&
  record.schema_version==='1.0'&&record.environment==='dev'&&record.work_item_ref==='#589'&&
  Object.hasOwn(JOBS,record.role)&&['stage','restore','align'].includes(record.phase)&&
  (!align||record.role==='search'&&record.schema_change_required===false&&match(REF,record.service_release_ref)&&
   match(UUID,record.service_build_id)&&![record.approval_ref,record.review_ref,record.cost_ref,record.access_ref,record.compatibility_ref].includes(record.service_release_ref))&&
  identity(record.previous)&&identity(record.candidate)&&record.source_sha===record.candidate.source_sha&&
  record.previous.source_sha!==record.candidate.source_sha&&record.previous.digest!==record.candidate.digest&&
  match(GEN,record.lock_generation)&&match(HEX,record.lock_payload_sha256)&&match(GEN,record.catalog_generation)&&
  (record.role==='search'?match(REV,record.service_revision)&&match(DIGEST,record.service_digest):
   record.service_revision===null&&record.service_digest===null)&&
  [record.approval_ref,record.review_ref,record.cost_ref,record.access_ref,record.compatibility_ref].every(x=>match(REF,x))&&
  new Set([record.approval_ref,record.review_ref,record.cost_ref,record.access_ref,record.compatibility_ref]).size===5&&
  Number.isSafeInteger(record.issued_at_ms)&&Number.isSafeInteger(record.expires_at_ms)&&
  record.expires_at_ms>record.issued_at_ms&&record.expires_at_ms-record.issued_at_ms<=3600000,'product_job_admission_denied');
 const x=JSON.parse(JSON.stringify(record));
 const fresh=()=>require(now()>=x.issued_at_ms&&now()<x.expires_at_ms,'product_job_approval_expired');
 fresh();return {x,fresh};
}
function checkTemplate(template,role,identity){
 require(template?.taskCount===1&&template.parallelism===1&&template.template?.serviceAccount===SA&&
  template.template.containers?.length===1&&sameHash(template,identity.template_sha256),'product_job_template_binding_mismatch');
 const c=template.template.containers[0],entries=c.env||[];
 require(c.image===image(role,identity.digest)&&Array.isArray(entries)&&entries.length<=128&&
  entries.every(x=>typeof x.name==='string')&&new Set(entries.map(x=>x.name)).size===entries.length,'product_job_container_denied');
 const e=Object.fromEntries(entries.map(x=>[x.name,x]));
 const plain=(k,v)=>e[k]?.value===v&&!e[k].valueSource;
 const secret=k=>{
  const v=e[k]?.valueSource?.secretKeyRef;
  return v&&['NILE_DATABASE_URL','projects/jscc-dev/secrets/NILE_DATABASE_URL',
   'projects/828902654738/secrets/NILE_DATABASE_URL'].includes(v.secret)&&v.version==='1'&&!Object.hasOwn(e[k],'value');
 };
 require(plain('APP_ENV','dev')&&plain('SOURCE_SHA',identity.source_sha)&&secret('NILE_DATABASE_URL'),'product_job_environment_denied');
 if(role==='migration')require(plain('DB_MIGRATION_MODE','refuse')&&secret('NILE_MIGRATION_DATABASE_URL')&&
  template.template.maxRetries===0&&template.template.timeout==='600s'&&c.command?.length===1&&c.command[0]==='/bin/bash'&&
  c.args?.length===2&&c.args[0]==='-ceu'&&!(template.template.volumes||[]).length&&!(c.volumeMounts||[]).length&&
  !entries.some(v=>/^(?:EVALUATION013|RETRIEVE01[12])_(?:MODE|OWNER_GATE)$/.test(v.name)),'product_job_migration_default_denied');
 if(role==='search')require(plain('GCP_RUNTIME_BUCKET','jscc-dev-runtime-828902654738'),'product_job_search_bucket_denied');
}
const sameHash=(x,h)=>operatorHash(x)===h;
function readback(raw,role,identity){
 require(bound(raw?.name,jobPath(role))&&raw.reconciling!==true&&typeof raw.etag==='string'&&raw.etag.length>0&&
  raw.etag.length<=1024&&raw.generation&&raw.generation===raw.observedGeneration&&
  raw.terminalCondition?.state==='CONDITION_SUCCEEDED','product_job_not_reconciled');
 checkTemplate(raw.template,role,identity);return raw;
}
function nextTemplate(raw,role,target){
 const t=structuredClone(raw.template),c=t.template.containers[0];
 c.image=image(role,target.digest);c.env.find(x=>x.name==='SOURCE_SHA').value=target.source_sha;
 checkTemplate(t,role,target);return t;
}
async function verifyArtifact(call,role,target){
 const repo=await call('https://artifactregistry.googleapis.com/v1/'+REG);
 require(repo.name===REG&&repo.dockerConfig?.immutableTags===true,'product_job_registry_denied');
 const parent=REG+'/packages/'+PKG[role],name=parent+'/tags/'+target.source_sha;
 const tag=await call('https://artifactregistry.googleapis.com/v1/'+name);
 require(tag.name===name&&tag.version===parent+'/versions/'+target.digest,'product_job_tag_mismatch');
 const path='projects/jscc-shared/locations/europe-west1/builds/'+target.build_id;
 const build=await call('https://cloudbuild.googleapis.com/v1/'+path);
 require(build.name===path&&build.id===target.build_id&&build.serviceAccount===BUILDER&&build.status==='SUCCESS'&&
  build.substitutions?._GIT_SHA===target.source_sha&&Array.isArray(build.results?.images)&&build.results.images.length<=20&&
  build.results.images.filter(i=>i.name===IMAGE+PKG[role]+':'+target.source_sha&&i.digest===target.digest).length===1,
  'product_job_build_unverified');
}
async function serviceGate(call,x){
 if(x.role!=='search')return;
 const path=ROOT+'/services/jscc-command-api-dev';
 const svc=await call(RUN+path);
 require(bound(svc.name,path)&&svc.reconciling!==true&&svc.generation===svc.observedGeneration&&
  svc.terminalCondition?.state==='CONDITION_SUCCEEDED'&&Array.isArray(svc.trafficStatuses)&&svc.trafficStatuses.length<=20,
  'product_job_service_unverified');
 const rows=svc.trafficStatuses,positive=rows.filter(t=>(t.percent??0)>0),short=v=>typeof v==='string'?v.split('/').at(-1):'';
 require(positive.length===1&&positive[0].percent===100,'product_job_service_traffic_denied');
 if(x.phase==='stage')require(short(positive[0].revision)!==x.service_revision&&rows.some(t=>
  short(t.revision)===x.service_revision&&(t.percent??0)===0&&typeof t.tag==='string'&&t.tag.length>0),'product_job_service_not_staged');
 else require(short(positive[0].revision)===x.service_revision,x.phase==='align'?
  'product_job_service_not_serving_candidate':'product_job_service_rollback_order');
 const rev=await call(RUN+path+'/revisions/'+x.service_revision),c=rev?.containers?.[0];
 const env=c?.env||[],sha=env.filter(e=>e.name==='SOURCE_SHA'),runtime=env.filter(e=>e.name==='RUNTIME_DATA_SHA');
 const expected=x.phase==='restore'?x.previous.source_sha:x.candidate.source_sha;
 require(bound(rev?.name,path+'/revisions/'+x.service_revision)&&rev.serviceAccount===SA&&rev.containers?.length===1&&
  rev.conditions?.some(t=>t.type==='Ready'&&t.state==='CONDITION_SUCCEEDED')&&c.image===IMAGE+'jscc-service@'+x.service_digest&&
  sha.length===1&&runtime.length===1&&sha[0].value===expected&&runtime[0].value===expected&&
  !sha[0].valueSource&&!runtime[0].valueSource,'product_job_service_revision_mismatch');
}
async function poll(call,op,wait){
 const name=operatorLro(op?.name);
 require(name,'product_job_lro_denied');
 for(let i=0;i<25;i++){
  require(op?.name===name&&!op.error,'product_job_lro_unverified');
  if(op.done===true)return;
  await wait(1500);op=await call(RUN+name);
 }
 throw Error('product_job_lro_timeout');
}
/** Independently authenticated authority must bind exact owner/review/cost,
 * pre-staged Service health (Search) or exact existing Service-only release
 * plus already-compatible managed schema (align only), signed dispatch exclusion, prior
 * template/default refusal and rollback compatibility. No default identity. */
export async function executeApprovedProductJobStep(record,{
 trustedRecordHash,verifyAuthority,getToken,fetchImpl=fetch,store,now=Date.now,wait=delay
}={}){
 const {x,fresh}=admit(record,trustedRecordHash,now);
 require(typeof getToken==='function'&&typeof verifyAuthority==='function'&&await verifyAuthority(x)===true,
  'product_job_authority_denied');fresh();
 const call=transport(getToken,fetchImpl),ledger=store||operatorProductJobStore({getToken,fetchImpl});
 const key=operatorHash({environment:'dev',work_item_ref:'#589',operation:'product-job-step',approval_ref:x.approval_ref});
 const base='control/v1/product-job-steps/'+key,claim={environment:'dev',operation_id:key,evidence_hash:trustedRecordHash,
  role:x.role,phase:x.phase,approval_ref:x.approval_ref};
 const prior=await ledger.get(base+'.claim.json');
 if(prior){
  require(match(GEN,prior.generation)&&same(prior.data,claim),'product_job_claim_mismatch');
  return {operation_id:key,state:'ALREADY_CLAIMED',automatic_retry:false};
 }
 const from=x.phase==='restore'?x.candidate:x.previous,to=x.phase==='restore'?x.previous:x.candidate,path=jobPath(x.role);
 await verifyArtifact(call,x.role,to);
 if(x.phase==='align')await verifyArtifact(call,'migration',{source_sha:x.source_sha,digest:x.service_digest,build_id:x.service_build_id});
 await verifyLock(call,x);await verifyIdle(call);await serviceGate(call,x);
 const raw=readback(await call(RUN+path),x.role,from),template=nextTemplate(raw,x.role,to);
 const body={name:raw.name,etag:raw.etag,template};
 const url=RUN+path+'?updateMask=template&allowMissing=false';
 fresh();
 try{await ledger.create(base+'.claim.json',claim);}
 catch(e){if(e?.message==='generation_precondition_failed')return {operation_id:key,state:'ALREADY_CLAIMED',automatic_retry:false};throw e;}
 const stored=await ledger.get(base+'.claim.json');
 require(match(GEN,stored?.generation)&&same(stored.data,claim),'product_job_claim_unverified');
 try{
  fresh();await poll(call,await call(url+'&validateOnly=true',{method:'PATCH',body}),wait);
  await verifyLock(call,x);await verifyIdle(call);await serviceGate(call,x);
  require(readback(await call(RUN+path),x.role,from).etag===raw.etag,'product_job_etag_drift');
  fresh();await poll(call,await call(url+'&validateOnly=false',{method:'PATCH',body}),wait);
  const after=readback(await call(RUN+path),x.role,to);
  await verifyLock(call,x);await verifyIdle(call);await serviceGate(call,x);
  const receipt={...claim,state:'OBSERVED',template_sha256:operatorHash(after.template),source_sha:to.source_sha,
   digest:to.digest,automatic_retry:false,functional_acceptance:'PENDING',lock_release_authorized:false};
  await ledger.create(base+'.receipt.json',receipt);
  const saved=await ledger.get(base+'.receipt.json');
  require(match(GEN,saved?.generation)&&same(saved.data,receipt),'product_job_receipt_unverified');return receipt;
 }catch{return {operation_id:key,state:'RECOVERY_REQUIRED',automatic_retry:false,lock_release_authorized:false};}
}


// Reconcile a claim by reading the exact Job and owned lock. A matching
// template is observation only, never permission to replay or resume dispatch.
export async function observeApprovedProductJobStep(record,{
 trustedRecordHash,verifyAuthority,getToken,fetchImpl=fetch,store,now=Date.now
}={}){
 const {x}=admit(record,trustedRecordHash,()=>record?.issued_at_ms);
 require(typeof getToken==='function'&&typeof verifyAuthority==='function'&&await verifyAuthority(x)===true&&
  Number.isSafeInteger(now())&&now()>=x.issued_at_ms,'product_job_authority_denied');
 const key=operatorHash({environment:'dev',work_item_ref:'#589',operation:'product-job-step',approval_ref:x.approval_ref});
 const base='control/v1/product-job-steps/'+key,ledger=store||operatorProductJobStore({getToken,fetchImpl});
 const claim={environment:'dev',operation_id:key,evidence_hash:trustedRecordHash,role:x.role,phase:x.phase,approval_ref:x.approval_ref};
 const stored=await ledger.get(base+'.claim.json');
 require(match(GEN,stored?.generation)&&same(stored.data,claim),'product_job_claim_unverified');
 const receipt=await ledger.get(base+'.receipt.json');
 const from=x.phase==='restore'?x.candidate:x.previous,to=x.phase==='restore'?x.previous:x.candidate;
 if(receipt){
  const expected={...claim,state:'OBSERVED',template_sha256:to.template_sha256,source_sha:to.source_sha,
   digest:to.digest,automatic_retry:false,functional_acceptance:'PENDING',lock_release_authorized:false};
  require(match(GEN,receipt.generation)&&same(receipt.data,expected),'product_job_receipt_unverified');
 }
 const call=transport(getToken,fetchImpl);
 await verifyLock(call,x);await verifyIdle(call);await serviceGate(call,x);
 const raw=await call(RUN+jobPath(x.role)),hash=operatorHash(raw.template);
 let status='DRIFT',identity=null;
 if(hash===from.template_sha256){readback(raw,x.role,from);status='PREVIOUS';identity=from;}
 else if(hash===to.template_sha256){readback(raw,x.role,to);status='TARGET';identity=to;}
 await verifyLock(call,x);
 const again=await call(RUN+jobPath(x.role));
 require(raw.etag===again.etag&&operatorHash(again.template)===hash,'product_job_recovery_drift');
 return {operation_id:key,state:'OBSERVED',template_state:status,template_sha256:hash,
  source_sha:identity?.source_sha??null,digest:identity?.digest??null,receipt_available:Boolean(receipt),
  automatic_retry:false,functional_acceptance:'PENDING',lock_release_authorized:false};
}


// Existing signed Retrieve dispatch remains the only launch path. This
// separately authorized release-side cancellation cannot initiate a run,
// change scope, or delete/release its markers, even after a terminal result.
const RUN_ID=/^run-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SEARCH_EXEC=/^jscc-search-dev-[a-z0-9-]{1,40}$/;
const RUNTIME_BUCKET='jscc-dev-runtime-828902654738';
const STORAGE='https://storage.googleapis.com/storage/v1/b/'+RUNTIME_BUCKET+'/o/';
function admitSearchCancel(record,pin,now){
 const keys=['schema_version','environment','work_item_ref','source_sha','digest','execution','uid','run_id',
  'request_signature','scope_sha256','catalog_generation','lock_generation','active_generation','descriptor_sha256',
  'approval_ref','review_ref','cost_ref','access_ref','recovery_ref','issued_at_ms','expires_at_ms'];
 require(operatorExact(record,keys)&&match(HEX,pin)&&operatorHash(record)===pin&&record.schema_version==='1.0'&&
  record.environment==='dev'&&record.work_item_ref==='#589'&&match(SHA,record.source_sha)&&match(DIGEST,record.digest)&&
  match(SEARCH_EXEC,record.execution)&&match(UUID,record.uid)&&match(RUN_ID,record.run_id)&&
  [record.request_signature,record.scope_sha256,record.descriptor_sha256].every(x=>match(HEX,x))&&
  [record.catalog_generation,record.lock_generation,record.active_generation].every(x=>match(GEN,x))&&
  [record.approval_ref,record.review_ref,record.cost_ref,record.access_ref,record.recovery_ref].every(x=>match(REF,x))&&
  new Set([record.approval_ref,record.review_ref,record.cost_ref,record.access_ref,record.recovery_ref]).size===5&&
  Number.isSafeInteger(record.issued_at_ms)&&Number.isSafeInteger(record.expires_at_ms)&&
  record.expires_at_ms>record.issued_at_ms&&record.expires_at_ms-record.issued_at_ms<=3600000,'search_cancel_admission_denied');
 const x=JSON.parse(JSON.stringify(record));
 const fresh=()=>require(now()>=x.issued_at_ms&&now()<x.expires_at_ms,'search_cancel_approval_expired');
 fresh();return {x,fresh};
}
async function searchMarkers(call,x){
 for(const [object,generation] of [['locks/heavy-search.lock',x.lock_generation],['active.json',x.active_generation]]){
  const path=STORAGE+encodeURIComponent(object),meta=()=>call(path+'?fields=bucket,name,generation');
  const before=await meta();
  require(before.bucket===RUNTIME_BUCKET&&before.name===object&&before.generation===generation,'search_cancel_marker_mismatch');
  const payload=await call(path+'?alt=media&generation='+generation);
  require(payload?.schema_version==='1.0'&&payload.run_id===x.run_id&&payload.source_sha===x.source_sha&&
   payload.request_signature===x.request_signature&&['manual-ui','admin-ui'].includes(payload.run_trigger)&&
   String(payload.retrieve_scope?.source_catalog_generation)===x.catalog_generation&&
   operatorHash(payload.retrieve_scope)===x.scope_sha256&&operatorHash(payload)===x.descriptor_sha256,
   'search_cancel_descriptor_mismatch');
  require((await meta()).generation===generation,'search_cancel_marker_drift');
 }
}
function searchExecution(raw,x){
 const path=jobPath('search')+'/executions/'+x.execution,c=raw?.template?.containers?.[0],env=c?.env||[];
 require(bound(raw?.name,path)&&(raw.job===JOBS.search||bound(raw.job,jobPath('search')))&&raw.uid===x.uid&&
  raw.taskCount===1&&raw.template?.serviceAccount===SA&&raw.template.containers?.length===1&&
  c.image===image('search',x.digest)&&typeof raw.etag==='string'&&raw.etag.length>0&&raw.etag.length<=1024&&
  Array.isArray(env)&&new Set(env.map(y=>y.name)).size===env.length,'search_cancel_execution_binding_mismatch');
 const e=Object.fromEntries(env.map(y=>[y.name,y])),plain=(k,v)=>e[k]?.value===v&&!e[k].valueSource;
 require(plain('APP_ENV','dev')&&plain('SOURCE_SHA',x.source_sha)&&plain('GCP_RUNTIME_BUCKET',RUNTIME_BUCKET)&&
  plain('JSCC_RUN_ID',x.run_id)&&plain('JSCC_REQUEST_SIGNATURE',x.request_signature)&&
  plain('JSCC_SOURCE_CATALOG_GENERATION',x.catalog_generation)&&
  ['manual-ui','admin-ui'].includes(e.RUN_TRIGGER?.value)&&!e.RUN_TRIGGER?.valueSource&&
  typeof e.JSCC_RETRIEVE_SCOPE_JSON?.value==='string'&&!e.JSCC_RETRIEVE_SCOPE_JSON.valueSource&&
  Buffer.byteLength(e.JSCC_RETRIEVE_SCOPE_JSON.value)<=65536&&
  operatorHash(JSON.parse(e.JSCC_RETRIEVE_SCOPE_JSON.value))===x.scope_sha256,'search_cancel_signed_scope_mismatch');
 const terminal=typeof raw.completionTime==='string'&&Number.isFinite(Date.parse(raw.completionTime));
 const completed=(raw.conditions||[]).filter(y=>y.type==='Completed');
 return {terminal,execution_state:!terminal?'RUNNING_OR_PENDING':
  completed.length===1&&completed[0].state==='CONDITION_SUCCEEDED'?'SUCCEEDED':
  completed.length===1&&completed[0].state==='CONDITION_FAILED'?'FAILED_OR_CANCELLED':'TERMINAL_UNVERIFIED'};
}
export async function cancelApprovedSearchExecution(record,{
 trustedRecordHash,verifyAuthority,getToken,fetchImpl=fetch,store,now=Date.now
}={}){
 const {x,fresh}=admitSearchCancel(record,trustedRecordHash,now);
 require(typeof getToken==='function'&&typeof verifyAuthority==='function'&&await verifyAuthority(x)===true,'search_cancel_authority_denied');
 fresh();
 const call=transport(getToken,fetchImpl),ledger=store||operatorProductJobStore({getToken,fetchImpl});
 const key=operatorHash({environment:'dev',work_item_ref:'#589',operation:'search-cancel',approval_ref:x.approval_ref});
 const base='control/v1/product-job-steps/'+key,claim={environment:'dev',operation_id:key,evidence_hash:trustedRecordHash,
  action:'cancel_search',approval_ref:x.approval_ref};
 const prior=await ledger.get(base+'.claim.json');
 if(prior){
  require(match(GEN,prior.generation)&&same(prior.data,claim),'search_cancel_claim_mismatch');
  return {operation_id:key,state:'ALREADY_CLAIMED',automatic_retry:false,lock_release_authorized:false};
 }
 const path=jobPath('search')+'/executions/'+x.execution;
 const raw=await call(RUN+path),observed=searchExecution(raw,x);
 if(observed.terminal)return {operation_id:key,state:'OBSERVED',...observed,cancellation_requested:false,
  automatic_retry:false,lock_release_authorized:false};
 await searchMarkers(call,x);fresh();
 try{await ledger.create(base+'.claim.json',claim);}
 catch(e){if(e?.message==='generation_precondition_failed')return {operation_id:key,state:'ALREADY_CLAIMED',automatic_retry:false,lock_release_authorized:false};throw e;}
 const saved=await ledger.get(base+'.claim.json');
 require(match(GEN,saved?.generation)&&same(saved.data,claim),'search_cancel_claim_unverified');
 try{
  await searchMarkers(call,x);
  const before=await call(RUN+path),current=searchExecution(before,x);
  let op=null;
  if(!current.terminal){
   require(before.etag===raw.etag,'search_cancel_etag_drift');fresh();
   op=await call(RUN+path+':cancel',{method:'POST',body:{etag:before.etag}});
   require(operatorLro(op?.name)&&!op.error,'search_cancel_receipt_unverified');
  }
  const after=searchExecution(await call(RUN+path),x);
  const result={...claim,state:'OBSERVED',execution:x.execution,uid:x.uid,...after,cancellation_requested:op!==null,
   operation_name:op?.name??null,automatic_retry:false,lock_release_authorized:false,db_outcome:'UNVERIFIED'};
  await ledger.create(base+'.receipt.json',result);
  const confirmed=await ledger.get(base+'.receipt.json');
  require(match(GEN,confirmed?.generation)&&same(confirmed.data,result),'search_cancel_receipt_unverified');
  return result;
 }catch{return {operation_id:key,state:'RECOVERY_REQUIRED',automatic_retry:false,lock_release_authorized:false,db_outcome:'UNVERIFIED'};}
}


// Product release handoff for the existing Service-only GitDeploy/GCloudDeploy
// route, ONLY when independent review establishes no managed schema change is
// needed. Never launches a second Service deployment, migration or Retrieve.
// The caller must obtain the exact externally pinned handoff and verify its
// release, schema and lock authority through the existing GitHub authority.
export async function observeCompatibleProductDelivery(record,{
 trustedRecordHash,verifyAuthority,getToken,fetchImpl=fetch,store,now=Date.now
}={}){
 require(operatorExact(record,['schema_version','environment','work_item_ref','step','step_hash','migration_baseline',
  'schema_evidence_ref','service_health_ref','issued_at_ms','expires_at_ms'])&&record.schema_version==='1.0'&&
  record.environment==='dev'&&record.work_item_ref==='#589'&&match(HEX,trustedRecordHash)&&
  operatorHash(record)===trustedRecordHash&&match(HEX,record.step_hash)&&
  operatorHash(record.step)===record.step_hash&&record.step?.phase==='align'&&
  operatorExact(record.migration_baseline,['source_sha','digest','template_sha256','build_id'])&&
  match(SHA,record.migration_baseline.source_sha)&&match(DIGEST,record.migration_baseline.digest)&&
  match(HEX,record.migration_baseline.template_sha256)&&match(UUID,record.migration_baseline.build_id)&&
  match(REF,record.schema_evidence_ref)&&match(REF,record.service_health_ref)&&
  new Set([record.schema_evidence_ref,record.service_health_ref,record.step.approval_ref,record.step.service_release_ref]).size===4&&
  Number.isSafeInteger(record.issued_at_ms)&&Number.isSafeInteger(record.expires_at_ms)&&
  record.expires_at_ms>record.issued_at_ms&&record.expires_at_ms-record.issued_at_ms<=3600000&&
  now()>=record.issued_at_ms&&now()<record.expires_at_ms,'product_delivery_admission_denied');
 const frozen=JSON.parse(JSON.stringify(record));
 const {x}=admit(frozen.step,frozen.step_hash,()=>frozen.step.issued_at_ms);
 require(typeof getToken==='function'&&typeof verifyAuthority==='function'&&await verifyAuthority(frozen)===true,
  'product_delivery_authority_denied');
 const call=transport(getToken,fetchImpl),ledger=store||operatorProductJobStore({getToken,fetchImpl});
 await verifyLock(call,x);await verifyIdle(call);await serviceGate(call,x);
 const migration=readback(await call(RUN+jobPath('migration')),'migration',frozen.migration_baseline);
 const search=await call(RUN+jobPath('search')),hash=operatorHash(search.template);
 const key=operatorHash({environment:'dev',work_item_ref:'#589',operation:'product-job-step',approval_ref:x.approval_ref});
 const base='control/v1/product-job-steps/'+key,claim=await ledger.get(base+'.claim.json'),receipt=await ledger.get(base+'.receipt.json');
 const expectedClaim={environment:'dev',operation_id:key,evidence_hash:frozen.step_hash,role:'search',phase:'align',approval_ref:x.approval_ref};
 if(claim)require(match(GEN,claim.generation)&&same(claim.data,expectedClaim),'product_delivery_claim_mismatch');
 if(receipt)require(claim&&match(GEN,receipt.generation)&&same(receipt.data,{...expectedClaim,state:'OBSERVED',
  template_sha256:x.candidate.template_sha256,source_sha:x.candidate.source_sha,digest:x.candidate.digest,
  automatic_retry:false,functional_acceptance:'PENDING',lock_release_authorized:false}),'product_delivery_receipt_mismatch');
 let disposition='RECOVERY_REQUIRED',searchState='DRIFT';
 if(hash===x.previous.template_sha256){
  readback(search,'search',x.previous);searchState='PREVIOUS';
  if(!claim&&now()>=x.issued_at_ms&&now()<x.expires_at_ms)disposition='SEARCH_ALIGNMENT_PENDING';
 }else if(hash===x.candidate.template_sha256){
  readback(search,'search',x.candidate);searchState='CANDIDATE';
  if(receipt)disposition='INDEPENDENT_ACCEPTANCE_REQUIRED';
 }
 await verifyLock(call,x);await verifyIdle(call);await serviceGate(call,x);
 const after=await call(RUN+jobPath('search')),afterMigration=await call(RUN+jobPath('migration'));
 require(after.etag===search.etag&&operatorHash(after.template)===hash&&
  afterMigration.etag===migration.etag&&operatorHash(afterMigration.template)===frozen.migration_baseline.template_sha256,
  'product_delivery_baseline_drift');
 require(now()<frozen.expires_at_ms,'product_delivery_evidence_expired');
 return {state:'OBSERVED',source_sha:x.source_sha,service_revision:x.service_revision,service_digest:x.service_digest,
  search_state:searchState,search_template_sha256:hash,migration_template_sha256:frozen.migration_baseline.template_sha256,
  migration_default:'REFUSE',disposition,search_approval_ref:x.approval_ref,receipt_available:Boolean(receipt),
  schema_evidence_ref:frozen.schema_evidence_ref,service_health_ref:frozen.service_health_ref,
  automatic_retry:false,lock_release_authorized:false,acceptance:'PENDING'};
}
