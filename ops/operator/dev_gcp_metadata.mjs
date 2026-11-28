// #589: narrow metadata-only DEV observations, under the admitted operator.
import {gcpFetch} from '../src/lib.mjs';
import {operatorExact,operatorRequire,DEV_RUN_PERMISSION_PROBES} from '../src/dev_operator_contract.mjs';
import {createDevObserver,DEV_OBSERVATION_TARGETS} from '../observation/dev-runtime-observer.mjs';
const JOBS=new Set(['jscc-search-dev','jscc-diagnostics-dev','jscc-db-migrate-dev','jscc-ops-operator-dev']);
const SECRETS=new Set(['JSCC_OPS_GOOGLE_CLIENT_ID','JSCC_OPS_GOOGLE_CLIENT_SECRET','JSCC_OPS_GOOGLE_ALLOWED_SUB','NILE_DATABASE_URL']);
const PACKAGES=new Set(['jscc-ops-gateway','jscc-diagnostics','jscc-ops-operator',
 'jscc-dev-workspace-manager-r2','jscc-dev-workspace-worker-cap100']);
const RUN='https://run.googleapis.com/v2/projects/jscc-dev/locations/europe-west1';
const REGISTRY='projects/jscc-shared/locations/europe-west1/repositories/jscc-ops';
const AR='https://artifactregistry.googleapis.com/v1/';
const SHA=/^[a-f0-9]{40}$/;
const DIGEST=/^sha256:[a-f0-9]{64}$/;
const ENV=/^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const ACCOUNT=/^[a-z][a-z0-9-]{3,120}@jscc-dev\.iam\.gserviceaccount\.com$/;
const match=(re,x)=>typeof x==='string'&&re.test(x);
async function get(url,fetchImpl,body){
 const response=await fetchImpl(url,{method:body===undefined?'GET':'POST',redirect:'error',signal:AbortSignal.timeout(10000),
  ...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
 operatorRequire(response.ok,'gcp_metadata_http_error');
 const text=await response.text();
 operatorRequire(Buffer.byteLength(text)<=131072,'gcp_metadata_response_limit');
 return JSON.parse(text);
}
function containerMetadata(c){
 operatorRequire(c&&typeof c==='object'&&Array.isArray(c.env||[])&&(c.env||[]).length<=128,
  'gcp_metadata_container_invalid');
 const env=(c.env||[]).map(row=>{
  operatorRequire(match(ENV,row.name),'gcp_metadata_env_name_invalid');
  // Never return plain env values or the contents of Secret Manager.
  if(!row.valueSource)return {name:row.name,kind:'plain'};
  const ref=row.valueSource.secretKeyRef;
  if(!ref||typeof ref.secret!=='string'||!/^(?:projects\/jscc-dev\/secrets\/)?[A-Za-z0-9_-]{1,255}$/.test(ref.secret)||
   typeof ref.version!=='string'||!(/^[0-9]{1,20}$/.test(ref.version)||ref.version==='latest'))
   return {name:row.name,kind:'reference_unverified'};
  return {name:row.name,kind:'secret_reference',secret:ref.secret,version:ref.version};
 });
 const image=typeof c.image==='string'&&/^europe-west1-docker\.pkg\.dev\/jscc-shared\/(?:jscc|jscc-ops)\/[a-z0-9._-]+@sha256:[a-f0-9]{64}$/.test(c.image)?c.image:'UNKNOWN';
 return {image,env};
}
export async function executeDevGcpMetadata(input,{fetchImpl=gcpFetch}={}){
 operatorRequire(input?.environment==='dev','gcp_metadata_environment_denied');
 if(input.kind==='artifact_tag'){
  operatorRequire(operatorExact(input,['environment','kind','package','source_sha'])&&PACKAGES.has(input.package)&&
   match(SHA,input.source_sha),'gcp_metadata_artifact_denied');
  const repo=await get(AR+REGISTRY,fetchImpl);
  operatorRequire(repo.name===REGISTRY&&repo.dockerConfig?.immutableTags===true,'gcp_metadata_registry_not_immutable');
  const parent=REGISTRY+'/packages/'+input.package;
  const name=parent+'/tags/'+input.source_sha;
  const tag=await get(AR+name,fetchImpl);
  const prefix=parent+'/versions/';
  operatorRequire(tag.name===name&&typeof tag.version==='string'&&tag.version.startsWith(prefix)&&
   match(DIGEST,tag.version.slice(prefix.length)),'gcp_metadata_tag_mismatch');
  const digest=tag.version.slice(prefix.length);
  const imageName=REGISTRY+'/dockerImages/'+input.package+'@'+digest;
  const image=await get(AR+REGISTRY+'/dockerImages/'+encodeURIComponent(input.package+'@'+digest),fetchImpl);
  const uri='europe-west1-docker.pkg.dev/jscc-shared/jscc-ops/'+input.package+'@'+digest;
  operatorRequire(image.name===imageName&&image.uri===uri,'gcp_metadata_image_mismatch');
  return {state:'OBSERVED',metadata:{kind:input.kind,package:input.package,source_sha:input.source_sha,
   digest,uri,immutable_tags:true,source_provenance:'UNVERIFIED'}};
 }
 operatorRequire(operatorExact(input,['environment','kind','name']),'gcp_metadata_request_denied');
 if(input.kind==='billing_status'){
  operatorRequire(['jscc-dev','jscc-shared'].includes(input.name),'gcp_metadata_billing_target_denied');
  const name='projects/'+input.name+'/billingInfo';
  const v=await get('https://cloudbilling.googleapis.com/v1/'+name+'?fields=name,projectId,billingEnabled',fetchImpl);
  operatorRequire(v.name===name&&v.projectId===input.name&&typeof v.billingEnabled==='boolean',
   'gcp_metadata_billing_binding_mismatch');
  return {state:'OBSERVED',metadata:{kind:input.kind,name:input.name,billing_enabled:v.billingEnabled,
   spend:'UNVERIFIED',cost_admission:'UNVERIFIED'}};
 }
 if(input.kind==='quota_info'){
  operatorRequire(['run.googleapis.com','storage.googleapis.com'].includes(input.name),'gcp_metadata_quota_target_denied');
  const parent='projects/828902654738/locations/global/services/'+input.name;
  const records=[],ids=new Set(),tokens=new Set();
  let pageToken='';
  for(let page=0;page<4;page++){
   const q=new URLSearchParams({pageSize:'50',fields:'quotaInfos(name,quotaId,service,metricUnit,dimensionsInfos(dimensions,details(value),applicableLocations)),nextPageToken'});
   if(pageToken)q.set('pageToken',pageToken);
   const v=await get('https://cloudquotas.googleapis.com/v1/'+parent+'/quotaInfos?'+q,fetchImpl);
   const rows=v.quotaInfos||[];
   operatorRequire(Array.isArray(rows)&&rows.length<=50,'gcp_metadata_quota_page_invalid');
   for(const row of rows){
    operatorRequire(typeof row.quotaId==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(row.quotaId)&&
     row.name===parent+'/quotaInfos/'+row.quotaId&&row.service===input.name&&!ids.has(row.quotaId)&&
     Array.isArray(row.dimensionsInfos||[])&&(row.dimensionsInfos||[]).length<=200,'gcp_metadata_quota_binding_mismatch');
    ids.add(row.quotaId);
    const limits=[];
    for(const dim of row.dimensionsInfos||[]){
     // No inference from omitted regional dimensions or arbitrary provider dimensions.
     // Report only global / europe-west1 scopes with no extra dimension keys.
     const keys=Object.keys(dim.dimensions||{});
     const locations=dim.applicableLocations||[];
     operatorRequire(Array.isArray(locations)&&locations.length<=200,'gcp_metadata_quota_locations_invalid');
     if(keys.some(x=>x!=='region'))continue;
     for(const location of ['global','europe-west1']){
      if(!locations.includes(location)||keys.length&&dim.dimensions.region!==location)continue;
      const value=dim.details?.value;
      operatorRequire(typeof value==='string'&&/^-?[0-9]{1,19}$/.test(value),'gcp_metadata_quota_limit_invalid');
      limits.push({location,value});
     }
    }
    operatorRequire(limits.length<=2&&new Set(limits.map(x=>x.location)).size===limits.length,'gcp_metadata_quota_dimension_ambiguous');
    records.push({quota_id:row.quotaId,limits});
   }
   pageToken=v.nextPageToken||'';
   operatorRequire(typeof pageToken==='string'&&pageToken.length<=2048&&(!pageToken||!tokens.has(pageToken)),
    'gcp_metadata_quota_page_token_invalid');
   if(!pageToken)break;
   tokens.add(pageToken);
  }
  const metadata={kind:input.kind,name:input.name,project:'jscc-dev',quotas:records,
   pagination_complete:!pageToken,usage:'UNVERIFIED',cost_admission:'UNVERIFIED'};
  operatorRequire(Buffer.byteLength(JSON.stringify(metadata))<=32768,'gcp_metadata_projection_limit');
  return {state:'OBSERVED',metadata};
 }
 if(input.kind==='secret'){
  operatorRequire(SECRETS.has(input.name),'gcp_metadata_secret_denied');
  const name='projects/jscc-dev/secrets/'+input.name;
  const secret=await get('https://secretmanager.googleapis.com/v1/'+name+'?fields=name,replication',fetchImpl);
  operatorRequire(secret.name===name||secret.name==='projects/828902654738/secrets/'+input.name,
   'gcp_metadata_secret_mismatch');
  return {state:'OBSERVED',metadata:{kind:'secret',name:input.name,
   replication:secret.replication?.automatic?'automatic':secret.replication?.userManaged?'user_managed':'UNKNOWN'}};
 }
 if(Object.hasOwn(DEV_RUN_PERMISSION_PROBES,input.kind)){
  const job=input.kind==='run_job_permissions';
  operatorRequire(job?JOBS.has(input.name):DEV_OBSERVATION_TARGETS.includes(input.name),
   'gcp_metadata_permission_target_denied');
  const suffix=(job?'/jobs/':'/services/')+input.name;
  // A missing resource may return an empty IAM probe. Require independently
  // observed resource identity first; never claim absence of grants globally.
  const resource=await get(RUN+suffix+'?fields=name',fetchImpl);
  operatorRequire(resource.name==='projects/jscc-dev/locations/europe-west1'+suffix,
   'gcp_metadata_permission_resource_unverified');
  const requested=DEV_RUN_PERMISSION_PROBES[input.kind];
  const result=await get(RUN+suffix+':testIamPermissions',fetchImpl,{permissions:[...requested]});
  operatorRequire(result&&typeof result==='object'&&!Array.isArray(result),'gcp_metadata_permission_invalid');
  const reported=result.permissions===undefined?[]:result.permissions;
  operatorRequire(Array.isArray(reported)&&reported.every(x=>requested.includes(x))&&
   new Set(reported).size===reported.length,'gcp_metadata_permission_invalid');
  return {state:'OBSERVED',metadata:{kind:input.kind,name:input.name,scope:'current_operator_resource_probe',
   resource_exists:true,requested_permissions:[...requested],reported_permissions:requested.filter(x=>reported.includes(x)),
   not_reported_permissions:requested.filter(x=>!reported.includes(x)),policy_isolation:'UNVERIFIED'}};
 }
 const isJob=input.kind==='run_job',isService=input.kind==='run_service';
 operatorRequire((isJob&&JOBS.has(input.name))||(isService&&DEV_OBSERVATION_TARGETS.includes(input.name)),
  'gcp_metadata_run_denied');
 const suffix=(isJob?'/jobs/':'/services/')+input.name;
 const value=await get(RUN+suffix,fetchImpl);
 operatorRequire(value.name==='projects/jscc-dev/locations/europe-west1'+suffix&&value.reconciling!==true,
  'gcp_metadata_run_mismatch');
 const task=isJob?value.template?.template:value.template;
 operatorRequire(task&&Array.isArray(task.containers)&&task.containers.length>0&&task.containers.length<=4,
  'gcp_metadata_run_invalid');
 const result={kind:input.kind,name:input.name,service_account:match(ACCOUNT,task.serviceAccount)?task.serviceAccount:'UNKNOWN',
  containers:task.containers.map(containerMetadata)};
 if(isJob){
  for(const [key,v] of Object.entries({task_count:value.template.taskCount,parallelism:value.template.parallelism,max_retries:task.maxRetries}))
   if(Number.isSafeInteger(v)&&v>=0)result[key]=v;
  if(typeof task.timeout==='string'&&/^[0-9]{1,6}s$/.test(task.timeout))result.timeout=task.timeout;
 }else{
  const rows=value.trafficStatuses;
  operatorRequire(Array.isArray(rows)&&rows.length>0&&rows.length<=20,'gcp_metadata_traffic_invalid');
  result.traffic=rows.map(x=>{
   const prefix='projects/jscc-dev/locations/europe-west1/services/'+input.name+'/revisions/';
   let revision=x.revision;
   if(typeof revision==='string'&&revision.startsWith(prefix))revision=revision.slice(prefix.length);
   if(!revision&&x.type==='TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST'){
    revision=value.latestReadyRevision;
    if(typeof revision==='string'&&revision.startsWith(prefix))revision=revision.slice(prefix.length);
   }
   operatorRequire(typeof revision==='string'&&revision.startsWith(input.name+'-')&&/^[a-z0-9-]{1,100}$/.test(revision)&&
    Number.isInteger(x.percent)&&x.percent>=0&&x.percent<=100,'gcp_metadata_traffic_invalid');
   return {revision,percent:x.percent,...(typeof x.tag==='string'&&/^[a-z0-9-]{1,63}$/.test(x.tag)?{tag:x.tag}:{})};
  });
  operatorRequire(result.traffic.reduce((n,x)=>n+x.percent,0)===100,'gcp_metadata_traffic_invalid');
  const servicePath='/v2/projects/jscc-dev/locations/europe-west1/services/'+input.name;
  const revisionPaths=new Set(result.traffic.map(x=>servicePath+'/revisions/'+x.revision));
  const cache=new Map([[servicePath,value]]);
  const observer=createDevObserver({transport:async({api,path})=>{
   operatorRequire(api==='run.googleapis.com'&&(path===servicePath||revisionPaths.has(path)),
    'gcp_metadata_revision_denied');
   if(!cache.has(path))cache.set(path,await get('https://'+api+path,fetchImpl));
   return {status:200,body:cache.get(path)};
  }});
  const observation=await observer.describe({environment:'dev',task:'describe_dev_runtime',service:input.name});
  result.effective_revisions=observation.effective_revisions.map(x=>({
   revision:x.revision,percent:x.percent,image_digest:x.image_digest}));
  result.source_provenance='UNVERIFIED';
 }
 operatorRequire(Buffer.byteLength(JSON.stringify(result))<=32768,'gcp_metadata_projection_limit');
 return {state:'OBSERVED',metadata:result};
}
