// #589: fixed one-shot private DEV operator Job. No HTTP endpoint or shell API.
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {gcpFetch,gcsReadJson,gcsWriteJson,metadataAccessToken} from '../src/lib.mjs';
import {OPERATOR_BUCKET,OPERATOR_JOB,operatorPaths,operatorDispatchPath,operatorExecution,
 operatorRequire,operatorHash,validateOperatorApproval,validateOperatorRequest,projectOperatorResult}
 from '../src/dev_operator_contract.mjs';
import {verifyOperatorLifecycle} from '../src/dev_operator_gateway.mjs';
import {runApprovedBuild,observeApprovedBuildEvidence,cancelApprovedBuild,reconcileApprovedBuild} from '../../scripts/gcp/remote_executor_dev_build.mjs';
import {runApprovedPair,observePairRecovery} from '../../scripts/gcp/remote_executor_dev_pair.mjs';
import {operatorPairStore,readPairOperation} from '../../scripts/gcp/remote_executor_dev_admission.mjs';
import {createDevObserver,admitDevRequest} from '../observation/dev-runtime-observer.mjs';
import {executeDevGcloudScript} from '../diagnostics/dev-gcloud-script-runner.mjs';
import {executeDevGcsArtifact} from './dev_gcs_artifacts.mjs';
import {executeDevGcpMetadata} from './dev_gcp_metadata.mjs';
import {executeDevRunExecution} from './dev_run_execution.mjs';
import {observeDevBuildArtifacts,observeOpsDelivery} from './dev_build_evidence.mjs';
import {observeWorkspaceRelease,executeWorkspaceReleaseStep,cleanupWorkspaceRevision,observeWorkspaceDelivery} from './dev_workspace_release.mjs';
import {observeProductRelease,observeProductIncident} from './dev_product_release_observation.mjs';

const SA='jscc-ops-operator-dev@jscc-dev.iam.gserviceaccount.com';
const META='http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/';
const read=path=>gcsReadJson(OPERATOR_BUCKET,path);
const create=(path,data)=>gcsWriteJson(OPERATOR_BUCKET,path,data,0);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const GEN=/^[1-9][0-9]{0,19}$/;
const SHA=/^[a-f0-9]{40}$/;

export async function runtimeConfig(env=process.env,{fetchImpl=fetch,readSource=()=>readFile(
 new URL('../operator-source-sha',import.meta.url),'utf8')}={}){
 operatorRequire(env.CLOUD_RUN_JOB===OPERATOR_JOB&&env.CLOUD_RUN_TASK_INDEX==='0'&&
  env.CLOUD_RUN_TASK_COUNT==='1'&&env.CLOUD_RUN_TASK_ATTEMPT==='0'&&
  env.GCP_PROJECT==='jscc-dev'&&env.GCP_REGION==='europe-west1'&&env.OPS_BUCKET===OPERATOR_BUCKET&&
  SHA.test(env.SOURCE_SHA||'')&&operatorExecution(env.CLOUD_RUN_EXECUTION)===env.CLOUD_RUN_EXECUTION&&
  typeof env.CLOUD_RUN_EXECUTION==='string','operator_runtime_denied');
 operatorRequire((await readSource()).trim()===env.SOURCE_SHA,'operator_image_source_mismatch');
 const response=await fetchImpl(META+'email',{headers:{'Metadata-Flavor':'Google'},
  redirect:'error',signal:AbortSignal.timeout(5000)});
 operatorRequire(response.ok&&(await response.text()).trim()===SA,'operator_identity_denied');
 return Object.freeze({sourceSha:env.SOURCE_SHA,execution:env.CLOUD_RUN_EXECUTION});
}

async function readOriginal(ref,actor,get){
 const record=await get(operatorPaths(ref).approval);
 // The original action may have used an older operator image and expired;
 // status observation cannot re-execute it.
 const sourceSha=record?.data?.operator_source_sha;
 return validateOperatorApproval(record,{ref,actor,sourceSha,fresh:false}).approval;
}

async function inventoryTransport({api,path}){
 // Independently re-admit exact resources; the observer builds these URLs.
 if(api==='run.googleapis.com'){
  const m=path.match(/^\/v2\/projects\/jscc-dev\/locations\/europe-west1\/services\/([a-z0-9-]+)(?:\/revisions\/([a-z0-9-]+))?$/);
  operatorRequire(m&&(!m[2]||m[2].startsWith(m[1]+'-')),'operator_inventory_target_denied');
  admitDevRequest({environment:'dev',task:'describe_dev_runtime',service:m[1]});
 }else if(api==='cloudbuild.googleapis.com'){
  const m=path.match(/^\/v1\/projects\/jscc-shared\/locations\/europe-west1\/builds\/([a-f0-9-]+)$/);
  operatorRequire(m,'operator_inventory_target_denied');
  admitDevRequest({environment:'dev',task:'describe_dev_build',buildId:m[1]});
 }else throw Error('operator_inventory_api_denied');
 const r=await gcpFetch('https://'+api+path,{redirect:'error',signal:AbortSignal.timeout(10000)});
 if(!r.ok)return {status:r.status,body:null};
 const body=await r.text();
 operatorRequire(Buffer.byteLength(body)<=131072,'operator_inventory_response_limit');
 return {status:r.status,body:JSON.parse(body)};
}

const defaultHandlers={

 gcs_artifact:async(a,get)=>executeDevGcsArtifact(a.bundle,{assertFresh:()=>operatorRequire(
  Date.now()>=a.issued_at_ms&&Date.now()<a.expires_at_ms,'operator_approval_expired'),
  verifyCleanup:async input=>{
   const original=await readOriginal(input.original_approval_ref,a.actor_sub_hash,get);
   operatorRequire(original.action==='build'&&original.bundle.archive?.bucket===input.bucket&&
    original.bundle.archive?.object===input.object&&original.bundle.archive?.generation===input.generation,
    'operator_cleanup_original_mismatch');
   const build=await observeApprovedBuildEvidence(original.bundle,{getToken:()=>metadataAccessToken()});
   operatorRequire(build.build_id===input.build_id&&['SUCCEEDED','FAILED','CANCELLED'].includes(build.state),
    'operator_cleanup_build_not_terminal');
  }}),
 gcp_metadata:async a=>executeDevGcpMetadata(a.bundle),
 observe_product_release:async(a,get)=>observeProductRelease(a.bundle,{actor:a.actor_sub_hash,readEvidence:get}),
 observe_product_incident:async(a,get)=>observeProductIncident(a.bundle,{actor:a.actor_sub_hash,readEvidence:get}),
 observe_workspace_delivery:async(a,get)=>observeWorkspaceDelivery(a.bundle,{
  actor:a.actor_sub_hash,get}),
 observe_workspace_release:async()=>observeWorkspaceRelease(),
 workspace_revision_cleanup:async a=>cleanupWorkspaceRevision(a.bundle,{
  assertFresh:()=>operatorRequire(Date.now()>=a.issued_at_ms&&Date.now()<a.expires_at_ms,'operator_approval_expired')}),
 workspace_release_step:async(a,get)=>{
  const original=await readOriginal(a.bundle.build_approval_ref,a.actor_sub_hash,get);
  operatorRequire(original.action==='build'&&original.bundle.request?.build_kind==='workspace_r2'&&
   original.bundle.request.source_sha===a.bundle.source_sha,'workspace_release_build_binding_mismatch');
  return executeWorkspaceReleaseStep(a.bundle,{
   observeBuild:()=>observeApprovedBuildEvidence(original.bundle,{getToken:()=>metadataAccessToken()}),
   assertFresh:()=>operatorRequire(Date.now()>=a.issued_at_ms&&Date.now()<a.expires_at_ms,'operator_approval_expired')});
 },
 observe_run_execution:async a=>executeDevRunExecution(a.bundle),
 cancel_diagnostic_execution:async a=>executeDevRunExecution(a.bundle,{cancel:true,
  assertFresh:()=>operatorRequire(Date.now()>=a.issued_at_ms&&Date.now()<a.expires_at_ms,'operator_approval_expired')}),
 build:async a=>runApprovedBuild({bundle:a.bundle,trustedEvidenceHash:a.bundle_hash},
  {getToken:()=>metadataAccessToken(),verifyStagedConfig:true}),
 deploy_ops_pair:async a=>runApprovedPair({bundle:a.bundle,trustedEvidenceHash:a.bundle_hash,
  store:operatorPairStore({getToken:()=>metadataAccessToken()})},
  undefined,async()=>a.operator_source_sha),
 observe_build:async(a,get)=>{
  const original=await readOriginal(a.bundle.original_approval_ref,a.actor_sub_hash,get);
  operatorRequire(original.action==='build','operator_observation_action_mismatch');
  return observeApprovedBuildEvidence(original.bundle,{getToken:()=>metadataAccessToken()});
 },
 observe_build_artifacts:async(a,get)=>{
  const original=await readOriginal(a.bundle.original_approval_ref,a.actor_sub_hash,get);
  operatorRequire(original.action==='build','operator_observation_action_mismatch');
  return observeDevBuildArtifacts(original.bundle,{observe:bundle=>observeApprovedBuildEvidence(bundle,
   {getToken:()=>metadataAccessToken()})});
 },
 reconcile_build_submission:async(a,get)=>{
  const original=await readOriginal(a.bundle.original_approval_ref,a.actor_sub_hash,get);
  operatorRequire(original.action==='build','operator_recovery_original_action_mismatch');
  const result=await reconcileApprovedBuild(original.bundle,a.bundle.build_id,{
   getToken:()=>metadataAccessToken(),assertFresh:()=>operatorRequire(
    Date.now()>=a.issued_at_ms&&Date.now()<a.expires_at_ms,'operator_approval_expired')});
  return {...result,controller_operation_id:result.operation_id};
 },
 cancel_build:async(a,get)=>{
  const original=await readOriginal(a.bundle.original_approval_ref,a.actor_sub_hash,get);
  operatorRequire(original.action==='build','operator_cancel_original_action_mismatch');
  return cancelApprovedBuild(original.bundle,a.bundle.build_id,{
   getToken:()=>metadataAccessToken(),assertFresh:()=>operatorRequire(
    Date.now()>=a.issued_at_ms&&Date.now()<a.expires_at_ms,'operator_approval_expired')});
 },
 observe_ops_delivery:async(a,get)=>{
  const store=operatorPairStore({getToken:()=>metadataAccessToken()});
  return observeOpsDelivery(a.bundle,{actor:a.actor_sub_hash,get,
   readPair:ref=>readPairOperation(store,ref),observePair:ref=>observePairRecovery({approvalRef:ref,store})});
 },
 observe_pair:async(a,get)=>{
  const original=await readOriginal(a.bundle.original_approval_ref,a.actor_sub_hash,get);
  operatorRequire(original.action==='deploy_ops_pair','operator_observation_action_mismatch');
  const result=await observePairRecovery({approvalRef:original.approval_ref,
   store:operatorPairStore({getToken:()=>metadataAccessToken()})});
  return {...result,state:'OBSERVED'};
 },
 gcloud_inventory:async a=>{
  const result=await executeDevGcloudScript(a.bundle,{observer:createDevObserver({transport:inventoryTransport})});
  return {state:'OBSERVED',script_verdict:result.script_verdict,build_id:result.build_id,
   source_provenance:'UNVERIFIED'};
 },
};

export async function runOperatorJob(config,{
 get=read,put=create,now=Date.now,wait=sleep,verifyLifecycle=verifyOperatorLifecycle,
 handlers=defaultHandlers,maxPolls=60,
}={}){
 operatorRequire(SHA.test(config?.sourceSha||'')&&operatorExecution(config.execution)===config.execution&&
  typeof config.execution==='string','operator_runtime_denied');
 let dispatch=null;
 for(let i=0;i<maxPolls;i++){
  dispatch=await get(operatorDispatchPath(config.execution));
  if(dispatch)break;
  await wait(500);
 }
 operatorRequire(GEN.test(dispatch?.generation||'')&&dispatch?.data?.execution_name===config.execution,
  'operator_dispatch_missing');
 const {execution_name,...request}=dispatch.data;
 const paths=operatorPaths(request.approval_ref);
 const stored=await get(paths.request);
 operatorRequire(GEN.test(stored?.generation||'')&&operatorHash(stored.data)===operatorHash(request),
  'operator_request_binding_mismatch');
 const admission=validateOperatorApproval(await get(paths.approval),{
  ref:request.approval_ref,actor:request.actor_sub_hash,sourceSha:config.sourceSha,now:now()
 });
 validateOperatorRequest(request,admission);
 await verifyLifecycle(now());
 // The Gateway cannot write claims/results; the Job cannot write approvals
 // or requests. An immutable create-only claim precedes any operator action.
 const claimPath='control/v1/operator-claims/'+paths.key+'.json';
 const claim={schema_version:'1.0',environment:'dev',operation_id:paths.key,
  approval_hash:request.approval_hash,execution_name,claimed_at_ms:now()};
 operatorRequire(now()<request.expires_at_ms,'operator_approval_expired');
 try{await put(claimPath,claim);}
 catch(e){
  if(e?.message!=='generation_precondition_failed')throw e;
  const old=await get(claimPath);
  operatorRequire(old?.data?.approval_hash===request.approval_hash,'operator_claim_mismatch');
  return {...projectOperatorResult(request,await get(paths.result)),duplicate:true};
 }
 const confirmed=await get(claimPath);
 operatorRequire(GEN.test(confirmed?.generation||'')&&operatorHash(confirmed.data)===operatorHash(claim),
  'operator_claim_uncertain');
 const startedAt=now();
 let result;
 try{
  operatorRequire(now()<request.expires_at_ms,'operator_approval_expired');
  const handler=handlers[request.action];
  operatorRequire(typeof handler==='function','operator_action_unavailable');
  const raw=await handler(admission.approval,get);
  const state=['RESERVED','VERIFYING','SUBMITTING','RUNNING'].includes(raw?.state)
   ?'RECOVERY_REQUIRED':raw?.state;
  // Do not publish raw API responses, tokens, source archives or journal.
  const projection=projectOperatorResult(request,{generation:'1',data:{
   ...raw,state,operation_id:request.operation_id,approval_hash:request.approval_hash,
   action:request.action,controller_operation_id:raw?.operation_id,
  }});
  result={...projection,approval_hash:request.approval_hash};
 }catch{
  result={operation_id:request.operation_id,approval_hash:request.approval_hash,
   action:request.action,state:'RECOVERY_REQUIRED',automatic_retry:false};
 }
 const approved=admission.approval,bundle=approved.bundle;
 const targetSource=bundle.request?.source_sha??bundle.source_sha??bundle.expected_source_sha??null;
 const targetDigest=bundle.expected_image?.split('@').at(-1)??null;
 const original=bundle.original_approval_ref??bundle.build_approval_ref??null;
 const scriptHash=bundle.script_sha256??null;
 // This immutable, sanitized audit links to the authoritative bundle rather
 // than copying its potentially sensitive parameters into operation results.
 // Operator/controller state is not a subprocess exit code.
 result.audit={environment:'dev',work_item_ref:'#589',approval_ref:request.approval_ref,
  approval_generation:admission.generation,approval_hash:request.approval_hash,
  actor_sub_hash:request.actor_sub_hash,operator_source_sha:request.operator_source_sha,
  approved_bundle_sha256:approved.bundle_hash,review_ref:approved.review_ref,cost_ref:approved.cost_ref,
  execution_name,claim_generation:confirmed.generation,requested_at_ms:request.requested_at_ms,
  started_at_ms:startedAt,finished_at_ms:now(),
  target_source_sha:typeof targetSource==='string'&&SHA.test(targetSource)?targetSource:null,
  target_image_digest:typeof targetDigest==='string'&&/^sha256:[a-f0-9]{64}$/.test(targetDigest)?targetDigest:null,
  script_sha256:typeof scriptHash==='string'&&/^[a-f0-9]{64}$/.test(scriptHash)?scriptHash:null,
  original_approval_ref:typeof original==='string'&&/^#589\/[1-9][0-9]{0,19}$/.test(original)?original:null,
  exit_code:null,outcome:result.state};
 // Validate the actual durable projection before attempting its write.
 projectOperatorResult(request,{generation:'1',data:result});
 await put(paths.result,result);
 const saved=await get(paths.result);
 operatorRequire(GEN.test(saved?.generation||'')&&operatorHash(saved.data)===operatorHash(result),
  'operator_result_uncertain');
 return projectOperatorResult(request,saved);
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
 try{
  const result=await runOperatorJob(await runtimeConfig());
  console.log(JSON.stringify({event:'operator_result',operation_id:result.operation_id,state:result.state}));
  if(!['SUBMITTED','WORKING','SUCCEEDED','OBSERVED','ROLLED_BACK'].includes(result.state))process.exitCode=1;
 }catch{
  console.error(JSON.stringify({event:'operator_blocked',error:'operator_execution_unconfirmed'}));
  process.exitCode=1;
 }
}
