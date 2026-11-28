// #589: fixed DEV snapshot metadata and transient archive copy/restore.
// No durable runtime objects, leases, approvals, DB data or arbitrary buckets
// may be modified. Copy and restore create only; cleanup is separately approved.
import {gcpFetch} from '../src/lib.mjs';
import {operatorExact,operatorRequire,operatorHash} from '../src/dev_operator_contract.mjs';
const STAGING='jscc-shared-ops-cloudbuild-source';
const RUNTIME='jscc-dev-runtime-828902654738';
const GEN=/^[1-9][0-9]{0,19}$/;
const ARCHIVE=/^source\/dev-[a-f0-9]{40}-[a-z0-9-]{8,64}\.tar\.gz$/;
const SNAPSHOT=/^runs\/[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}\/(?:run-status\.json|jobs\.json)$/;
const CRC=/^[a-zA-Z0-9+/]{6}==$/;
const MD5=/^[a-zA-Z0-9+/]{22}==$/;
const valid=(re,v)=>typeof v==='string'&&re.test(v)&&!v.includes('..');
const fields='bucket,name,generation,size,crc32c,md5Hash';
function metadata(raw,bucket,name,generation){
 operatorRequire(raw?.bucket===bucket&&raw.name===name&&valid(GEN,raw.generation)&&
  (generation===null||raw.generation===generation)&&typeof raw.size==='string'&&
  /^[0-9]{1,20}$/.test(raw.size)&&valid(CRC,raw.crc32c)&&
  (raw.md5Hash===undefined||valid(MD5,raw.md5Hash)),'gcs_artifact_metadata_invalid');
 return {bucket,name,generation:raw.generation,size:raw.size,crc32c:raw.crc32c,
  md5:raw.md5Hash??null};
}
const objectUrl=(bucket,name)=>'https://storage.googleapis.com/storage/v1/b/'+bucket+'/o/'+encodeURIComponent(name);
async function jsonRequest(url,method,fetchImpl,{noBody=false}={}){
 const response=await fetchImpl(url,{method,redirect:'error',signal:AbortSignal.timeout(15000),
  ...(method==='POST'&&!noBody?{headers:{'Content-Type':'application/json'},body:'{}'}:{})});
 operatorRequire(response.ok,'gcs_artifact_http_error');
 return response.json();
}
export async function executeDevGcsArtifact(input,{fetchImpl=gcpFetch,assertFresh,verifyCleanup,now=Date.now}={}){
 operatorRequire(input?.environment==='dev','gcs_artifact_environment_denied');
 if(input.operation==='snapshot_manifest'){
  operatorRequire(operatorExact(input,['environment','operation','run_id','expected_catalog_generation'])&&
   valid(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/,input.run_id)&&valid(GEN,input.expected_catalog_generation),
   'gcs_snapshot_target_denied');
  const names=['seed/sources.json','seed/source-categories.json','seed/nomenclatures.json',
   'runs/'+input.run_id+'/run-status.json','runs/'+input.run_id+'/jobs.json'];
  const capture=async()=>{
   const out=[];
   for(const name of names){
    // Live metadata only: no tenant/job contents, no historical generation lookup.
    const raw=await jsonRequest(objectUrl(RUNTIME,name)+'?'+new URLSearchParams({fields}),'GET',fetchImpl);
    out.push(metadata(raw,RUNTIME,name,null));
   }
   return out;
  };
  const first=await capture();
  operatorRequire(first[0].generation===input.expected_catalog_generation,'gcs_snapshot_catalog_drift');
  const second=await capture();
  const digest=operatorHash(first);
  operatorRequire(operatorHash(second)===digest,'gcs_snapshot_manifest_drift');
  return {state:'OBSERVED',snapshot_manifest:{run_id:input.run_id,catalog_generation:input.expected_catalog_generation,
   objects:first,manifest_sha256:digest,consistency:'TWO_READS_MATCH',atomic_snapshot:false}};
 }
 if(input.operation==='metadata'){
  operatorRequire(operatorExact(input,['environment','operation','bucket','object','generation'])&&
   ((input.bucket===RUNTIME&&valid(SNAPSHOT,input.object))||
    (input.bucket===STAGING&&valid(ARCHIVE,input.object)))&&
   (input.generation===null||valid(GEN,input.generation)),'gcs_artifact_target_denied');
  const query=new URLSearchParams({fields});
  if(input.generation!==null)query.set('generation',input.generation);
  const value=metadata(await jsonRequest(objectUrl(input.bucket,input.object)+'?'+query,'GET',fetchImpl),
   input.bucket,input.object,input.generation);
  return {state:'OBSERVED',artifact_metadata:value};
 }
 if(input.operation==='restore_soft_deleted'||input.operation==='cleanup_generation'){

  const restore=input.operation==='restore_soft_deleted';
  const keys=['environment','operation','bucket','object','generation','expected_md5','expected_crc32c'];
  if(!restore)keys.push('original_approval_ref','build_id');
  operatorRequire(operatorExact(input,keys)&&input.bucket===STAGING&&valid(ARCHIVE,input.object)&&
   valid(GEN,input.generation)&&valid(MD5,input.expected_md5)&&valid(CRC,input.expected_crc32c)&&
   typeof assertFresh==='function'&&(restore||
    typeof verifyCleanup==='function'&&/^#589\/[1-9][0-9]{0,19}$/.test(input.original_approval_ref||'')&&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(input.build_id||'')),
   'gcs_artifact_mutation_denied');
  const url=objectUrl(STAGING,input.object);
  const q=new URLSearchParams({fields:fields+(restore?',softDeleteTime,hardDeleteTime,restoreToken':''),
   generation:input.generation,...(restore?{softDeleted:'true'}:{})});
  assertFresh();
  const raw=await jsonRequest(url+'?'+q,'GET',fetchImpl);
  const src=metadata(raw,STAGING,input.object,input.generation);
  operatorRequire(src.md5===input.expected_md5&&src.crc32c===input.expected_crc32c&&
   BigInt(src.size)<=64n*1024n*1024n,'gcs_artifact_source_mismatch');
  if(restore){
   // A restore must never overwrite a live object or restore an ambiguous
   // HNS version. This staging bucket's flat namespace is an admission gate.
   operatorRequire(typeof raw.softDeleteTime==='string'&&Number.isFinite(Date.parse(raw.softDeleteTime))&&
    typeof raw.hardDeleteTime==='string'&&Date.parse(raw.hardDeleteTime)>now()&&
    raw.restoreToken===undefined,'gcs_artifact_restore_not_admitted');
   const params=new URLSearchParams({generation:src.generation,ifGenerationMatch:'0',
    copySourceAcl:'false',projection:'noAcl',fields});
   assertFresh();
   const dest=metadata(await jsonRequest(url+'/restore?'+params,'POST',fetchImpl,{noBody:true}),
    STAGING,input.object,null);
   operatorRequire(dest.generation!==src.generation,'gcs_artifact_restore_unconfirmed');
   const saved=metadata(await jsonRequest(url+'?'+new URLSearchParams({fields,generation:dest.generation}),
    'GET',fetchImpl),STAGING,input.object,dest.generation);
   operatorRequire([dest,saved].every(x=>x.md5===src.md5&&x.crc32c===src.crc32c&&x.size===src.size),
    'gcs_artifact_restore_unconfirmed');
   return {state:'SUCCEEDED',artifact_metadata:saved,artifact_operation:'restore_soft_deleted',
    prior_generation:src.generation};
  }
  // Cleanup only this generation of an independently approved transient
  // staging archive. No live application objects or durable evidence.
  // The publisher must independently establish that no build needs it.
  assertFresh();
  await verifyCleanup(input);
  const deleteQuery=new URLSearchParams({generation:src.generation,ifGenerationMatch:src.generation});
  assertFresh();
  const deleted=await fetchImpl(url+'?'+deleteQuery,{method:'DELETE',redirect:'error',signal:AbortSignal.timeout(15000)});
  operatorRequire(deleted.status===204,'gcs_artifact_cleanup_uncertain');
  const after=await fetchImpl(url+'?'+new URLSearchParams({fields,generation:src.generation}),
   {method:'GET',redirect:'error',signal:AbortSignal.timeout(15000)});
  operatorRequire(after.status===404,'gcs_artifact_cleanup_unconfirmed');
  // 404 confirms the exact generation is not normally readable, not that
  // retained soft-delete bytes are physically gone or billing has stopped.
  return {state:'SUCCEEDED',artifact_metadata:src,artifact_operation:'cleanup_generation',
   generation_no_longer_live:true};
 }
 operatorRequire(input.operation==='copy_generation'&&operatorExact(input,['environment','operation',
  'source','source_generation','destination','expected_md5','expected_crc32c'])&&
  valid(ARCHIVE,input.source)&&valid(ARCHIVE,input.destination)&&input.source!==input.destination&&
  valid(GEN,input.source_generation)&&valid(MD5,input.expected_md5)&&valid(CRC,input.expected_crc32c)&&
  typeof assertFresh==='function',
  'gcs_artifact_copy_denied');
 const src=metadata(await jsonRequest(objectUrl(STAGING,input.source)+'?'+new URLSearchParams({
  fields,generation:input.source_generation
 }),'GET',fetchImpl),STAGING,input.source,input.source_generation);
 operatorRequire(src.md5===input.expected_md5&&src.crc32c===input.expected_crc32c&&
  BigInt(src.size)<=64n*1024n*1024n,'gcs_artifact_source_mismatch');
 const q=new URLSearchParams({sourceGeneration:src.generation,ifSourceGenerationMatch:src.generation,
  ifGenerationMatch:'0',fields:'done,resource('+fields+')'});
 const url=objectUrl(STAGING,input.source)+'/rewriteTo/b/'+STAGING+'/o/'+encodeURIComponent(input.destination)+'?'+q;
 // Only one rewrite call; uncertain/multipart outcome is never retried by
 // this operator. Independent reconciliation can inspect the destination.
 assertFresh();
 const copied=await jsonRequest(url,'POST',fetchImpl);
 operatorRequire(copied.done===true,'gcs_artifact_copy_outcome_unknown');
 const dest=metadata(copied.resource,STAGING,input.destination,null);
 const saved=metadata(await jsonRequest(objectUrl(STAGING,input.destination)+'?'+new URLSearchParams({
  fields,generation:dest.generation
 }),'GET',fetchImpl),STAGING,input.destination,dest.generation);
 operatorRequire(saved.size===src.size&&saved.md5===src.md5&&saved.crc32c===src.crc32c&&
  dest.size===saved.size&&dest.md5===saved.md5&&dest.crc32c===saved.crc32c,'gcs_artifact_copy_unconfirmed');
 return {state:'SUCCEEDED',artifact_metadata:saved};
}
