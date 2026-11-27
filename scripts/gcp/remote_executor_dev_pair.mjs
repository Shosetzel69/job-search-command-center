// #589: operator-side R6 composition; no MCP admission or live CLI entry point.
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';
import {planDevOpsPairDeployment,executeApprovedDevOpsPair}
 from '../../ops/control/dev-ops-pair-deployment.mjs';

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

/** The caller is a trusted operator, not an MCP request handler.
 * The proof providers must independently verify authoritative evidence; raw user
 * booleans are not providers. No default verifier, credentials or live entry point.
 */
export async function runApprovedPair({
  source_sha,gateway_digest,worker_digest,catalog,previous_catalog,
  verifyApproval,verifyImagePair,verifyCost,verifyMaintenanceWindow,
},sessionFactory=openOperatorSession) {
  if([verifyApproval,verifyImagePair,verifyCost,verifyMaintenanceWindow].some(f=>typeof f!=='function'))
    throw new Error('trusted_operator_verifiers_required');
  const session=sessionFactory();
  try{
    const observed=await session.call('capture',{source_sha,gateway_digest,worker_digest,catalog,previous_catalog});
    const plan=planDevOpsPairDeployment({
      environment:'dev',work_item_ref:'#589',source_sha,
      expected_current_gateway_digest:observed.gateway_digest,
      expected_current_worker_digest:observed.worker_digest,
      proposed_gateway_digest:gateway_digest,proposed_worker_digest:worker_digest,
      observed_gateway:{environment:'dev',task:'describe_dev_runtime',resource:GATEWAY,
        effective_revisions:[{revision:observed.revision,percent:100,image_digest:observed.gateway_digest}]},
      observed_worker:{environment:'dev',resource:WORKER,
        effective_image_digest:observed.worker_digest,image_resolution_verified:true},
    });
    if(!plan.change_required)throw new Error('already_at_digest_requires_read_only_acceptance');
    let rollback=false;
    const captured={gateway_image:ROOT+'jscc-ops-gateway@'+observed.gateway_digest,
      worker_image:ROOT+'jscc-diagnostics@'+observed.worker_digest};
    return await executeApprovedDevOpsPair(plan,{
      verifyApproval:async p=>verifyApproval(p,observed),
      verifyImagePair:async p=>verifyImagePair(p,{...observed,catalog,previous_catalog}),
      verifyCost:async p=>verifyCost(p),
      verifyCurrentState:async p=>proof('CURRENT_STATE',p,rollback?
        await session.call('verify_pair',true):captured),
      freezeOps:async p=>{
        const window=await verifyMaintenanceWindow(p,observed);
        if(window?.verified!==true||window.kind!=='MAINTENANCE_WINDOW'||
           window.environment!=='dev'||window.source_sha!==p.source_sha||
           window.work_item_ref!==p.work_item_ref||window.plan_hash!==p.plan_hash||
           window.retrieve_and_deploy_excluded!==true||window.tagged_revision_lease_compatible!==true||
           window.rollback_authorized!==true||window.operator_access_verified!==true)
          throw new Error('maintenance_window_not_verified');
        await session.call('freeze');
      },
      deployWorker:async()=>session.call('deploy_worker'),
      deployGateway:async()=>session.call('deploy_gateway'),
      verifyPair:async p=>proof('DEPLOYED_PAIR',p,await session.call('verify_pair',false)),
      rollbackGateway:async()=>{rollback=true;await session.call('rollback_gateway');},
      rollbackWorker:async()=>{rollback=true;await session.call('rollback_worker');},
      unfreezeOps:async()=>session.call('release'),
    });
  }finally{session.close();}
}
