// #589: Gateway requests only an independently admitted fixed DEV Job.
// No user-provided scripts, credentials, build configuration or job overrides.
import {readFileSync} from 'node:fs';
import {gcpFetch,gcsReadJson,gcsWriteJson} from './lib.mjs';
import {OPERATOR_BUCKET,OPERATOR_ROOT,OPERATOR_JOB,operatorActor,operatorPaths,
 operatorExecution,operatorLro,operatorDispatchPath,operatorHash,operatorRequest,
 operatorRequire,validateOperatorToolArgs,validateOperatorApproval,validateOperatorRequest,
 projectOperatorResult} from './dev_operator_contract.mjs';

const RUN='https://run.googleapis.com/v2/';
const OPERATOR_SA='jscc-ops-operator-dev@jscc-dev.iam.gserviceaccount.com';
const OPERATOR_IMAGE='europe-west1-docker.pkg.dev/jscc-shared/jscc-ops/jscc-ops-operator@';
export const operatorTools=Object.freeze([
 {name:'operator_start',description:'Start one independently approved DEV operator action by GitHub approval reference; no arbitrary scripts or parameters.',
  inputSchema:{type:'object',required:['approval_ref'],properties:{approval_ref:{type:'string',pattern:'^#589/[1-9][0-9]{0,19}$'}},additionalProperties:false}},
 {name:'operator_status',description:'Read sanitized state of an already requested DEV operator action; never retries.',
  inputSchema:{type:'object',required:['approval_ref'],properties:{approval_ref:{type:'string',pattern:'^#589/[1-9][0-9]{0,19}$'}},additionalProperties:false}},
]);
export function operatorGatewayConfig(env=process.env){
 if(env.JSCC_DEV_OPERATOR_ENABLED!=='true')return null;
 operatorRequire(env.GCP_PROJECT==='jscc-dev'&&env.GCP_REGION==='europe-west1'&&
  env.OPS_BUCKET===OPERATOR_BUCKET&&/^[a-f0-9]{40}$/.test(env.JSCC_DEV_OPERATOR_SOURCE_SHA||'')&&
  /^sha256:[a-f0-9]{64}$/.test(env.JSCC_DEV_OPERATOR_IMAGE_DIGEST||''),
  'operator_config_invalid');
 return Object.freeze({sourceSha:env.JSCC_DEV_OPERATOR_SOURCE_SHA,imageDigest:env.JSCC_DEV_OPERATOR_IMAGE_DIGEST});
}
const defaultRead=path=>gcsReadJson(OPERATOR_BUCKET,path);
const defaultCreate=(path,data)=>gcsWriteJson(OPERATOR_BUCKET,path,data,0);
async function cloudRun(method,path){
 const response=await gcpFetch(RUN+path,{method,redirect:'error',signal:AbortSignal.timeout(5000),
  ...(method==='POST'?{headers:{'content-type':'application/json'},body:'{}'}:{})});
 operatorRequire(response.ok,'operator_dispatch_http_error');
 return response.json();
}
export async function verifyOperatorLifecycle(now=Date.now(),fetchImpl=gcpFetch){
 const policy=JSON.parse(readFileSync(new URL('../../scripts/gcp/remote_executor_dev_lifecycle.json',import.meta.url),'utf8'));
 const r=await fetchImpl('https://storage.googleapis.com/storage/v1/b/'+OPERATOR_BUCKET+
  '?fields=name,location,lifecycle,updated',{redirect:'error',signal:AbortSignal.timeout(5000)});
 operatorRequire(r.ok,'operator_lifecycle_unavailable');
 const bucket=await r.json();
 const updated=Date.parse(bucket.updated);
 operatorRequire(bucket.name===OPERATOR_BUCKET&&String(bucket.location).toUpperCase()==='EUROPE-WEST1'&&
  operatorHash(bucket.lifecycle)===operatorHash(policy)&&Number.isFinite(updated)&&now-updated>=86400000,
  'operator_lifecycle_not_settled');
}
async function verifyJob(call,config){
 const job=await call('GET',OPERATOR_ROOT+'/jobs/'+OPERATOR_JOB);
 const execution=job?.template,task=execution?.template,container=task?.containers?.[0];
 const env=(name)=>{const values=container?.env?.filter(x=>x.name===name)||[];
  return values.length===1?values[0].value:null;};
 operatorRequire((job.name===OPERATOR_ROOT+'/jobs/'+OPERATOR_JOB||
  job.name==='projects/828902654738/locations/europe-west1/jobs/'+OPERATOR_JOB)&&
  job.reconciling!==true&&execution?.taskCount===1&&execution?.parallelism===1&&
  task?.maxRetries===0&&task?.serviceAccount===OPERATOR_SA&&task?.timeout==='1800s'&&
  (!task.volumes||task.volumes.length===0)&&
  task?.containers?.length===1&&container.image===OPERATOR_IMAGE+config.imageDigest&&
  (!container.command||container.command.length===0)&&(!container.args||container.args.length===0)&&
  (!container.volumeMounts||container.volumeMounts.length===0)&&
  container.resources?.limits?.cpu==='1'&&container.resources?.limits?.memory==='1Gi'&&
  Array.isArray(container.env)&&container.env.length===4&&container.env.every(x=>!x.valueSource)&&
  env('SOURCE_SHA')===config.sourceSha&&env('GCP_PROJECT')==='jscc-dev'&&env('GCP_REGION')==='europe-west1'&&
  env('OPS_BUCKET')===OPERATOR_BUCKET,'operator_job_binding_mismatch');
}
async function startExecution(call,sleep){
 let op=await call('POST',OPERATOR_ROOT+'/jobs/'+OPERATOR_JOB+':run');
 for(let i=0;i<7;i++){
  if(op?.error)throw Error('operator_dispatch_rejected');
  for(const value of [op?.response?.name,op?.metadata?.name,op?.metadata?.execution,op?.metadata?.target]){
   const execution=operatorExecution(value);
   if(execution)return execution;
  }
  const path=operatorLro(op?.name);
  if(!path||op?.done===true||i===6)break;
  await sleep(400);
  op=await call('GET',path);
 }
 throw Error('operator_execution_unresolved');
}
const receiptPath=key=>'control/v1/operator-requests/'+key+'.receipt.json';
const GEN=/^[1-9][0-9]{0,19}$/;
// Recovery is observation, not execution. The receipt is create-only and
// bound to the immutable request before a dispatch mapping can admit the Job.
async function readRecovery(req,paths,{read,call}){
 const receipt=await read(receiptPath(paths.key));
 if(!receipt)return {dispatch_evidence:'NO_RECEIPT',recovery_authorization_required:true};
 const r=receipt.data;
 operatorRequire(GEN.test(receipt.generation||'')&&r?.request_hash===operatorHash(req)&&
  r.operation_id===paths.key&&operatorExecution(r.execution_name)===r.execution_name&&
  typeof r.execution_name==='string'&&/^sha256:[a-f0-9]{64}$/.test(r.image_digest||''),
  'operator_receipt_binding_mismatch');
 const dispatch=await read(operatorDispatchPath(r.execution_name));
 const bound=Boolean(GEN.test(dispatch?.generation||'')&&
  operatorHash(dispatch.data)===operatorHash({...req,execution_name:r.execution_name}));
 operatorRequire(!dispatch||bound,'operator_recovery_dispatch_mismatch');
 const claim=await read('control/v1/operator-claims/'+paths.key+'.json');
 const claimed=Boolean(GEN.test(claim?.generation||'')&&claim.data?.environment==='dev'&&
  claim.data.operation_id===paths.key&&claim.data.approval_hash===req.approval_hash&&
  claim.data.execution_name===r.execution_name);
 operatorRequire(!claim||bound&&claimed,'operator_recovery_claim_mismatch');
 const evidence={execution_name:r.execution_name,dispatch_evidence:claimed?'CLAIM_CONFIRMED':
  bound?'MAPPING_CONFIRMED':'RECEIPT_ONLY',execution_state:'UNVERIFIED',recovery_authorization_required:true};
 try{
  const path=OPERATOR_ROOT+'/jobs/'+OPERATOR_JOB+'/executions/'+r.execution_name;
  const v=await call('GET',path),task=v?.template,c=task?.containers?.[0];
  const source=c?.env?.filter(x=>x.name==='SOURCE_SHA')||[];
  operatorRequire(operatorExecution(v?.name)===r.execution_name&&
   (v.name===path||v.name===path.replace('projects/jscc-dev/','projects/828902654738/'))&&
   task?.serviceAccount===OPERATOR_SA&&task.containers.length===1&&c.image===OPERATOR_IMAGE+r.image_digest&&
   source.length===1&&!source[0].valueSource&&source[0].value===req.operator_source_sha,
   'operator_recovery_execution_mismatch');
  evidence.execution_state=typeof v.completionTime==='string'&&Number.isFinite(Date.parse(v.completionTime))?
   'TERMINAL_WITHOUT_RESULT':'RUNNING_OR_PENDING';
 }catch{
  // IAM or provider state unavailable: never report definitive absence.
  evidence.execution_state='UNVERIFIED';
 }
 return evidence;
}
export async function invokeDevOperator(name,args,actorSub,config,{
 read=defaultRead,create=defaultCreate,call=cloudRun,now=Date.now,
 sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),
 verifyLifecycle=verifyOperatorLifecycle,
}={}){
 operatorRequire(config&&/^[a-f0-9]{40}$/.test(config.sourceSha)&&
  /^sha256:[a-f0-9]{64}$/.test(config.imageDigest||''),'operator_not_configured');
 operatorRequire(name==='operator_start'||name==='operator_status','operator_tool_denied');
 const ref=validateOperatorToolArgs(args),actor=operatorActor(actorSub),paths=operatorPaths(ref);
 const previous=await read(paths.request);
 if(previous){
  // Status/duplicate lookup does not need a fresh approval or launch a Job.
  // The immutable request was written only after approval admission.
  const req=previous.data;
  operatorRequire(req&&req.operation_id===paths.key&&req.approval_ref===ref&&
   req.environment==='dev'&&req.work_item_ref==='#589'&&req.actor_sub_hash===actor&&
   /^[a-f0-9]{64}$/.test(req.approval_hash||''),'operator_request_not_found');
  const result=await read(paths.result);
  const projection=projectOperatorResult(req,result);
  if(name==='operator_status'&&!result){
   // Additional scoped receipt/claim reads and execution observation are
   // admitted separately. Missing permission cannot authorize a retry.
   let recovery;
   try{recovery=await readRecovery(req,paths,{read,call});}
   catch{recovery={dispatch_evidence:'UNVERIFIED',recovery_authorization_required:true};}
   return {...projection,...recovery,duplicate:false};
  }
  return {...projection,duplicate:name==='operator_start'};
 }
 operatorRequire(name==='operator_start','operator_request_not_found');
 const admission=validateOperatorApproval(await read(paths.approval),{
  ref,actor,sourceSha:config.sourceSha,now:now()
 });
 await verifyLifecycle(now());
 await verifyJob(call,config);
 const req=operatorRequest(admission,now());
 validateOperatorRequest(req,admission);
 try{await create(paths.request,req);}
 catch(e){
  if(e?.message==='generation_precondition_failed'){
   const duplicate=await read(paths.request);
   validateOperatorRequest(duplicate?.data,admission);
   return {...projectOperatorResult(duplicate.data,await read(paths.result)),duplicate:true};
  }
  throw e;
 }
 const persisted=await read(paths.request);
 operatorRequire(persisted?.generation&&operatorHash(persisted.data)===operatorHash(req),
  'operator_request_write_uncertain');
 // Any uncertain start or mapping remains reserved. Never automatically run
 // another Job; an independently authorized reconciliation is required.
 try{
  operatorRequire(now()<req.expires_at_ms,'operator_approval_expired');
  const execution=await startExecution(call,sleep);
  const receipt={operation_id:paths.key,request_hash:operatorHash(req),
   execution_name:execution,image_digest:config.imageDigest};
  await create(receiptPath(paths.key),receipt);
  const stored=await read(receiptPath(paths.key));
  operatorRequire(GEN.test(stored?.generation||'')&&operatorHash(stored.data)===operatorHash(receipt),
   'operator_receipt_write_uncertain');
  await create(operatorDispatchPath(execution),{...req,execution_name:execution});
 }catch{
  return {...projectOperatorResult(req,null),duplicate:false};
 }
 return {...projectOperatorResult(req,null),duplicate:false};
}
