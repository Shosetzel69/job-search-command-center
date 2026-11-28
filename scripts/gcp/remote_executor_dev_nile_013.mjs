// #589: dedicated release-side adapter for the already-reviewed 013 script.
// NOT an MCP action and NOT packaged into the generic GCP operator. The
// existing product release authority must independently admit its identity,
// maintenance window, exact pre-staged Job and rollback/restore contract.
// The generic db:migrate entrypoint remains disabled.
import {operatorExact,operatorHash,operatorRequire,operatorLro} from '../../ops/src/dev_operator_contract.mjs';
import {operatorMigrationStore} from './remote_executor_dev_admission.mjs';
const ROOT='projects/jscc-dev/locations/europe-west1';
const JOB='jscc-db-migrate-dev';
const PATH=ROOT+'/jobs/'+JOB;
const RUN='https://run.googleapis.com/v2/';
const BUCKET='jscc-dev-runtime-828902654738';
const STORE='https://storage.googleapis.com/storage/v1/b/'+BUCKET+'/o/';
const IMAGE='europe-west1-docker.pkg.dev/jscc-shared/jscc/jscc-service@';
const REGISTRY='projects/jscc-shared/locations/europe-west1/repositories/jscc';
const BUILDER='projects/jscc-shared/serviceAccounts/jscc-build@jscc-shared.iam.gserviceaccount.com';
const SA='jscc-dev-runtime@jscc-dev.iam.gserviceaccount.com';
const MIGRATION='command-api/scripts/db-evaluation-migrate-013.mjs';
const SQL_FILE='command-api/migrations/013_profile_job_evaluation_listing.sql';
const CHECKSUM='e30fdd8d16e9ec085c97d61011cf27d86ef91056329c8d5ebec3f030ee6aa38a';
const SHA=/^[a-f0-9]{40}$/;
const HEX=/^[a-f0-9]{64}$/;
const DIGEST=/^sha256:[a-f0-9]{64}$/;
const REF=/^#589\/[1-9][0-9]{0,19}$/;
const GEN=/^[1-9][0-9]{0,19}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const EXEC=/^jscc-db-migrate-dev-[a-z0-9-]{1,40}$/;
const match=(r,x)=>typeof x==='string'&&r.test(x);
const bound=(x,path)=>x===path||x===path.replace('projects/jscc-dev/','projects/828902654738/');
const require=operatorRequire;
function admit(value,pin,now){
 const keys=['schema_version','environment','work_item_ref','mode','source_sha','service_digest','build_id',
  'script_sha256','migration_checksum','job_template_sha256','lock_generation','lock_payload_sha256','catalog_generation',
  'approval_ref','review_ref','cost_ref','access_ref','restore_ref','inspection_ref','inspection_execution',
  'issued_at_ms','expires_at_ms'];
 require(operatorExact(value,keys)&&match(HEX,pin)&&operatorHash(value)===pin&&
  value.schema_version==='1.0'&&value.environment==='dev'&&value.work_item_ref==='#589'&&
  ['inspect','apply'].includes(value.mode)&&match(SHA,value.source_sha)&&match(DIGEST,value.service_digest)&&
  match(UUID,value.build_id)&&[value.script_sha256,value.job_template_sha256,value.lock_payload_sha256].every(x=>match(HEX,x))&&
  value.migration_checksum===CHECKSUM&&match(GEN,value.lock_generation)&&match(GEN,value.catalog_generation)&&
  [value.approval_ref,value.review_ref,value.cost_ref,value.access_ref,value.restore_ref].every(x=>match(REF,x))&&
  new Set([value.approval_ref,value.review_ref,value.cost_ref,value.access_ref,value.restore_ref]).size===5&&
  (value.mode==='inspect'?value.inspection_ref===null&&value.inspection_execution===null:
   match(REF,value.inspection_ref)&&value.inspection_ref!==value.approval_ref&&match(EXEC,value.inspection_execution))&&
  Number.isSafeInteger(value.issued_at_ms)&&Number.isSafeInteger(value.expires_at_ms)&&
  value.expires_at_ms>value.issued_at_ms&&value.expires_at_ms-value.issued_at_ms<=3600000,
  'nile_release_approval_denied');
 const x=JSON.parse(JSON.stringify(value));
 const fresh=()=>require(now()>=x.issued_at_ms&&now()<x.expires_at_ms,'nile_release_approval_expired');
 fresh();
 return {x,fresh};
}
function transport(getToken,fetchImpl){
 return async(url,{method='GET',body,absent=false}={})=>{
  const token=await getToken();
  require(typeof token==='string'&&token.length>0&&token.length<=8192,'nile_release_identity_missing');
  const r=await fetchImpl(url,{method,headers:{Authorization:'Bearer '+token,Accept:'application/json',
   ...(body===undefined?{}:{'Content-Type':'application/json'})},redirect:'error',signal:AbortSignal.timeout(20000),
   ...(body===undefined?{}:{body:JSON.stringify(body)})});
  if(absent&&r.status===404)return null;
  require(r.ok,'nile_release_transport_unverified');
  const text=await r.text();
  require(Buffer.byteLength(text)<=262144,'nile_release_response_limit');
  return JSON.parse(text);
 };
}
function verifyTemplate(raw,x){
 require(bound(raw.name,PATH)&&raw.reconciling!==true&&typeof raw.etag==='string'&&raw.etag.length>0&&
  raw.template?.taskCount===1&&raw.template?.parallelism===1&&
  operatorHash(raw.template)===x.job_template_sha256,'nile_release_template_mismatch');
 const task=raw.template.template,c=task?.containers?.[0];
 require(task?.serviceAccount===SA&&task.maxRetries===0&&task.timeout==='600s'&&
  task.containers?.length===1&&c.image===IMAGE+x.service_digest&&
  Array.isArray(c.command)&&c.command.length===1&&c.command[0]==='/bin/bash'&&
  Array.isArray(c.args)&&c.args.length===2&&c.args[0]==='-ceu'&&
  !(task.volumes||[]).length&&!(c.volumeMounts||[]).length,'nile_release_job_scope_denied');
 const entries=c.env||[];
 require(Array.isArray(entries)&&entries.length<=32&&entries.every(y=>typeof y.name==='string')&&
  new Set(entries.map(y=>y.name)).size===entries.length,'nile_release_env_invalid');
 const e=Object.fromEntries(entries.map(y=>[y.name,y]));
 const plain=(k,v)=>e[k]?.value===v&&!e[k].valueSource;
 require(plain('APP_ENV','dev')&&plain('SOURCE_SHA',x.source_sha)&&plain('DB_MIGRATION_MODE','refuse')&&
  !Object.hasOwn(e,'EVALUATION013_MODE')&&!Object.hasOwn(e,'EVALUATION013_OWNER_GATE'),
  'nile_release_default_not_refused');
 for(const key of ['NILE_DATABASE_URL','NILE_MIGRATION_DATABASE_URL']){
  const ref=e[key]?.valueSource?.secretKeyRef;
  require(ref&&['NILE_DATABASE_URL','projects/jscc-dev/secrets/NILE_DATABASE_URL',
   'projects/828902654738/secrets/NILE_DATABASE_URL'].includes(ref.secret)&&ref.version==='1'&&
   !Object.hasOwn(e[key],'value'),'nile_release_secret_binding_denied');
 }
 return raw.etag;
}
async function verifyBuild(call,x){
 const repo=await call('https://artifactregistry.googleapis.com/v1/'+REGISTRY);
 require(repo.name===REGISTRY&&repo.dockerConfig?.immutableTags===true,'nile_release_registry_denied');
 const parent=REGISTRY+'/packages/jscc-service',name=parent+'/tags/'+x.source_sha;
 const tag=await call('https://artifactregistry.googleapis.com/v1/'+name);
 require(tag.name===name&&tag.version===parent+'/versions/'+x.service_digest,'nile_release_digest_mismatch');
 const path='projects/jscc-shared/locations/europe-west1/builds/'+x.build_id;
 const b=await call('https://cloudbuild.googleapis.com/v1/'+path);
 require(b.name===path&&b.id===x.build_id&&b.serviceAccount===BUILDER&&b.status==='SUCCESS'&&
  b.substitutions?._GIT_SHA===x.source_sha&&Array.isArray(b.results?.images)&&b.results.images.length<=20&&
  b.results.images.some(i=>i.name===IMAGE.slice(0,-1)+':'+x.source_sha&&i.digest===x.service_digest),
  'nile_release_build_provenance_unverified');
}
async function verifyLock(call,x){
 const path=STORE+'locks%2Fheavy-search.lock';
 const readMeta=()=>call(path+'?fields=bucket,name,generation');
 const m=await readMeta();
 require(m.bucket===BUCKET&&m.name==='locks/heavy-search.lock'&&m.generation===x.lock_generation,
  'nile_release_lock_mismatch');
 const value=await call(path+'?alt=media&generation='+x.lock_generation);
 require(value.owner==='Shosetzel69'&&typeof value.purpose==='string'&&/^GOV85_RELEASE_[0-9]+(?:_[A-Z0-9]+)*$/.test(value.purpose)&&
  value.source_sha===x.source_sha&&operatorHash(value)===x.lock_payload_sha256,'nile_release_lock_owner_mismatch');
 require(await call(STORE+'active.json?fields=name,generation',{absent:true})===null,'nile_release_active_marker');
 const catalog=await call(STORE+'seed%2Fsources.json?fields=bucket,name,generation');
 require(catalog.bucket===BUCKET&&catalog.name==='seed/sources.json'&&catalog.generation===x.catalog_generation,
  'nile_release_catalog_drift');
 require((await readMeta()).generation===x.lock_generation,'nile_release_lock_changed');
}
async function verifyIdle(call){
 for(const name of ['jscc-search-dev',JOB]){
  const parent=ROOT+'/jobs/'+name+'/executions',seen=new Set(),tokens=new Set();
  let token='';
  for(let page=0;page<8;page++){
   const q=new URLSearchParams({pageSize:'100',...(token?{pageToken:token}:{})});
   const result=await call(RUN+parent+'?'+q);
   const rows=result.executions||[];
   require(Array.isArray(rows)&&rows.length<=100,'nile_release_execution_list_invalid');
   for(const row of rows){
    const id=typeof row.name==='string'?row.name.split('/').at(-1):'';
    require(id.startsWith(name+'-')&&/^[a-z0-9-]{1,63}$/.test(id)&&bound(row.name,parent+'/'+id)&&
     !seen.has(id)&&typeof row.completionTime==='string'&&Number.isFinite(Date.parse(row.completionTime)),
     'nile_release_execution_not_terminal');
    seen.add(id);
   }
   token=result.nextPageToken||'';
   require(typeof token==='string'&&token.length<=2048&&(!token||!tokens.has(token)),'nile_release_execution_token_invalid');
   if(!token)break;
   tokens.add(token);
  }
  require(!token,'nile_release_execution_pagination_incomplete');
 }
}
function migrationCommand(x){
 return "printf '%s  %s\\n%s  %s\\n' '"+x.script_sha256+"' '"+MIGRATION+
  "' '"+x.migration_checksum+"' '"+SQL_FILE+"' | sha256sum -c --status; exec node '"+MIGRATION+"'";
}
function executionProof(raw,id,x,mode){
 const path=PATH+'/executions/'+id,task=raw?.template,c=task?.containers?.[0];
 require(bound(raw?.name,path)&&(raw.job===JOB||bound(raw.job,PATH))&&raw.taskCount===1&&
  task?.serviceAccount===SA&&task.containers?.length===1&&c.image===IMAGE+x.service_digest&&
  Array.isArray(c.command)&&c.command.length===1&&c.command[0]==='/bin/bash'&&
  Array.isArray(c.args)&&c.args.length===2&&c.args[0]==='-ceu'&&c.args[1]===migrationCommand(x)&&
  Array.isArray(c.env)&&new Set(c.env.map(y=>y.name)).size===c.env.length,
  'nile_release_execution_binding_mismatch');
 const env=Object.fromEntries(c.env.map(y=>[y.name,y]));
 const plain=(k,v)=>env[k]?.value===v&&!env[k].valueSource;
 require(plain('APP_ENV','dev')&&plain('SOURCE_SHA',x.source_sha)&&plain('DB_MIGRATION_MODE','refuse')&&
  plain('EVALUATION013_MODE',mode)&&(mode==='inspect'?!Object.hasOwn(env,'EVALUATION013_OWNER_GATE'):
   plain('EVALUATION013_OWNER_GATE','APPROVE_EVALUATION_DEV_NILE_013_'+x.source_sha)),
  'nile_release_execution_mode_mismatch');
 const terminal=typeof raw.completionTime==='string'&&Number.isFinite(Date.parse(raw.completionTime));
 const conditions=(raw.conditions||[]).filter(y=>y.type==='Completed');
 const outcome=!terminal?'RUNNING_OR_PENDING':conditions.length===1&&conditions[0].state==='CONDITION_SUCCEEDED'?
  'SUCCEEDED':conditions.length===1&&conditions[0].state==='CONDITION_FAILED'?'FAILED_OR_CANCELLED':'TERMINAL_UNVERIFIED';
 return {execution:id,mode,terminal,outcome,sql_outcome:'UNVERIFIED'};
}
const claimKey=ref=>operatorHash({environment:'dev',work_item_ref:'#589',operation:'nile-013',approval_ref:ref});
function executionName(value){
 if(typeof value!=='string')return null;
 const id=value.split('/').at(-1);
 return match(EXEC,id)&&bound(value,PATH+'/executions/'+id)?id:null;
}
/** The authority callback must independently verify the exact approval,
 * reviewer, actor/access, maintenance window and restore plan. For apply it
 * must also verify the specific prior inspect execution's PENDING_013 output,
 * checksum and rollback compatibility. The adapter never accepts a generic
 * SQL/script/command argument. No transport is supplied by default. */
export async function submitApprovedNile013(record,{
 trustedRecordHash,verifyAuthority,getToken,fetchImpl=fetch,store,now=Date.now,
}={}){
 const {x,fresh}=admit(record,trustedRecordHash,now);
 require(typeof getToken==='function'&&typeof verifyAuthority==='function','nile_release_authority_missing');
 const authority=await verifyAuthority(x);
 require(authority===true,'nile_release_authority_denied');
 fresh();
 const ledger=store||operatorMigrationStore({getToken,fetchImpl});
 require(typeof ledger.get==='function'&&typeof ledger.create==='function','nile_release_ledger_missing');
 const key=claimKey(x.approval_ref),base='control/v1/migrations/'+key;
 const claim={schema_version:'1.0',environment:'dev',operation_id:key,approval_ref:x.approval_ref,
  evidence_hash:trustedRecordHash,source_sha:x.source_sha,mode:x.mode};
 const prior=await ledger.get(base+'.claim.json');
 if(prior){
  require(match(GEN,prior.generation)&&operatorHash(prior.data)===operatorHash(claim),'nile_release_claim_mismatch');
  const receipt=await ledger.get(base+'.receipt.json');
  return {operation_id:key,state:'ALREADY_CLAIMED',receipt_available:Boolean(receipt),automatic_retry:false};
 }
 const call=transport(getToken,fetchImpl);
 await verifyBuild(call,x);
 await verifyLock(call,x);
 await verifyIdle(call);
 if(x.mode==='apply'){
  const prior=executionProof(await call(RUN+PATH+'/executions/'+x.inspection_execution),x.inspection_execution,x,'inspect');
  require(prior.outcome==='SUCCEEDED','nile_release_inspect_not_successful');
 }
 const job=await call(RUN+PATH),etag=verifyTemplate(job,x);
 // Same release owner must have exclusive dispatch control; this read-only
 // lock check alone cannot exclude a second independently privileged actor.
 await verifyLock(call,x);
 fresh();
 try{await ledger.create(base+'.claim.json',claim);}
 catch(error){
  if(error?.message==='generation_precondition_failed')return {operation_id:key,state:'ALREADY_CLAIMED',automatic_retry:false};
  throw error;
 }
 const saved=await ledger.get(base+'.claim.json');
 require(match(GEN,saved?.generation)&&operatorHash(saved.data)===operatorHash(claim),'nile_release_claim_unverified');
 try{
  await verifyIdle(call);
  await verifyLock(call,x);
  require(verifyTemplate(await call(RUN+PATH),x)===etag,'nile_release_template_drift');
  fresh();
  // Exact script hash is also checked INSIDE the immutable image, then the
  // existing dedicated 013 entrypoint enforces source/DB/mode/ledger binding.
  // No arbitrary SQL or arguments, no persistent apply environment.
  const command=migrationCommand(x);
  const env=[{name:'EVALUATION013_MODE',value:x.mode}];
  if(x.mode==='apply')env.push({name:'EVALUATION013_OWNER_GATE',value:'APPROVE_EVALUATION_DEV_NILE_013_'+x.source_sha});
  const raw=await call(RUN+PATH+':run',{method:'POST',body:{etag,overrides:{
   containerOverrides:[{args:['-ceu',command],env}],taskCount:1,timeout:'600s'}}});
  require(!raw.error&&operatorLro(raw.name),'nile_release_receipt_unverified');
  const candidates=[raw.response?.name,raw.metadata?.name,raw.metadata?.execution,raw.metadata?.target].map(executionName).filter(Boolean);
  const execution=candidates[0]??null;
  require(new Set(candidates).size<=1,'nile_release_execution_ambiguous');
  const receipt={operation_id:key,evidence_hash:trustedRecordHash,operation_name:raw.name,execution,
   state:'SUBMITTED',automatic_retry:false,template_restore_required:true};
  await ledger.create(base+'.receipt.json',receipt);
  const confirmed=await ledger.get(base+'.receipt.json');
  require(match(GEN,confirmed?.generation)&&operatorHash(confirmed.data)===operatorHash(receipt),'nile_release_receipt_uncertain');
  return receipt;
 }catch{
  // Claim is retained. This is not permission to replay or release Retrieve.
  return {operation_id:key,state:'RECOVERY_REQUIRED',automatic_retry:false,template_restore_required:true};
 }
}


// Reconcile a previously submitted operation by its protected claim/receipt.
// The same independent authority may observe after expiry; no run, patch,
// cancellation, lock release or SQL-verdict inference occurs in this path.
export async function observeApprovedNile013(record,{
 trustedRecordHash,verifyAuthority,getToken,fetchImpl=fetch,store,now=Date.now,
}={}){
 const {x}=admit(record,trustedRecordHash,()=>record?.issued_at_ms);
 require(typeof getToken==='function'&&typeof verifyAuthority==='function'&&await verifyAuthority(x)===true&&
  Number.isSafeInteger(now())&&now()>=x.issued_at_ms,'nile_release_authority_denied');
 const key=claimKey(x.approval_ref),base='control/v1/migrations/'+key;
 const ledger=store||operatorMigrationStore({getToken,fetchImpl});
 const claim=await ledger.get(base+'.claim.json'),receipt=await ledger.get(base+'.receipt.json');
 const expected={schema_version:'1.0',environment:'dev',operation_id:key,approval_ref:x.approval_ref,
  evidence_hash:trustedRecordHash,source_sha:x.source_sha,mode:x.mode};
 require(match(GEN,claim?.generation)&&operatorHash(claim.data)===operatorHash(expected),'nile_release_claim_unverified');
 if(!receipt)return {operation_id:key,state:'RECOVERY_REQUIRED',automatic_retry:false,sql_outcome:'UNVERIFIED'};
 const v=receipt.data;
 require(match(GEN,receipt.generation)&&operatorExact(v,['operation_id','evidence_hash','operation_name','execution','state',
  'automatic_retry','template_restore_required'])&&v.operation_id===key&&v.evidence_hash===trustedRecordHash&&
  operatorLro(v.operation_name)&&(v.execution===null||match(EXEC,v.execution))&&v.state==='SUBMITTED'&&
  v.automatic_retry===false&&v.template_restore_required===true,'nile_release_receipt_unverified');
 const call=transport(getToken,fetchImpl);
 let id=v.execution;
 if(!id){
  const op=await call(RUN+v.operation_name);
  require(op.name===v.operation_name,'nile_release_lro_binding_mismatch');
  const candidates=[op.response?.name,op.metadata?.name,op.metadata?.execution,op.metadata?.target].map(executionName).filter(Boolean);
  require(new Set(candidates).size<=1,'nile_release_execution_ambiguous');
  id=candidates[0]??null;
  if(!id)return {operation_id:key,state:op.done===true||op.error?'RECOVERY_REQUIRED':'SUBMITTED',
   automatic_retry:false,sql_outcome:'UNVERIFIED'};
 }
 const proof=executionProof(await call(RUN+PATH+'/executions/'+id),id,x,x.mode);
 return {operation_id:key,state:'OBSERVED',...proof,automatic_retry:false,template_restore_required:true};
}
