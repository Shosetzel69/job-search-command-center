// #589: correlate the original admitted successful build with exact immutable
// tags and fixed build-produced markers. Never return arbitrary log content.
import {gcpFetch} from '../src/lib.mjs';
import {operatorRequire} from '../src/dev_operator_contract.mjs';
import {executeDevGcpMetadata} from './dev_gcp_metadata.mjs';
const SHA=/^[a-f0-9]{40}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const DIGEST=/^sha256:[a-f0-9]{64}$/;
const ROOT='europe-west1-docker.pkg.dev/jscc-shared/jscc-ops/';
const OPS=['jscc-ops-gateway','jscc-diagnostics','jscc-ops-operator','jscc-ops-publisher'];
const WORKSPACE=['jscc-dev-workspace-manager-r2','jscc-dev-workspace-worker-cap100'];
// Only a dedicated, independently admitted shared-project view. No project-wide fallback.
const VIEW='projects/jscc-shared/locations/global/buckets/_Default/views/jscc-ops-build-dev';
export async function observeDevBuildArtifacts(original,{observe,metadata=executeDevGcpMetadata,fetchImpl=gcpFetch}={}){
 operatorRequire(typeof observe==='function','build_evidence_observer_missing');
 const build=await observe(original),m=build.build_observation;
 operatorRequire(build.state==='SUCCEEDED'&&m?.build_status==='SUCCESS'&&UUID.test(build.build_id||'')&&
  SHA.test(m.source_sha||'')&&m.source_sha===original.request?.source_sha&&m.build_kind===original.request?.build_kind,
  'build_evidence_original_not_successful');
 const packages=m.build_kind==='workspace_r2'?WORKSPACE:OPS;
 const images=[];
 for(const name of packages){
  const result=await metadata({environment:'dev',kind:'artifact_tag',package:name,source_sha:m.source_sha});
  const value=result?.metadata;
  operatorRequire(result.state==='OBSERVED'&&value?.kind==='artifact_tag'&&value.package===name&&
   value.source_sha===m.source_sha&&value.immutable_tags===true&&DIGEST.test(value.digest||'')&&
   value.uri===ROOT+name+'@'+value.digest,'build_evidence_registry_mismatch');
  images.push({package:name,digest:value.digest,marker:'MISSING'});
 }
 let complete=false,denied=false,token='';
 const seen=new Set(),markers=new Map();
 // Build-specific filtering and response binding; no raw payload projection.
 const filter='resource.type="build" AND resource.labels.project_id="jscc-shared" AND resource.labels.build_id="'+
  build.build_id+'" AND log_id("cloudbuild")';
 for(let page=0;page<8;page++){
  const response=await fetchImpl('https://logging.googleapis.com/v2/entries:list',{
   method:'POST',headers:{'Content-Type':'application/json'},redirect:'error',signal:AbortSignal.timeout(15000),
   body:JSON.stringify({resourceNames:[VIEW],filter,orderBy:'timestamp desc',pageSize:100,...(token?{pageToken:token}:{})})});
  if([403,404].includes(response.status)){denied=true;break;}
  operatorRequire(response.ok,'build_evidence_log_read_failed');
  const raw=await response.text();
  operatorRequire(Buffer.byteLength(raw)<=1024*1024,'build_evidence_log_limit');
  const value=JSON.parse(raw),rows=value.entries||[];
  operatorRequire(Array.isArray(rows)&&rows.length<=100,'build_evidence_log_page_invalid');
  for(const row of rows){
   operatorRequire(row?.resource?.type==='build'&&row.resource.labels?.project_id==='jscc-shared'&&
    row.resource.labels.build_id===build.build_id&&row.logName==='projects/jscc-shared/logs/cloudbuild',
    'build_evidence_log_binding_mismatch');
   if(typeof row.textPayload!=='string'||row.textPayload.length>8192)continue;
   const payload=row.textPayload.trim().replace(/^Step #[0-9]{1,3} - "[a-z0-9-]{1,80}": /,'');
   for(const item of images){
    const prefix=m.build_kind==='workspace_r2'?
     (item.package===WORKSPACE[0]?'JSCC589_MANAGER_R2_IMAGE=':'JSCC589_WORKER_R2_IMAGE=')+ROOT+item.package+'@':
     'OPS_IMAGE='+ROOT+item.package+':'+m.source_sha+'@';
    if(!payload.startsWith(prefix))continue;
    const digest=payload.slice(prefix.length);
    if(!DIGEST.test(digest))continue;
    const found=markers.get(item.package)||new Set();
    found.add(digest);markers.set(item.package,found);
   }
  }
  token=value.nextPageToken||'';
  operatorRequire(typeof token==='string'&&token.length<=2048&&(!token||!seen.has(token)),'build_evidence_log_token_invalid');
  if(!token){complete=true;break;}
  seen.add(token);
 }
 for(const item of images){
  const found=markers.get(item.package);
  item.marker=!found?'MISSING':found.size===1&&found.has(item.digest)?'MATCH':'MISMATCH';
 }
 const correlation=images.some(x=>x.marker==='MISMATCH')?'MISMATCH':
  denied?'LOG_ACCESS_DENIED':complete&&images.every(x=>x.marker==='MATCH')?'MATCHED_MARKERS':'INCOMPLETE';
 return {...build,state:'OBSERVED',source_provenance:'UNVERIFIED',
  build_artifacts:{log_search_complete:complete,correlation,images,source_provenance:'UNVERIFIED'}};
}
