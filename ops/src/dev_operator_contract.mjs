// #589: pure DEV operator request/admission contract. No privileged API calls.
import {createHash} from 'node:crypto';

export const OPERATOR_BUCKET='jscc-dev-ops-state';
export const OPERATOR_JOB='jscc-ops-operator-dev';
export const OPERATOR_ROOT='projects/jscc-dev/locations/europe-west1';
const PROJECT_ROOTS=new Set([OPERATOR_ROOT,'projects/828902654738/locations/europe-west1']);
const SHA=/^[a-f0-9]{40}$/;
const HEX=/^[a-f0-9]{64}$/;
const GEN=/^[1-9][0-9]{0,19}$/;
const REF=/^#589\/[1-9][0-9]{0,19}$/;
const EXEC=/^jscc-ops-operator-dev-[a-z0-9-]{1,40}$/;
const ACTIONS=new Set(['build','deploy_ops_pair','observe_build','observe_pair','cancel_build','gcloud_inventory','gcs_artifact','gcp_metadata','observe_run_execution','cancel_diagnostic_execution']);
export const DEV_RUN_PERMISSION_PROBES=Object.freeze({
 run_job_permissions:Object.freeze(['run.jobs.get','run.jobs.run','run.jobs.runWithOverrides','run.jobs.update','run.jobs.delete','run.jobs.getIamPolicy','run.jobs.setIamPolicy']),
 run_service_permissions:Object.freeze(['run.services.get','run.services.update','run.services.delete','run.services.getIamPolicy','run.services.setIamPolicy']),
});
const STATES=new Set(['DISPATCH_PENDING_OR_UNKNOWN','SUBMITTED','WORKING','SUCCEEDED','FAILED','BLOCKED',
 'CANCELLED','SUBMISSION_UNKNOWN','ROLLED_BACK','RECOVERY_REQUIRED','FREEZE_UNCERTAIN',
 'ROLLBACK_BLOCKED','UNFREEZE_UNCERTAIN','ADMISSION_BLOCKED','OBSERVED']);
export function operatorRequire(ok,code){if(!ok)throw Error(code);}
export const operatorExact=(v,keys)=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&
 Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const match=(re,v)=>typeof v==='string'&&re.test(v);
function canonical(v){
 if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';
 if(v!==null&&typeof v==='object')return '{'+Object.keys(v).sort()
  .map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
 operatorRequire(v===null||typeof v==='boolean'||typeof v==='string'||Number.isSafeInteger(v),'invalid_operator_value');
 return JSON.stringify(v);
}
export const operatorHash=v=>createHash('sha256').update(canonical(v)).digest('hex');
export const operatorActor=sub=>{
 operatorRequire(typeof sub==='string'&&/^[0-9]+$/.test(sub),'invalid_operator_actor');
 return createHash('sha256').update(sub).digest('hex');
};
export function operatorPaths(ref){
 operatorRequire(match(REF,ref),'invalid_operator_approval_ref');
 const key=operatorHash({environment:'dev',work_item_ref:'#589',approval_ref:ref});
 return Object.freeze({key,approval:'control/v1/approvals/'+key+'.json',
  request:'control/v1/operator-requests/'+key+'.json',result:'control/v1/operator-results/'+key+'.json'});
}
export function operatorExecution(value){
 if(typeof value!=='string')return null;
 if(EXEC.test(value))return value;
 for(const root of PROJECT_ROOTS){
  const prefix=root+'/jobs/'+OPERATOR_JOB+'/executions/';
  if(value.startsWith(prefix)&&EXEC.test(value.slice(prefix.length)))return value.slice(prefix.length);
 }
 return null;
}
export function operatorLro(value){
 if(typeof value!=='string')return null;
 for(const root of PROJECT_ROOTS){
  const prefix=root+'/operations/';
  if(value.startsWith(prefix)&&/^[a-zA-Z0-9_-]{1,160}$/.test(value.slice(prefix.length)))return value;
 }
 return null;
}
export function devRunExecutionTarget(job,execution){
 const jobs=['jscc-search-dev','jscc-diagnostics-dev','jscc-db-migrate-dev'];
 operatorRequire(jobs.includes(job)&&typeof execution==='string'&&execution.startsWith(job+'-')&&
  /^[a-z0-9-]{1,63}$/.test(execution)&&execution.length>job.length+1,'operator_run_execution_target_denied');
 return OPERATOR_ROOT+'/jobs/'+job+'/executions/'+execution;
}
export function operatorDispatchPath(execution){
 operatorRequire(match(EXEC,execution),'invalid_operator_execution');
 return 'control/v1/operator-dispatch/'+execution+'.json';
}
export function validateOperatorToolArgs(args){
 operatorRequire(operatorExact(args,['approval_ref']),'invalid_operator_arguments');
 operatorPaths(args.approval_ref);
 return args.approval_ref;
}

/** Only records read from the independent, protected approval publisher are
 * trusted. Never call this validator on caller-supplied approval content. */
export function validateOperatorApproval(record,{ref,actor,sourceSha,now=Date.now(),fresh=true}){
 const v=record?.data;
 operatorRequire(match(GEN,record?.generation)&&
  operatorExact(v,['schema_version','environment','work_item_ref','approval_ref','action','actor_sub_hash',
   'operator_source_sha','bundle','bundle_hash','cost_ref','review_ref','issued_at_ms','expires_at_ms'])&&
  v.schema_version==='1.0'&&v.environment==='dev'&&v.work_item_ref==='#589'&&
  v.approval_ref===ref&&match(REF,ref)&&ACTIONS.has(v.action)&&
  match(HEX,actor)&&v.actor_sub_hash===actor&&match(SHA,sourceSha)&&v.operator_source_sha===sourceSha&&
  match(REF,v.cost_ref)&&match(REF,v.review_ref)&&match(HEX,v.bundle_hash)&&
  v.bundle!==null&&typeof v.bundle==='object'&&!Array.isArray(v.bundle)&&
  operatorHash(v.bundle)===v.bundle_hash&&
  Number.isSafeInteger(v.issued_at_ms)&&Number.isSafeInteger(v.expires_at_ms)&&
  v.expires_at_ms>v.issued_at_ms&&v.expires_at_ms-v.issued_at_ms<=3600000&&
  (!fresh||(Number.isSafeInteger(now)&&now>=v.issued_at_ms&&now<v.expires_at_ms)),
  'operator_approval_not_admitted');
 // Bind mutation approval references, actor and evidence to the outer record.
 if(v.action==='build'){
  operatorRequire(v.bundle.actor_sub_hash===actor&&v.bundle.evidence?.approval===ref&&
   v.bundle.evidence?.cost===v.cost_ref&&v.bundle.evidence?.independent_review===v.review_ref,
   'operator_build_approval_mismatch');
 }else if(v.action==='deploy_ops_pair'){
  operatorRequire(v.bundle.operator_source_sha===sourceSha&&v.bundle.evidence?.approval===ref&&
   v.bundle.evidence?.cost===v.cost_ref&&v.bundle.evidence?.independent_review===v.review_ref,
   'operator_pair_approval_mismatch');
 }else if(v.action==='cancel_build'){
  operatorRequire(operatorExact(v.bundle,['original_approval_ref','build_id'])&&
   match(REF,v.bundle.original_approval_ref)&&v.bundle.original_approval_ref!==ref&&
   match(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/,v.bundle.build_id),
   'operator_cancel_approval_mismatch');
 }else if(v.action==='observe_build'||v.action==='observe_pair'){
  operatorRequire(operatorExact(v.bundle,['original_approval_ref'])&&
   match(REF,v.bundle.original_approval_ref)&&v.bundle.original_approval_ref!==ref,
   'operator_observation_approval_mismatch');
 }else if(v.action==='observe_run_execution'||v.action==='cancel_diagnostic_execution'){
  operatorRequire(operatorExact(v.bundle,['environment','job','execution','expected_uid','expected_image','expected_source_sha'])&&
   v.bundle.environment==='dev'&&match(/^[a-f0-9-]{8,64}$/,v.bundle.expected_uid)&&
   match(SHA,v.bundle.expected_source_sha)&&
   typeof v.bundle.expected_image==='string'&&
   /^europe-west1-docker\.pkg\.dev\/jscc-shared\/(?:jscc|jscc-ops)\/[a-z0-9._-]+@sha256:[a-f0-9]{64}$/.test(v.bundle.expected_image)&&
   (v.action!=='cancel_diagnostic_execution'||v.bundle.job==='jscc-diagnostics-dev'),
   'operator_run_execution_approval_mismatch');
  devRunExecutionTarget(v.bundle.job,v.bundle.execution);
 }else if(v.action==='gcp_metadata'){
  operatorRequire(v.bundle.environment==='dev'&&(
   v.bundle.kind==='artifact_tag'&&operatorExact(v.bundle,['environment','kind','package','source_sha'])||
   ['secret','run_job','run_service','run_job_permissions','run_service_permissions','billing_status','quota_info'].includes(v.bundle.kind)&&operatorExact(v.bundle,['environment','kind','name'])),
   'operator_metadata_approval_mismatch');
 }else if(v.action==='gcs_artifact'){
  operatorRequire(v.bundle.environment==='dev'&&(
   v.bundle.operation==='metadata'&&operatorExact(v.bundle,['environment','operation','bucket','object','generation'])||
   v.bundle.operation==='copy_generation'&&operatorExact(v.bundle,['environment','operation','source','source_generation','destination','expected_md5','expected_crc32c'])||

   v.bundle.operation==='restore_soft_deleted'&&
   operatorExact(v.bundle,['environment','operation','bucket','object','generation','expected_md5','expected_crc32c'])||
   v.bundle.operation==='cleanup_generation'&&
   operatorExact(v.bundle,['environment','operation','bucket','object','generation','expected_md5','expected_crc32c','original_approval_ref','build_id'])&&
   match(REF,v.bundle.original_approval_ref)&&v.bundle.original_approval_ref!==ref&&
   match(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/,v.bundle.build_id)),
   'operator_gcs_approval_mismatch');
 }else{
  operatorRequire(operatorExact(v.bundle,['environment','script_id','script_sha256','service','buildId'])&&
   v.bundle.environment==='dev','operator_script_approval_mismatch');
 }
 return Object.freeze({approval:v,generation:record.generation,approvalHash:operatorHash(v),paths:operatorPaths(ref)});
}
export function operatorRequest(admission,now=Date.now()){
 const a=admission.approval;
 return Object.freeze({schema_version:'1.0',environment:'dev',work_item_ref:'#589',
  operation_id:admission.paths.key,approval_ref:a.approval_ref,approval_generation:admission.generation,
  approval_hash:admission.approvalHash,actor_sub_hash:a.actor_sub_hash,
  operator_source_sha:a.operator_source_sha,action:a.action,requested_at_ms:now,
  expires_at_ms:a.expires_at_ms});
}
export function validateOperatorRequest(value,admission){
 const expected=operatorRequest(admission,value?.requested_at_ms);
 operatorRequire(Number.isSafeInteger(value?.requested_at_ms)&&
  value.requested_at_ms>=admission.approval.issued_at_ms&&value.requested_at_ms<admission.approval.expires_at_ms&&
  operatorHash(value)===operatorHash(expected),'operator_request_binding_mismatch');
 return value;
}
function projectMetadata(m){
 const safeName=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,255}$/.test(x);
 if(!m||!['artifact_tag','secret','run_job','run_service','run_job_permissions','run_service_permissions','billing_status','quota_info'].includes(m.kind))throw Error('operator_metadata_invalid');
 if(m.kind==='billing_status'){
  operatorRequire(['jscc-dev','jscc-shared'].includes(m.name)&&typeof m.billing_enabled==='boolean','operator_billing_metadata_invalid');
  return {kind:m.kind,name:m.name,billing_enabled:m.billing_enabled,spend:'UNVERIFIED',cost_admission:'UNVERIFIED'};
 }
 if(m.kind==='quota_info'){
  operatorRequire(['run.googleapis.com','storage.googleapis.com'].includes(m.name)&&m.project==='jscc-dev'&&
   typeof m.pagination_complete==='boolean'&&Array.isArray(m.quotas)&&m.quotas.length<=200&&
   new Set(m.quotas.map(x=>x?.quota_id)).size===m.quotas.length,'operator_quota_metadata_invalid');
  const quotas=m.quotas.map(x=>{
   operatorRequire(match(/^[A-Za-z0-9_-]{1,128}$/,x?.quota_id)&&Array.isArray(x.limits)&&x.limits.length<=2&&
    x.limits.every(y=>['global','europe-west1'].includes(y?.location)&&match(/^-?[0-9]{1,19}$/,y.value))&&
    new Set(x.limits.map(y=>y.location)).size===x.limits.length,'operator_quota_metadata_invalid');
   return {quota_id:x.quota_id,limits:x.limits.map(y=>({location:y.location,value:y.value}))};
  });
  return {kind:m.kind,name:m.name,project:m.project,quotas,pagination_complete:m.pagination_complete,
   usage:'UNVERIFIED',cost_admission:'UNVERIFIED'};
 }
 if(Object.hasOwn(DEV_RUN_PERMISSION_PROBES,m.kind)){
  const requested=DEV_RUN_PERMISSION_PROBES[m.kind];
  const targets=m.kind==='run_job_permissions'?
   ['jscc-search-dev','jscc-diagnostics-dev','jscc-db-migrate-dev','jscc-ops-operator-dev']:
   ['jscc-dev-workspace-manager','jscc-dev-sandbox-worker','jscc-ops-gateway-dev','jscc-command-api-dev'];
  operatorRequire(targets.includes(m.name)&&m.scope==='current_operator_resource_probe'&&
   m.resource_exists===true&&Array.isArray(m.reported_permissions)&&
   m.reported_permissions.every(x=>requested.includes(x))&&
   new Set(m.reported_permissions).size===m.reported_permissions.length,'operator_permissions_invalid');
  return {kind:m.kind,name:m.name,scope:m.scope,resource_exists:true,
   requested_permissions:[...requested],reported_permissions:requested.filter(x=>m.reported_permissions.includes(x)),
   not_reported_permissions:requested.filter(x=>!m.reported_permissions.includes(x)),
   policy_isolation:'UNVERIFIED'};
 }
 if(m.kind==='artifact_tag'){
  operatorRequire(['jscc-ops-gateway','jscc-diagnostics','jscc-ops-operator','jscc-dev-workspace-manager-r2','jscc-dev-workspace-worker-cap100'].includes(m.package)&&
   match(SHA,m.source_sha)&&/^sha256:[a-f0-9]{64}$/.test(m.digest||'')&&m.immutable_tags===true&&
   m.uri==='europe-west1-docker.pkg.dev/jscc-shared/jscc-ops/'+m.package+'@'+m.digest,'operator_metadata_invalid');
  return {kind:m.kind,package:m.package,source_sha:m.source_sha,digest:m.digest,uri:m.uri,
   immutable_tags:true,source_provenance:'UNVERIFIED'};
 }
 if(m.kind==='secret'){
  operatorRequire(['JSCC_OPS_GOOGLE_CLIENT_ID','JSCC_OPS_GOOGLE_CLIENT_SECRET','JSCC_OPS_GOOGLE_ALLOWED_SUB','NILE_DATABASE_URL'].includes(m.name)&&
   ['automatic','user_managed','UNKNOWN'].includes(m.replication),'operator_metadata_invalid');
  return {kind:m.kind,name:m.name,replication:m.replication};
 }
 operatorRequire(safeName(m.name)&&Array.isArray(m.containers)&&m.containers.length>0&&m.containers.length<=4,
  'operator_metadata_invalid');
 const out={kind:m.kind,name:m.name,
  service_account:typeof m.service_account==='string'&&/^[a-z][a-z0-9-]{3,120}@jscc-dev\.iam\.gserviceaccount\.com$/.test(m.service_account)?m.service_account:'UNKNOWN',
  containers:m.containers.map(c=>{
   operatorRequire(Array.isArray(c.env)&&c.env.length<=128,'operator_metadata_invalid');
   const image=typeof c.image==='string'&&/^europe-west1-docker\.pkg\.dev\/jscc-shared\/(?:jscc|jscc-ops)\/[a-z0-9._-]+@sha256:[a-f0-9]{64}$/.test(c.image)?c.image:'UNKNOWN';
   const env=c.env.map(x=>{
    operatorRequire(typeof x.name==='string'&&/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(x.name)&&
     ['plain','secret_reference','reference_unverified'].includes(x.kind),'operator_metadata_invalid');
    if(x.kind!=='secret_reference')return {name:x.name,kind:x.kind};
    operatorRequire(typeof x.secret==='string'&&/^(?:projects\/jscc-dev\/secrets\/)?[A-Za-z0-9_-]{1,255}$/.test(x.secret)&&
     typeof x.version==='string'&&(/^[0-9]{1,20}$/.test(x.version)||x.version==='latest'),'operator_metadata_invalid');
    return {name:x.name,kind:x.kind,secret:x.secret,version:x.version};
   });
   return {image,env};
  })};
 for(const key of ['task_count','parallelism','max_retries'])if(Number.isSafeInteger(m[key])&&m[key]>=0)out[key]=m[key];
 if(typeof m.timeout==='string'&&/^[0-9]{1,6}s$/.test(m.timeout))out.timeout=m.timeout;
 if(m.kind==='run_service'){
  operatorRequire(Array.isArray(m.traffic)&&m.traffic.length>0&&m.traffic.length<=20,'operator_metadata_invalid');
  out.configuration_scope='service_template';
  out.traffic=m.traffic.map(x=>{
   operatorRequire(typeof x.revision==='string'&&x.revision.startsWith(m.name+'-')&&/^[a-z0-9-]{1,100}$/.test(x.revision)&&
    Number.isInteger(x.percent)&&x.percent>=0&&x.percent<=100,'operator_metadata_invalid');
   return {revision:x.revision,percent:x.percent,...(typeof x.tag==='string'&&/^[a-z0-9-]{1,63}$/.test(x.tag)?{tag:x.tag}:{})};
  });
  operatorRequire(out.traffic.reduce((n,x)=>n+x.percent,0)===100,'operator_metadata_invalid');
  operatorRequire(Array.isArray(m.effective_revisions)&&m.effective_revisions.length===out.traffic.length,
   'operator_metadata_invalid');
  out.effective_revisions=m.effective_revisions.map((x,i)=>{
   operatorRequire(x.revision===out.traffic[i].revision&&x.percent===out.traffic[i].percent&&
    (x.image_digest==='UNKNOWN'||typeof x.image_digest==='string'&&/^sha256:[a-f0-9]{64}$/.test(x.image_digest)),
    'operator_metadata_invalid');
   return {revision:x.revision,percent:x.percent,image_digest:x.image_digest};
  });
  out.source_provenance='UNVERIFIED';
 }
 operatorRequire(Buffer.byteLength(JSON.stringify(out))<=32768,'operator_metadata_limit');
 return out;
}
export function projectOperatorResult(request,record){
 if(!record)return {operation_id:request.operation_id,action:request.action,
  state:'DISPATCH_PENDING_OR_UNKNOWN',automatic_retry:false};
 const v=record.data;
 operatorRequire(match(GEN,record.generation)&&v&&v.operation_id===request.operation_id&&
  v.approval_hash===request.approval_hash&&v.action===request.action&&STATES.has(v.state),
  'operator_result_binding_mismatch');
 const out={operation_id:request.operation_id,action:request.action,state:v.state,automatic_retry:false};
 for(const k of ['build_id','controller_operation_id','source_provenance','script_verdict','live_pair','lease_state','failure_class']){
  const x=v[k];if(typeof x==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(x))out[k]=x;
 }
 const m=v.artifact_metadata;
 if(request.action==='gcs_artifact'&&m&&typeof m==='object'&&
  ['jscc-shared-ops-cloudbuild-source','jscc-dev-runtime-828902654738'].includes(m.bucket)&&
  typeof m.name==='string'&&/^(?:source\/dev-[a-f0-9]{40}-[a-z0-9-]{8,64}\.tar\.gz|runs\/[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}\/(?:run-status\.json|jobs\.json))$/.test(m.name)&&!m.name.includes('..')&&
  match(GEN,m.generation)&&typeof m.size==='string'&&/^[0-9]{1,20}$/.test(m.size)&&
  typeof m.crc32c==='string'&&/^[a-zA-Z0-9+/]{6}==$/.test(m.crc32c)&&
  (m.md5===null||typeof m.md5==='string'&&/^[a-zA-Z0-9+/]{22}==$/.test(m.md5)))
  out.artifact_metadata={bucket:m.bucket,name:m.name,generation:m.generation,size:m.size,crc32c:m.crc32c,md5:m.md5};
 if(request.action==='gcs_artifact'&&['SUCCEEDED','OBSERVED'].includes(v.state))operatorRequire(out.artifact_metadata,'operator_artifact_result_invalid');
 if(request.action==='gcs_artifact'&&v.artifact_operation==='restore_soft_deleted'){
  operatorRequire(out.artifact_metadata?.bucket==='jscc-shared-ops-cloudbuild-source'&&
   match(GEN,v.prior_generation)&&v.prior_generation!==out.artifact_metadata.generation,'operator_artifact_result_invalid');
  out.artifact_operation=v.artifact_operation;out.prior_generation=v.prior_generation;
 }
 if(request.action==='gcs_artifact'&&v.artifact_operation==='cleanup_generation'){
  operatorRequire(out.artifact_metadata?.bucket==='jscc-shared-ops-cloudbuild-source'&&
   v.generation_no_longer_live===true,'operator_artifact_result_invalid');
  out.artifact_operation=v.artifact_operation;out.generation_no_longer_live=true;
 }
 if(request.action==='gcp_metadata'&&v.state==='OBSERVED')out.metadata=projectMetadata(v.metadata);
 if(['observe_run_execution','cancel_diagnostic_execution'].includes(request.action)&&v.execution_observation){
  const m=v.execution_observation;
  devRunExecutionTarget(m.job,m.execution);
  operatorRequire(match(/^[a-f0-9-]{8,64}$/,m.uid)&&match(SHA,m.source_sha)&&
   /^europe-west1-docker\.pkg\.dev\/jscc-shared\/(?:jscc|jscc-ops)\/[a-z0-9._-]+@sha256:[a-f0-9]{64}$/.test(m.image||'')&&
   ['RUNNING_OR_PENDING','SUCCEEDED','FAILED_OR_CANCELLED','TERMINAL_UNVERIFIED'].includes(m.status)&&
   Number.isSafeInteger(m.task_count)&&m.task_count>=1&&m.task_count<=1000&&
   typeof m.terminal==='boolean'&&m.terminal===(m.status!=='RUNNING_OR_PENDING')&&
   typeof m.cancellation_requested==='boolean'&&
   (request.action==='cancel_diagnostic_execution'?m.job==='jscc-diagnostics-dev':!m.cancellation_requested),
   'operator_run_execution_result_invalid');
  out.execution_observation={job:m.job,execution:m.execution,uid:m.uid,source_sha:m.source_sha,image:m.image,
   task_count:m.task_count,status:m.status,terminal:m.terminal,cancellation_requested:m.cancellation_requested};
 }
 if(['observe_run_execution','cancel_diagnostic_execution'].includes(request.action)&&v.state==='OBSERVED')
  operatorRequire(out.execution_observation,'operator_run_execution_result_invalid');
 if(request.action==='observe_build'&&v.build_observation){
  const m=v.build_observation;
  const ids=['trusted-source-admission','materialize-verified-source','validate-candidate',
   'python-contract-tests','ops-contract-tests','registry-immutability','detect-existing-images',
   'build-gateway','build-worker','build-operator','verify-image-source','push-gateway','push-worker','push-operator','evidence'];
  const statuses=['STATUS_UNKNOWN','PENDING','QUEUED','WORKING','SUCCESS','FAILURE','INTERNAL_ERROR','TIMEOUT','CANCELLED','EXPIRED'];
  operatorRequire(match(SHA,m.source_sha)&&match(GEN,m.archive_generation)&&
   ['REQUEST_MATCH_ONLY','RESOLVED_MATCH'].includes(m.archive_binding)&&statuses.includes(m.build_status)&&
   Number.isSafeInteger(m.immutable_image_count)&&m.immutable_image_count>=0&&m.immutable_image_count<=10&&
   Array.isArray(m.steps)&&(m.steps.length===0||m.steps.length===ids.length&&
    m.steps.every((x,i)=>x?.id===ids[i]&&statuses.includes(x.status))),
   'operator_build_observation_invalid');
  out.build_observation={source_sha:m.source_sha,archive_generation:m.archive_generation,
   archive_binding:m.archive_binding,build_status:m.build_status,immutable_image_count:m.immutable_image_count,
   steps:m.steps.map(x=>({id:x.id,status:x.status}))};
 }
 for(const k of ['protected_match','recovery_authorization_required','duplicate'])if(typeof v[k]==='boolean')out[k]=v[k];
 return out;
}
