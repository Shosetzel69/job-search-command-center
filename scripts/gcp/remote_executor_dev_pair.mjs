// #589: operator-side R6 composition; no MCP admission or live CLI entry point.
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';
import {planDevOpsPairDeployment,executeApprovedDevOpsPair}
 from '../../ops/control/dev-ops-pair-deployment.mjs';

import {pinnedPairAdmission,operatorPairStore,readPairOperation,reservePairOperation,
 PairJournal,summarizePairRecord,reconcilePairRecord} from './remote_executor_dev_admission.mjs';

const SCRIPT=fileURLToPath(new URL('./remote_executor_dev_pair.py',import.meta.url));
const GATEWAY='projects/jscc-dev/locations/europe-west1/services/jscc-ops-gateway-dev';
const WORKER='projects/jscc-dev/locations/europe-west1/jobs/jscc-diagnostics-dev';
const ROOT='europe-west1-docker.pkg.dev/jscc-shared/jscc-ops/';

export function openOperatorSession() {
  const child=spawn('python3',[SCRIPT],{stdio:['pipe','pipe','ignore']});
  const lines=createInterface({input:child.stdout,crlfDelay:Infinity});
  let pending=null,closed=false;
  const fail=()=>{
    closed=true;
    if(pending){pending.reject(new Error('operator_session_lost'));pending=null;}
  };
  child.on('error',fail);
  child.on('exit',fail);
  child.stdin.on('error',fail);
  lines.on('close',fail);
  lines.on('line',line=>{
    if(!pending){fail();return;}
    const p=pending;pending=null;
    try{
      const result=JSON.parse(line);
      if(result.ok!==true)throw new Error('operator_step_blocked');
      p.resolve(result.result);
    }catch{p.reject(new Error('operator_step_blocked'));}
  });
  return {
    call(method,...args){
      if(closed||pending)return Promise.reject(new Error('operator_session_unavailable'));
      return new Promise((resolve,reject)=>{
        pending={resolve,reject};
        child.stdin.write(JSON.stringify({method,args})+'\n');
      });
    },
    close(){closed=true;child.stdin.end();lines.close();},
  };
}

function proof(kind,plan,extra={}) {
  return {kind,verified:true,environment:'dev',source_sha:plan.source_sha,
    work_item_ref:plan.work_item_ref,plan_hash:plan.plan_hash,...extra};
}

function derivePlan(target,observed){
  return planDevOpsPairDeployment({
    environment:'dev',work_item_ref:'#589',source_sha:target.source_sha,
    expected_current_gateway_digest:observed.gateway_digest,
    expected_current_worker_digest:observed.worker_digest,
    proposed_gateway_digest:target.gateway_digest,
    proposed_worker_digest:target.worker_digest,
    observed_gateway:{environment:'dev',task:'describe_dev_runtime',resource:GATEWAY,
      effective_revisions:[{revision:observed.revision,percent:100,image_digest:observed.gateway_digest}]},
    observed_worker:{environment:'dev',resource:WORKER,
      effective_image_digest:observed.worker_digest,image_resolution_verified:true},
  });
}

/** Read-only plan for the independent evidence/approval process. */
export async function inspectPairAdmission(target,sessionFactory=openOperatorSession){
  const session=sessionFactory();
  try{
    const previous=await session.call('capture',target);
    return {plan:derivePlan(target,previous),previous,next:target,mutation_authorized:false};
  }finally{session.close();}
}

/** The caller is a trusted operator, not an MCP request handler.
 * Only accept a pin selected independently through the standard GitHub
 * connector. Neither a pin computed from caller input nor an unreviewed
 * evidence bundle confers authority. No public mutation entry point.
 */
export async function runApprovedPair({bundle,trustedEvidenceHash,store=operatorPairStore(),
  now=Date.now},sessionFactory=openOperatorSession){
  const admission=pinnedPairAdmission(bundle,trustedEvidenceHash,now);
  const ref=admission.bundle.evidence.approval;
  const existing=await readPairOperation(store,ref);
  if(existing){
    if(existing.record.evidence_hash!==admission.pin)throw Error('approval_already_consumed');
    return {...summarizePairRecord(existing.record),duplicate:true};
  }
  const target=admission.bundle.next;
  const session=sessionFactory();
  try{
    const observed=await session.call('capture',target);
    const plan=derivePlan(target,observed);
    if(!plan.change_required)throw Error('already_at_digest_requires_read_only_acceptance');
    admission.bind(plan,observed,target);
    const reservation=await reservePairOperation(store,admission,now);
    if(!reservation.created)return {...summarizePairRecord(reservation.record),duplicate:true};
    const journal=new PairJournal(store,reservation,admission,now);
    let rollback=false;
    const captured={gateway_image:ROOT+'jscc-ops-gateway@'+observed.gateway_digest,
      worker_image:ROOT+'jscc-diagnostics@'+observed.worker_digest};
    const step=(name,method,...args)=>journal.step(name,()=>session.call(method,...args));
    let result;
    try{
      result=await executeApprovedDevOpsPair(plan,{
        verifyApproval:admission.verifyApproval,
        verifyImagePair:admission.verifyImagePair,
        verifyCost:admission.verifyCost,
        verifyCurrentState:async p=>{
          if(rollback)return proof('CURRENT_STATE',p,await step('verify_previous','verify_pair',true));
          const window=await admission.verifyMaintenanceWindow(p);
          if(window?.verified!==true||window.kind!=='MAINTENANCE_WINDOW'||
             window.environment!=='dev'||window.source_sha!==p.source_sha||
             window.work_item_ref!==p.work_item_ref||window.plan_hash!==p.plan_hash||
             window.retrieve_and_deploy_excluded!==true||window.tagged_revision_lease_compatible!==true||
             window.rollback_authorized!==true||window.operator_access_verified!==true)
            throw Error('maintenance_window_not_verified');
          return proof('CURRENT_STATE',p,captured);
        },
        freezeOps:async()=>step('freeze','freeze',reservation.identity.maintenance_id),
        deployWorker:async()=>step('deploy_worker','deploy_worker'),
        deployGateway:async()=>step('deploy_gateway','deploy_gateway'),
        verifyPair:async p=>proof('DEPLOYED_PAIR',p,await step('verify_next','verify_pair',false)),
        rollbackGateway:async()=>{rollback=true;await step('rollback_gateway','rollback_gateway');},
        rollbackWorker:async()=>{rollback=true;await step('rollback_worker','rollback_worker');},
        unfreezeOps:async()=>step('release','release'),
      });
    }catch(e){
      if(journal.record.history.length===0&&!journal.poisoned){
        await journal.finish('ADMISSION_BLOCKED');
        throw e;
      }
      return {state:'RECOVERY_REQUIRED',operation_id:reservation.identity.key,
        automatic_retry:false,manual_intervention_required:true};
    }
    try{await journal.finish(result.state);}
    catch{
      return {state:'RECOVERY_REQUIRED',operation_id:reservation.identity.key,
        automatic_retry:false,manual_intervention_required:true};
    }
    return {...result,operation_id:reservation.identity.key,automatic_retry:false};
  }finally{session.close();}
}

/** Restart path: read current state, never re-dispatch a consumed approval. */
export async function observePairRecovery({approvalRef,store=operatorPairStore()},
 sessionFactory=openOperatorSession){
  const existing=await readPairOperation(store,approvalRef);
  if(!existing)throw Error('pair_operation_not_found');
  const session=sessionFactory();
  try{
    const live=await session.call('observe_recovery',existing.identity.maintenance_id);
    return reconcilePairRecord(existing.record,live);
  }finally{session.close();}
}
