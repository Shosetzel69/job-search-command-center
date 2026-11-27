// #589: Gateway requests only an independently admitted fixed DEV Job.
// No user-provided scripts, credentials, build configuration or job overrides.
import {gcpFetch,gcsReadJson,gcsWriteJson} from './lib.mjs';
import {OPERATOR_BUCKET,OPERATOR_ROOT,OPERATOR_JOB,operatorActor,operatorPaths,
 operatorExecution,operatorLro,operatorDispatchPath,operatorHash,operatorRequest,
 operatorRequire,validateOperatorToolArgs,validateOperatorApproval,validateOperatorRequest,
 projectOperatorResult} from './dev_operator_contract.mjs';

const RUN='https://run.googleapis.com/v2/';
export const operatorTools=Object.freeze([
 {name:'operator_start',description:'Start one independently approved DEV operator action by GitHub approval reference; no arbitrary scripts or parameters.',
  inputSchema:{type:'object',required:['approval_ref'],properties:{approval_ref:{type:'string',pattern:'^#589/[1-9][0-9]{0,19}$'}},additionalProperties:false}},
 {name:'operator_status',description:'Read sanitized state of an already requested DEV operator action; never retries.',
  inputSchema:{type:'object',required:['approval_ref'],properties:{approval_ref:{type:'string',pattern:'^#589/[1-9][0-9]{0,19}$'}},additionalProperties:false}},
]);
export function operatorGatewayConfig(env=process.env){
 if(env.JSCC_DEV_OPERATOR_ENABLED!=='true')return null;
 operatorRequire(env.GCP_PROJECT==='jscc-dev'&&env.GCP_REGION==='europe-west1'&&
  env.OPS_BUCKET===OPERATOR_BUCKET&&/^[a-f0-9]{40}$/.test(env.JSCC_DEV_OPERATOR_SOURCE_SHA||''),
  'operator_config_invalid');
 return Object.freeze({sourceSha:env.JSCC_DEV_OPERATOR_SOURCE_SHA});
}
const defaultRead=path=>gcsReadJson(OPERATOR_BUCKET,path);
const defaultCreate=(path,data)=>gcsWriteJson(OPERATOR_BUCKET,path,data,0);
async function cloudRun(method,path){
 const response=await gcpFetch(RUN+path,{method,redirect:'error',signal:AbortSignal.timeout(5000),
  ...(method==='POST'?{headers:{'content-type':'application/json'},body:'{}'}:{})});
 operatorRequire(response.ok,'operator_dispatch_http_error');
 return response.json();
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
export async function invokeDevOperator(name,args,actorSub,config,{
 read=defaultRead,create=defaultCreate,call=cloudRun,now=Date.now,
 sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),
}={}){
 operatorRequire(config&&/^[a-f0-9]{40}$/.test(config.sourceSha),'operator_not_configured');
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
  return {...projectOperatorResult(req,await read(paths.result)),duplicate:name==='operator_start'};
 }
 operatorRequire(name==='operator_start','operator_request_not_found');
 const admission=validateOperatorApproval(await read(paths.approval),{
  ref,actor,sourceSha:config.sourceSha,now:now()
 });
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
  await create(operatorDispatchPath(execution),{...req,execution_name:execution});
 }catch{
  return {...projectOperatorResult(req,null),duplicate:false};
 }
 return {...projectOperatorResult(req,null),duplicate:false};
}
