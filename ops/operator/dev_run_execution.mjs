// #589: observe immutable DEV execution; only diagnostics cancellation is admitted.
// Product/migration cancellation remains on its dedicated release/recovery path.
import {gcpFetch} from '../src/lib.mjs';
import {devRunExecutionTarget,operatorRequire,operatorExact,operatorLro} from '../src/dev_operator_contract.mjs';
const ROOT='https://run.googleapis.com/v2/';
const SHA=/^[a-f0-9]{40}$/;
const UID=/^[a-f0-9-]{8,64}$/;
const IMAGE=/^europe-west1-docker\.pkg\.dev\/jscc-shared\/(?:jscc|jscc-ops)\/[a-z0-9._-]+@sha256:[a-f0-9]{64}$/;
const match=(re,v)=>typeof v==='string'&&re.test(v);
function samePath(actual,expected){
 return actual===expected||actual===expected.replace('projects/jscc-dev/','projects/828902654738/');
}
async function call(fetchImpl,path,body){
 const r=await fetchImpl(ROOT+path,{method:body===undefined?'GET':'POST',
  redirect:'error',signal:AbortSignal.timeout(10000),
  ...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
 operatorRequire(r.ok,'run_execution_http_error');
 const raw=await r.text();
 operatorRequire(Buffer.byteLength(raw)<=131072,'run_execution_response_limit');
 return JSON.parse(raw);
}
function observe(value,input,path){
 const container=value.template?.containers?.[0],env=container?.env?.filter(x=>x.name==='SOURCE_SHA')||[];
 operatorRequire(samePath(value.name,path)&&
  (value.job===input.job||samePath(value.job,path.split('/executions/')[0]))&&
  value.uid===input.expected_uid&&value.template?.containers?.length===1&&
  container.image===input.expected_image&&env.length===1&&!env[0].valueSource&&env[0].value===input.expected_source_sha&&
  Number.isSafeInteger(value.taskCount)&&value.taskCount>=1&&value.taskCount<=1000,
  'run_execution_binding_mismatch');
 const terminal=typeof value.completionTime==='string'&&Number.isFinite(Date.parse(value.completionTime));
 const completed=Array.isArray(value.conditions)?value.conditions.filter(x=>x.type==='Completed'):[];
 const status=!terminal?'RUNNING_OR_PENDING':completed.length===1&&completed[0].state==='CONDITION_SUCCEEDED'?
  'SUCCEEDED':completed.length===1&&completed[0].state==='CONDITION_FAILED'?'FAILED_OR_CANCELLED':'TERMINAL_UNVERIFIED';
 return {job:input.job,execution:input.execution,uid:input.expected_uid,source_sha:input.expected_source_sha,
  image:input.expected_image,task_count:value.taskCount,status,terminal,cancellation_requested:false};
}
export async function executeDevRunExecution(input,{cancel=false,assertFresh,fetchImpl=gcpFetch}={}){
 operatorRequire(operatorExact(input,['environment','job','execution','expected_uid','expected_image','expected_source_sha'])&&
  input.environment==='dev'&&match(UID,input.expected_uid)&&match(SHA,input.expected_source_sha)&&
  match(IMAGE,input.expected_image),'run_execution_input_denied');
 if(cancel)operatorRequire(input.job==='jscc-diagnostics-dev'&&typeof assertFresh==='function',
  'run_execution_cancel_denied');
 const path=devRunExecutionTarget(input.job,input.execution);
 const raw=await call(fetchImpl,path);
 let result=observe(raw,input,path);
 if(cancel&&!result.terminal){
  operatorRequire(typeof raw.etag==='string'&&raw.etag.length>0&&raw.etag.length<=1024,
   'run_execution_etag_missing');
  assertFresh();
  const op=await call(fetchImpl,path+':cancel',{etag:raw.etag});
  operatorRequire(operatorLro(op.name)&&!op.error,'run_execution_cancel_receipt_unverified');
  // A successful cancel receipt is not a terminal outcome. Read the exact
  // immutable execution again. No retries, deletion or lock manipulation.
  result=observe(await call(fetchImpl,path),input,path);
  result.cancellation_requested=true;
 }
 return {state:'OBSERVED',execution_observation:result};
}
