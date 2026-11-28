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
const ACTIONS=new Set(['build','deploy_ops_pair','observe_build','observe_pair','cancel_build','gcloud_inventory','gcs_artifact','gcp_metadata','observe_run_execution','cancel_diagnostic_execution','observe_build_artifacts','observe_workspace_release','workspace_release_step','observe_product_release','workspace_revision_cleanup','observe_workspace_delivery']);
export const DEV_RUN_PERMISSION_PROBES=Object.freeze({
 run_job_permissions:Object.freeze(['run.jobs.get','run.jobs.run','run.executions.cancel','run.executions.get','run.jobs.runWithOverrides','run.jobs.update','run.jobs.delete','run.jobs.getIamPolicy','run.jobs.setIamPolicy']),
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
export const WORKSPACE_RELEASE_SERVICES=Object.freeze({
 manager:'jscc-dev-workspace-manager',worker:'jscc-dev-sandbox-worker'});
export const WORKSPACE_RELEASE_PACKAGES=Object.freeze({
 manager:'jscc-dev-workspace-manager-r2',worker:'jscc-dev-workspace-worker-cap100'});
export const WORKSPACE_RELEASE_PHASES=Object.freeze(['stage','tag','cutover','rollback','retire_tag']);
const WORKSPACE_REGISTRY='europe-west1-docker.pkg.dev/jscc-shared/jscc-ops/';
export function workspaceRevision(role,value){
 return Object.hasOwn(WORKSPACE_RELEASE_SERVICES,role)&&typeof value==='string'&&
  value.startsWith(WORKSPACE_RELEASE_SERVICES[role]+'-')&&/^[a-z0-9-]{1,63}$/.test(value);
}
export function workspaceImage(role,value){
 const packages=role==='manager'?['jscc-dev-workspace-manager','jscc-dev-workspace-manager-cap100','jscc-dev-workspace-manager-r2']:
  role==='worker'?['jscc-dev-sandbox-worker','jscc-dev-workspace-worker-cap100']:[];
 return typeof value==='string'&&packages.some(p=>value.startsWith(WORKSPACE_REGISTRY+p+'@'))&&
  /^sha256:[a-f0-9]{64}$/.test(value.split('@').at(-1))&&value.split('@').length===2;
}
export const WORKSPACE_DELIVERY_STEPS=Object.freeze(['stage:worker','tag:worker','stage:manager','tag:manager','cutover:worker','cutover:manager']);
export function validateWorkspaceDelivery(v){
 operatorRequire(operatorExact(v,['environment','source_sha','build_approval_ref','artifact_approval_ref','initial_pair_sha256','steps'])&&
  v.environment==='dev'&&match(SHA,v.source_sha)&&match(REF,v.build_approval_ref)&&match(REF,v.artifact_approval_ref)&&
  match(HEX,v.initial_pair_sha256)&&Array.isArray(v.steps)&&v.steps.length<=WORKSPACE_DELIVERY_STEPS.length&&
  v.steps.every(x=>match(REF,x))&&new Set([v.build_approval_ref,v.artifact_approval_ref,...v.steps]).size===v.steps.length+2,
  'workspace_delivery_bundle_denied');
 return v;
}
export function validateWorkspaceRevisionCleanup(v){
 operatorRequire(operatorExact(v,['environment','role','revision','image','revision_etag','expected_pair_sha256',
  'retained_revision','retained_image','retention_review_ref'])&&v.environment==='dev'&&
  Object.hasOwn(WORKSPACE_RELEASE_SERVICES,v.role)&&workspaceRevision(v.role,v.revision)&&
  workspaceImage(v.role,v.image)&&workspaceRevision(v.role,v.retained_revision)&&workspaceImage(v.role,v.retained_image)&&
  v.revision!==v.retained_revision&&v.image!==v.retained_image&&
  typeof v.revision_etag==='string'&&v.revision_etag.length>0&&v.revision_etag.length<=1024&&
  match(HEX,v.expected_pair_sha256)&&match(REF,v.retention_review_ref),'workspace_cleanup_bundle_denied');
 return v;
}
export function validateWorkspaceReleaseBundle(v){
 operatorRequire(operatorExact(v,['environment','phase','role','source_sha','build_approval_ref','expected_pair_sha256','previous','candidate'])&&
  v.environment==='dev'&&WORKSPACE_RELEASE_PHASES.includes(v.phase)&&
  Object.hasOwn(WORKSPACE_RELEASE_SERVICES,v.role)&&match(SHA,v.source_sha)&&match(REF,v.build_approval_ref)&&
  match(HEX,v.expected_pair_sha256)&&operatorExact(v.previous,['manager','worker'])&&operatorExact(v.candidate,['manager','worker'])&&
  Object.keys(WORKSPACE_RELEASE_SERVICES).every(role=>operatorExact(v.previous[role],['revision','image'])&&
   workspaceRevision(role,v.previous[role].revision)&&workspaceImage(role,v.previous[role].image)&&
   /^sha256:[a-f0-9]{64}$/.test(v.candidate[role]||'')&&
   v.previous[role].image!==WORKSPACE_REGISTRY+WORKSPACE_RELEASE_PACKAGES[role]+'@'+v.candidate[role]),
  'workspace_release_bundle_denied');
 return v;
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
 }else if(v.action==='observe_build'||v.action==='observe_pair'||v.action==='observe_build_artifacts'){
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
 }else if(v.action==='observe_product_release'){
  operatorRequire(operatorExact(v.bundle,['environment','source_sha','service_build_id','search_build_id','nile_operation_id'])&&
   v.bundle.environment==='dev'&&match(SHA,v.bundle.source_sha)&&
   [v.bundle.service_build_id,v.bundle.search_build_id].every(x=>x===null||match(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/,x))&&
   (v.bundle.nile_operation_id===null||match(/^op-[a-z0-9_-]{10,100}$/,v.bundle.nile_operation_id)),
   'product_release_observation_denied');
 }else if(v.action==='observe_workspace_release'){
  operatorRequire(operatorExact(v.bundle,['environment'])&&v.bundle.environment==='dev','workspace_release_observe_denied');
 }else if(v.action==='observe_workspace_delivery'){
  validateWorkspaceDelivery(v.bundle);
  operatorRequire(![v.bundle.build_approval_ref,v.bundle.artifact_approval_ref,...v.bundle.steps].includes(ref),'workspace_delivery_reference_mismatch');
 }else if(v.action==='workspace_revision_cleanup'){
  validateWorkspaceRevisionCleanup(v.bundle);
  operatorRequire(v.bundle.retention_review_ref===v.review_ref,'workspace_cleanup_review_mismatch');
 }else if(v.action==='workspace_release_step'){
  validateWorkspaceReleaseBundle(v.bundle);
  operatorRequire(v.bundle.build_approval_ref!==ref,'workspace_release_approval_mismatch');
 }else if(v.action==='gcp_metadata'){
  operatorRequire(v.bundle.environment==='dev'&&(
   v.bundle.kind==='artifact_tag'&&operatorExact(v.bundle,['environment','kind','package','source_sha'])||
   v.bundle.kind==='artifact_versions'&&operatorExact(v.bundle,['environment','kind','package'])||
   ['secret','run_job','run_service','run_job_permissions','run_service_permissions','billing_status','quota_info','service_request_metrics'].includes(v.bundle.kind)&&operatorExact(v.bundle,['environment','kind','name'])),
   'operator_metadata_approval_mismatch');
 }else if(v.action==='gcs_artifact'){
  operatorRequire(v.bundle.environment==='dev'&&(
   v.bundle.operation==='list_versions'&&operatorExact(v.bundle,['environment','operation','bucket','object','mode'])||
   v.bundle.operation==='snapshot_manifest'&&operatorExact(v.bundle,['environment','operation','run_id','expected_catalog_generation'])||
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
 if(!m||!['artifact_tag','artifact_versions','secret','run_job','run_service','run_job_permissions','run_service_permissions','billing_status','quota_info','service_request_metrics'].includes(m.kind))throw Error('operator_metadata_invalid');
 if(m.kind==='service_request_metrics'){
  const services=['jscc-dev-workspace-manager','jscc-dev-sandbox-worker','jscc-ops-gateway-dev','jscc-command-api-dev'];
  const groups=['1xx','2xx','3xx','4xx','5xx','other'];
  const start=Date.parse(m.start_time),end=Date.parse(m.end_time);
  operatorRequire(services.includes(m.name)&&Number.isFinite(start)&&Number.isFinite(end)&&end-start===900000&&
   operatorExact(m.counts,groups)&&groups.every(k=>Number.isSafeInteger(m.counts[k])&&m.counts[k]>=0)&&
   Number.isSafeInteger(m.observed_points)&&m.observed_points>=0&&Number.isSafeInteger(m.excluded_boundary_points)&&
   m.excluded_boundary_points>=0&&m.observed_points+m.excluded_boundary_points<=400&&
   typeof m.pagination_complete==='boolean','operator_monitoring_metadata_invalid');
  return {kind:m.kind,name:m.name,start_time:m.start_time,end_time:m.end_time,
   counts:Object.fromEntries(groups.map(k=>[k,m.counts[k]])),observed_points:m.observed_points,
   excluded_boundary_points:m.excluded_boundary_points,pagination_complete:m.pagination_complete,
   request_coverage:'UNVERIFIED',root_cause:'INSUFFICIENT_EVIDENCE'};
 }
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
 if(m.kind==='artifact_versions'){
  operatorRequire(['jscc-ops-gateway','jscc-diagnostics','jscc-ops-operator','jscc-dev-workspace-manager-r2','jscc-dev-workspace-worker-cap100','jscc-ops-publisher'].includes(m.package)&&
   m.immutable_tags===true&&typeof m.pagination_complete==='boolean'&&Array.isArray(m.versions)&&m.versions.length<=200&&
   new Set(m.versions.map(x=>x?.digest)).size===m.versions.length,'operator_registry_versions_invalid');
  const versions=m.versions.map(x=>{
   operatorRequire(match(/^sha256:[a-f0-9]{64}$/,x.digest)&&Array.isArray(x.source_sha_tags)&&
    x.source_sha_tags.every(y=>match(SHA,y))&&new Set(x.source_sha_tags).size===x.source_sha_tags.length&&
    Number.isSafeInteger(x.related_tag_count)&&x.related_tag_count>=x.source_sha_tags.length&&x.related_tag_count<=100,
    'operator_registry_versions_invalid');
   return {digest:x.digest,source_sha_tags:[...x.source_sha_tags],related_tag_count:x.related_tag_count};
  });
  return {kind:m.kind,package:m.package,versions,pagination_complete:m.pagination_complete,immutable_tags:true,
   active_references:'UNVERIFIED',deletion_authorized:false};
 }
 if(m.kind==='artifact_tag'){
  operatorRequire(['jscc-ops-gateway','jscc-diagnostics','jscc-ops-operator','jscc-dev-workspace-manager-r2','jscc-dev-workspace-worker-cap100','jscc-ops-publisher'].includes(m.package)&&
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
 if(request.action==='gcs_artifact'&&v.artifact_versions){
  const m=v.artifact_versions;
  const staging=m.bucket==='jscc-shared-ops-cloudbuild-source';
  operatorRequire((staging&&match(/^source\/dev-[a-f0-9]{40}-[a-z0-9-]{8,64}\.tar\.gz$/,m.object)||
   m.bucket==='jscc-dev-runtime-828902654738'&&match(/^runs\/[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}\/(?:run-status\.json|jobs\.json)$/,m.object))&&
   !m.object.includes('..')&&['versions','soft_deleted'].includes(m.mode)&&(m.mode!=='soft_deleted'||staging)&&
   typeof m.pagination_complete==='boolean'&&Array.isArray(m.objects)&&m.objects.length<=200&&
   new Set(m.objects.map(x=>x?.generation)).size===m.objects.length,'operator_artifact_versions_invalid');
  const objects=m.objects.map(x=>{
   operatorRequire(x?.bucket===m.bucket&&x.name===m.object&&match(GEN,x.generation)&&match(/^[0-9]{1,20}$/,x.size)&&
    match(/^[a-zA-Z0-9+/]{6}==$/,x.crc32c)&&(x.md5===null||match(/^[a-zA-Z0-9+/]{22}==$/,x.md5)),
    'operator_artifact_versions_invalid');
   return {bucket:x.bucket,name:x.name,generation:x.generation,size:x.size,crc32c:x.crc32c,md5:x.md5};
  });
  out.artifact_versions={bucket:m.bucket,object:m.object,mode:m.mode,objects,pagination_complete:m.pagination_complete};
 }
 if(request.action==='gcs_artifact'&&v.snapshot_manifest){
  const m=v.snapshot_manifest;
  operatorRequire(match(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/,m.run_id)&&!m.run_id.includes('..')&&
   match(GEN,m.catalog_generation)&&m.consistency==='TWO_READS_MATCH'&&m.atomic_snapshot===false&&
   Array.isArray(m.objects)&&m.objects.length===5&&match(HEX,m.manifest_sha256),'operator_snapshot_manifest_invalid');
  const names=['seed/sources.json','seed/source-categories.json','seed/nomenclatures.json',
   'runs/'+m.run_id+'/run-status.json','runs/'+m.run_id+'/jobs.json'];
  const objects=m.objects.map((x,i)=>{
   operatorRequire(x?.bucket==='jscc-dev-runtime-828902654738'&&x.name===names[i]&&
    match(GEN,x.generation)&&match(/^[0-9]{1,20}$/,x.size)&&match(/^[a-zA-Z0-9+/]{6}==$/,x.crc32c)&&
    (x.md5===null||match(/^[a-zA-Z0-9+/]{22}==$/,x.md5)),'operator_snapshot_manifest_invalid');
   return {bucket:x.bucket,name:x.name,generation:x.generation,size:x.size,crc32c:x.crc32c,md5:x.md5};
  });
  operatorRequire(objects[0].generation===m.catalog_generation&&operatorHash(objects)===m.manifest_sha256,
   'operator_snapshot_manifest_invalid');
  out.snapshot_manifest={run_id:m.run_id,catalog_generation:m.catalog_generation,objects,manifest_sha256:m.manifest_sha256,
   consistency:'TWO_READS_MATCH',atomic_snapshot:false};
 }
 if(request.action==='gcs_artifact'&&['SUCCEEDED','OBSERVED'].includes(v.state))
  operatorRequire(out.artifact_metadata||v.state==='OBSERVED'&&(out.snapshot_manifest||out.artifact_versions),'operator_artifact_result_invalid');
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
 if(['observe_build','observe_build_artifacts'].includes(request.action)&&v.build_observation){
  const m=v.build_observation;
  operatorRequire(m.build_kind===undefined||m.build_kind==='workspace_r2','operator_build_kind_invalid');
  const ids=m.build_kind==='workspace_r2'?
   ['trusted-source-admission','materialize-verified-source','immutable-workspace-baselines','workspace-manager-contract-tests',
    'build-manager-r2','build-worker-r2','worker-image-cwd-smoke','manager-image-route-smoke','verify-workspace-image-source',
    'push-manager-r2','push-worker-r2','digest-evidence']:
   ['trusted-source-admission','materialize-verified-source','validate-candidate',
   'python-contract-tests','ops-contract-tests','registry-immutability','detect-existing-images',
   'build-gateway','build-worker','build-operator','verify-image-source','push-gateway','push-worker','push-operator','evidence'];
  const statuses=['STATUS_UNKNOWN','PENDING','QUEUED','WORKING','SUCCESS','FAILURE','INTERNAL_ERROR','TIMEOUT','CANCELLED','EXPIRED'];
  operatorRequire(match(SHA,m.source_sha)&&match(GEN,m.archive_generation)&&
   ['REQUEST_MATCH_ONLY','RESOLVED_MATCH'].includes(m.archive_binding)&&statuses.includes(m.build_status)&&
   Number.isSafeInteger(m.immutable_image_count)&&m.immutable_image_count>=0&&m.immutable_image_count<=10&&
   Array.isArray(m.steps)&&(m.steps.length===0||m.steps.length===ids.length&&
    m.steps.every((x,i)=>x?.id===ids[i]&&statuses.includes(x.status))),
   'operator_build_observation_invalid');
  out.build_observation={...(m.build_kind?{build_kind:m.build_kind}:{}),source_sha:m.source_sha,archive_generation:m.archive_generation,
   archive_binding:m.archive_binding,build_status:m.build_status,immutable_image_count:m.immutable_image_count,
   steps:m.steps.map(x=>({id:x.id,status:x.status}))};
 }
 if(request.action==='observe_build_artifacts'&&v.state==='OBSERVED'){
  const m=v.build_artifacts,build=out.build_observation;
  const packages=build?.build_kind==='workspace_r2'?['jscc-dev-workspace-manager-r2','jscc-dev-workspace-worker-cap100']:
   ['jscc-ops-gateway','jscc-diagnostics','jscc-ops-operator','jscc-ops-publisher'];
  operatorRequire(build?.build_status==='SUCCESS'&&m&&typeof m.log_search_complete==='boolean'&&
   ['MATCHED_MARKERS','INCOMPLETE','LOG_ACCESS_DENIED','MISMATCH'].includes(m.correlation)&&
   Array.isArray(m.images)&&m.images.length===packages.length&&m.images.every((x,i)=>x?.package===packages[i]&&
   /^sha256:[a-f0-9]{64}$/.test(x.digest||'')&&['MATCH','MISSING','MISMATCH'].includes(x.marker)),
   'operator_build_artifact_result_invalid');
  out.build_artifacts={log_search_complete:m.log_search_complete,correlation:m.correlation,
   images:m.images.map(x=>({package:x.package,digest:x.digest,marker:x.marker})),source_provenance:'UNVERIFIED'};
 }
 if(['observe_workspace_release','workspace_release_step'].includes(request.action)&&['OBSERVED','SUCCEEDED'].includes(v.state)){
  const m=v.workspace_release;
  operatorRequire(m&&match(HEX,m.pair_sha256)&&operatorExact(m.services,['manager','worker'])&&
   (request.action==='observe_workspace_release'?m.phase===null:WORKSPACE_RELEASE_PHASES.includes(m.phase)&&
    Object.hasOwn(WORKSPACE_RELEASE_SERVICES,m.role)),'operator_workspace_release_invalid');
  const services={};
  for(const role of ['manager','worker']){
   const x=m.services[role];
   operatorRequire(x&&x.service===WORKSPACE_RELEASE_SERVICES[role]&&workspaceRevision(role,x.revision)&&
    workspaceRevision(role,x.latest_ready_revision)&&workspaceImage(role,x.image)&&
    match(HEX,x.configuration_sha256)&&Array.isArray(x.tags)&&x.tags.length<=20&&
    x.tags.every(t=>match(/^[a-z0-9][a-z0-9-]{0,62}$/,t?.tag)&&workspaceRevision(role,t.revision))&&
    new Set(x.tags.map(t=>t.tag)).size===x.tags.length,'operator_workspace_release_invalid');
   services[role]={service:x.service,revision:x.revision,image:x.image,latest_ready_revision:x.latest_ready_revision,
    configuration_sha256:x.configuration_sha256,tags:x.tags.map(t=>({tag:t.tag,revision:t.revision}))};
  }
  out.workspace_release={pair_sha256:m.pair_sha256,services,phase:m.phase,role:m.phase===null?null:m.role,
   functional_acceptance:'PENDING',automatic_retry:false};
 }
 if(request.action==='observe_workspace_delivery'&&v.state==='OBSERVED'){
  const m=v.workspace_delivery;
  operatorRequire(m&&match(SHA,m.source_sha)&&match(HEX,m.last_pair_sha256)&&match(HEX,m.live_pair_sha256)&&
   Array.isArray(m.completed_steps)&&m.completed_steps.length<=WORKSPACE_DELIVERY_STEPS.length&&
   m.completed_steps.every((x,i)=>x?.step===WORKSPACE_DELIVERY_STEPS[i]&&match(REF,x.approval_ref)&&match(HEX,x.pair_sha256))&&
   new Set(m.completed_steps.map(x=>x.approval_ref)).size===m.completed_steps.length&&
   ['NEXT_APPROVAL_REQUIRED','RECOVERY_REQUIRED','INDEPENDENT_ACCEPTANCE_REQUIRED'].includes(m.disposition)&&
   m.next_step===(m.disposition==='NEXT_APPROVAL_REQUIRED'?WORKSPACE_DELIVERY_STEPS[m.completed_steps.length]:null)&&
   (m.disposition==='INDEPENDENT_ACCEPTANCE_REQUIRED')===(m.completed_steps.length===WORKSPACE_DELIVERY_STEPS.length&&m.last_pair_sha256===m.live_pair_sha256)&&
   (m.disposition==='NEXT_APPROVAL_REQUIRED'?m.last_pair_sha256===m.live_pair_sha256:true),'operator_workspace_delivery_invalid');
  out.workspace_delivery={source_sha:m.source_sha,last_pair_sha256:m.last_pair_sha256,live_pair_sha256:m.live_pair_sha256,
   completed_steps:m.completed_steps.map(x=>({step:x.step,approval_ref:x.approval_ref,pair_sha256:x.pair_sha256})),
   disposition:m.disposition,next_step:m.next_step,automatic_retry:false,acceptance:'PENDING'};
 }
 if(request.action==='workspace_revision_cleanup'&&v.state==='SUCCEEDED'){
  const m=v.revision_cleanup;
  operatorRequire(m&&Object.hasOwn(WORKSPACE_RELEASE_SERVICES,m.role)&&workspaceRevision(m.role,m.revision)&&
   workspaceRevision(m.role,m.retained_revision)&&m.revision!==m.retained_revision&&
   workspaceImage(m.role,m.image)&&match(HEX,m.pair_sha256)&&m.target_absent===true&&
   m.retained_present===true,'operator_revision_cleanup_invalid');
  out.revision_cleanup={role:m.role,revision:m.revision,image:m.image,retained_revision:m.retained_revision,
   pair_sha256:m.pair_sha256,target_absent:true,retained_present:true,image_deletion_authorized:false,automatic_retry:false};
 }
 if(request.action==='observe_product_release'&&v.state==='OBSERVED'){
  const m=v.product_release;
  operatorRequire(m&&match(SHA,m.source_sha)&&match(HEX,m.baseline_sha256)&&
   operatorExact(m.resources,['service','search','migration'])&&
   ['ABSENT','PRESENT','UNVERIFIED'].includes(m.retrieve_lock)&&
   ['MATCH','DRIFT','UNVERIFIED'].includes(m.nile_status)&&
   (m.nile_checksum===null||match(HEX,m.nile_checksum)),'operator_product_release_invalid');
  const resources={};
  for(const role of ['service','search','migration']){
   const x=m.resources[role],name={service:'jscc-command-api-dev',search:'jscc-search-dev',migration:'jscc-db-migrate-dev'}[role];
   operatorRequire(x?.name===name&&(x.source_sha==='UNKNOWN'||match(SHA,x.source_sha))&&
    (x.digest==='UNKNOWN'||match(/^sha256:[a-f0-9]{64}$/,x.digest))&&
    (role==='service'?match(/^jscc-command-api-dev-[a-z0-9-]{1,44}$/,x.revision):x.revision===null)&&
    typeof x.environment_bound==='boolean'&&typeof x.secret_pin_bound==='boolean'&&
    (x.build_id===null||match(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/,x.build_id))&&
    ['MATCH','MISMATCH','UNVERIFIED'].includes(x.registry_binding)&&
    ['PROVIDER_RESULT_MATCH','MISMATCH','UNVERIFIED'].includes(x.build_binding),'operator_product_release_invalid');
   resources[role]={name,source_sha:x.source_sha,digest:x.digest,revision:x.revision,
    environment_bound:x.environment_bound,secret_pin_bound:x.secret_pin_bound,build_id:x.build_id,
    registry_binding:x.registry_binding,build_binding:x.build_binding};
  }
  out.product_release={source_sha:m.source_sha,baseline_sha256:m.baseline_sha256,resources,
   retrieve_lock:m.retrieve_lock,nile_status:m.nile_status,nile_checksum:m.nile_checksum,
   release_authorized:false,source_provenance:'UNVERIFIED'};
 }
 if(v.audit!==undefined){
  const x=v.audit;
  operatorRequire(operatorExact(x,['environment','work_item_ref','approval_ref','approval_generation','approval_hash',
   'actor_sub_hash','operator_source_sha','approved_bundle_sha256','review_ref','cost_ref','execution_name',
   'claim_generation','requested_at_ms','started_at_ms','finished_at_ms','target_source_sha',
   'target_image_digest','script_sha256','original_approval_ref','exit_code','outcome'])&&
   x.environment==='dev'&&x.work_item_ref==='#589'&&x.approval_ref===request.approval_ref&&
   x.approval_generation===request.approval_generation&&match(GEN,x.approval_generation)&&
   x.approval_hash===request.approval_hash&&match(HEX,x.approval_hash)&&
   x.actor_sub_hash===request.actor_sub_hash&&match(HEX,x.actor_sub_hash)&&
   x.operator_source_sha===request.operator_source_sha&&match(SHA,x.operator_source_sha)&&
   match(HEX,x.approved_bundle_sha256)&&match(REF,x.review_ref)&&match(REF,x.cost_ref)&&
   new Set([x.approval_ref,x.review_ref,x.cost_ref]).size===3&&match(EXEC,x.execution_name)&&
   match(GEN,x.claim_generation)&&Number.isSafeInteger(x.requested_at_ms)&&
   x.requested_at_ms===request.requested_at_ms&&Number.isSafeInteger(x.started_at_ms)&&
   Number.isSafeInteger(x.finished_at_ms)&&x.requested_at_ms<=x.started_at_ms&&x.started_at_ms<=x.finished_at_ms&&
   (x.target_source_sha===null||match(SHA,x.target_source_sha))&&
   (x.target_image_digest===null||match(/^sha256:[a-f0-9]{64}$/,x.target_image_digest))&&
   (x.script_sha256===null||match(HEX,x.script_sha256))&&
   (x.original_approval_ref===null||match(REF,x.original_approval_ref)&&x.original_approval_ref!==x.approval_ref)&&
   x.exit_code===null&&x.outcome===v.state,'operator_audit_binding_invalid');
  // This projection is returned only by the authenticated, same-actor
  // operator route; no raw subject, parameters, credentials or log payload.
  out.audit={...x};
 }
 for(const k of ['protected_match','recovery_authorization_required','duplicate'])if(typeof v[k]==='boolean')out[k]=v[k];
 return out;
}
