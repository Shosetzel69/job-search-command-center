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
const ACTIONS=new Set(['build','deploy_ops_pair','observe_build','observe_pair','gcloud_inventory']);
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
 }else if(v.action==='observe_build'||v.action==='observe_pair'){
  operatorRequire(operatorExact(v.bundle,['original_approval_ref'])&&
   match(REF,v.bundle.original_approval_ref)&&v.bundle.original_approval_ref!==ref,
   'operator_observation_approval_mismatch');
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
 for(const k of ['protected_match','recovery_authorization_required','duplicate'])if(typeof v[k]==='boolean')out[k]=v[k];
 return out;
}
