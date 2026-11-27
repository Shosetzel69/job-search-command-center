// #589: fixed DEV snapshot metadata and transient archive copy/restore.
// No durable runtime objects, leases, approvals, DB data or arbitrary buckets
// may be modified. Every copy is a new object, never an overwrite or delete.
import {gcpFetch} from '../src/lib.mjs';
import {operatorExact,operatorRequire} from '../src/dev_operator_contract.mjs';
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
async function jsonRequest(url,method,fetchImpl){
 const response=await fetchImpl(url,{method,redirect:'error',signal:AbortSignal.timeout(15000),
  ...(method==='POST'?{headers:{'Content-Type':'application/json'},body:'{}'}:{})});
 operatorRequire(response.ok,'gcs_artifact_http_error');
 return response.json();
}
export async function executeDevGcsArtifact(input,{fetchImpl=gcpFetch}={}){
 operatorRequire(input?.environment==='dev','gcs_artifact_environment_denied');
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
 operatorRequire(input.operation==='copy_generation'&&operatorExact(input,['environment','operation',
  'source','source_generation','destination','expected_md5','expected_crc32c'])&&
  valid(ARCHIVE,input.source)&&valid(ARCHIVE,input.destination)&&input.source!==input.destination&&
  valid(GEN,input.source_generation)&&valid(MD5,input.expected_md5)&&valid(CRC,input.expected_crc32c),
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
