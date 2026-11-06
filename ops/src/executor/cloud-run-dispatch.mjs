// Additive module. Import only from the authenticated gateway request handler.
// Uses the Cloud Run v2 Job API. The gateway identity requires jobs.runWithOverrides
// on the single executor job, not project-wide administration rights.
import { createHash, createHmac, randomUUID, randomBytes } from 'node:crypto';
import { issueApproval } from './approval-issuer.mjs';
const PROJECT='jscc-dev';
const JOB='jscc-dev-executor';
const NAME=/^[a-z0-9][a-z0-9._-]{0,79}$/;
const AUTH='http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';
const RUN=`https://run.googleapis.com/v2/projects/${PROJECT}/locations/europe-west1/jobs/${JOB}:run`;
const GCS=`https://storage.googleapis.com/upload/storage/v1/b/`;
const safeErr=(code)=>new Error(`dev_dispatch_${code}`);
async function workloadToken(fetchImpl){
  const r=await fetchImpl(AUTH,{headers:{'Metadata-Flavor':'Google'},signal:AbortSignal.timeout(5000)});
  if(!r.ok)throw safeErr('identity_unavailable');
  const o=await r.json();
  if(typeof o.access_token!=='string'||o.access_token.length<10)throw safeErr('identity_invalid');
  return o.access_token;
}
export function validateDispatchRequest(req){
  if(!req||typeof req!=='object'||Array.isArray(req))throw safeErr('request_invalid');
  if(!['verify','implement','publish','merge','deploy'].includes(req.action))throw safeErr('action_invalid');
  if(!req.manifest||typeof req.manifest!=='object'||Array.isArray(req.manifest))throw safeErr('manifest_invalid');
  if(typeof req.idempotency_key!=='string'||!NAME.test(req.idempotency_key))throw safeErr('idempotency_invalid');
  if(req.manifest.repository!=='Shosetzel69/job-search-command-center')throw safeErr('repository_invalid');
  if(Object.keys(req).some(k=>!['action','manifest','idempotency_key','patch_base64'].includes(k)))throw safeErr('unexpected_request_field');
  if(typeof req.manifest.base_sha!=='string'||!/^[a-f0-9]{40}$/.test(req.manifest.base_sha))throw safeErr('base_sha_invalid');
  return req;
}
// Reserve idempotency in the gateway's persistent GCS store before this function.
// No client-supplied approval, bucket, image, project, job or service account is accepted.
export async function submitDevOperation(req,{actor,authorizeAction,githubToken,signingKey,admissionKey,fetchImpl=fetch,bucket, reserveOperation, recordOperation}){
  validateDispatchRequest(req);
  if(!actor?.sub || typeof reserveOperation!=='function'||typeof recordOperation!=='function')throw safeErr('server_integration_missing');
  if(typeof bucket!=='string'||!/^jscc-[a-z0-9-]{3,55}$/.test(bucket))throw safeErr('bucket_invalid');
  const {action,manifest,idempotency_key}=req;
  // Gateway performs immutable ingestion. Neither GCS object name nor generation is caller controlled.
  let patchBytes=null;
  if(['implement','publish'].includes(action)){
    if(typeof req.patch_base64!=='string'||req.patch_base64.length>245000||
       !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(req.patch_base64))throw safeErr('patch_encoding_invalid');
    patchBytes=Buffer.from(req.patch_base64,'base64');
    if(!patchBytes.length||patchBytes.length>180000||patchBytes.toString('base64')!==req.patch_base64)throw safeErr('patch_size_or_encoding_invalid');
    const digest=createHash('sha256').update(patchBytes).digest('hex');
    if(typeof manifest.patch_sha256!=='string'||digest!==manifest.patch_sha256)throw safeErr('patch_digest_mismatch');
  }else if(req.patch_base64!==undefined)throw safeErr('unexpected_patch');
  const key=createHash('sha256').update(actor.sub+'|'+idempotency_key).digest('hex');
  // Atomic, persistent reservation required. Conflicting requests must fail closed.
  const digest=createHash('sha256').update(JSON.stringify({action,manifest,patch_sha256:patchBytes?manifest.patch_sha256:null})).digest('hex');
  const reservation=await reserveOperation({key,digest,actor:actor.sub});
  if(!reservation||reservation.created!==true)throw safeErr('idempotency_conflict_or_replay');
  try{
    let validated=manifest;
    if(action!=='verify'){
      const issued=await issueApproval(manifest,action,{githubToken,signingKey,authorizationFn:async()=>authorizeAction({actor,action,manifest}),fetchImpl});
      validated={...manifest,approval:issued.approval,approval_signature:issued.approval_signature};
    }else if(await authorizeAction({actor,action,manifest})!==true){throw safeErr('verify_not_authorized');}
    const operationId=randomUUID();
    const token=await workloadToken(fetchImpl);
    let patchObject,patchGeneration;
    if(patchBytes){
      patchObject=`executor-patches/${operationId}.patch`;
      const patchUpload=await fetchImpl(`${GCS}${bucket}/o?uploadType=media&ifGenerationMatch=0&name=${encodeURIComponent(patchObject)}`,{
        method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/octet-stream'},body:patchBytes,signal:AbortSignal.timeout(15000)});
      if(!patchUpload.ok)throw safeErr('patch_upload_failed');
      const patchMeta=await patchUpload.json();
      if(patchMeta.name!==patchObject||!/^[1-9][0-9]{0,19}$/.test(String(patchMeta.generation||''))||
         Number(patchMeta.size)!==patchBytes.length)throw safeErr('patch_upload_binding_failed');
      patchGeneration=String(patchMeta.generation);
    }
    let admissionFields={};
    if(action!=='verify'){
      if(typeof admissionKey!=='string'||admissionKey.length<32)throw safeErr('admission_key_missing');
      const admission={operation_id:operationId,action,manifest_digest:createHash('sha256').update(JSON.stringify(validated,Object.keys(validated).sort())).digest('hex'),expires_at:Math.floor(Date.now()/1000)+300,nonce:randomBytes(16).toString('hex')};
      // Cross-language canonical signing: manifest is serialized with sorted keys; nested
      // approval keys must be normalized recursively to match Python sort_keys.
      const canonical=(v)=>Array.isArray(v)?v.map(canonical):(v&&typeof v==='object')?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
      admission.manifest_digest=createHash('sha256').update(JSON.stringify(canonical(validated))).digest('hex');
      const admission_signature=createHmac('sha256',admissionKey).update(JSON.stringify(canonical(admission))).digest('hex');
      admissionFields={admission,admission_signature};
    }
    const bytes=Buffer.from(JSON.stringify({action,manifest:validated,...(patchObject?{patch_object:patchObject,patch_generation:patchGeneration}:{}),...admissionFields}));
    if(bytes.length>200000)throw safeErr('request_too_large');
    const object=`executor-input/${operationId}.json`;
    const upload=await fetchImpl(`${GCS}${bucket}/o?uploadType=media&ifGenerationMatch=0&name=${encodeURIComponent(object)}`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','Content-Length':String(bytes.length)},body:bytes,signal:AbortSignal.timeout(15000)});
    if(!upload.ok)throw safeErr('input_upload_failed');
    const inputMeta=await upload.json();
    if(inputMeta.name!==object||!/^[1-9][0-9]{0,19}$/.test(String(inputMeta.generation||'')))throw safeErr('input_binding_failed');
    // Only a fixed allowlisted env key is overridden; caller may not set arbitrary overrides.
    const payload={overrides:{containerOverrides:[{env:[{name:'JSCC_INPUT_OBJECT',value:object}]}],taskCount:1}};
    const response=await fetchImpl(RUN,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw safeErr(`job_start_http_${response.status}`);
    const started=await response.json();
    if(typeof started.name!=='string'||!started.name.startsWith(`projects/${PROJECT}/locations/europe-west1/operations/`))throw safeErr('job_operation_invalid');
    await recordOperation({operationId,key,digest,actorSubHash:createHash('sha256').update(actor.sub).digest('hex'),action,work_item_ref:manifest.work_item_ref,cloudRunOperation:started.name,inputObject:object,state:'STARTED'});
    return {operation_id:operationId,state:'STARTED'};
  }catch(e){await recordOperation({key,digest,state:'FAILED_ADMISSION',error_code:String(e.message).slice(0,96)});throw e;}
}
