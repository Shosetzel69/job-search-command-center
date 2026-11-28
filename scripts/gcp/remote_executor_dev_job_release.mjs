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
 const identity=x=>operatorExact(x,['source_sha','digest','template_sha256','build_id'])&&match(SHA,x.source_sha)&&
  match(DIGEST,x.digest)&&match(HEX,x.template_sha256)&&match(UUID,x.build_id);
 require(operatorExact(record,keys)&&match(HEX,pin)&&operatorHash(record)===pin&&
  record.schema_version==='1.0'&&record.environment==='dev'&&record.work_item_ref==='#589'&&
  Object.hasOwn(JOBS,record.role)&&['stage','restore'].includes(record.phase)&&
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
 else require(short(positive[0].revision)===x.service_revision,'product_job_service_rollback_order');
 const rev=await call(RUN+path+'/revisions/'+x.service_revision),c=rev?.containers?.[0];
 const env=c?.env||[],sha=env.filter(e=>e.name==='SOURCE_SHA'),runtime=env.filter(e=>e.name==='RUNTIME_DATA_SHA');
 const expected=x.phase==='stage'?x.candidate.source_sha:x.previous.source_sha;
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
 * pre-staged Service health (Search), signed dispatch exclusion, prior
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
 const from=x.phase==='stage'?x.previous:x.candidate,to=x.phase==='stage'?x.candidate:x.previous,path=jobPath(x.role);
 await verifyArtifact(call,x.role,to);
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
 const from=x.phase==='stage'?x.previous:x.candidate,to=x.phase==='stage'?x.candidate:x.previous;
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
