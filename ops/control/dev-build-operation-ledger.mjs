// #589 R6 — durable DEV operation record with optimistic GCS generations.
// SOURCE ONLY: not a public MCP mutation. A separately authorized existing
// operator must supply real proof callbacks and a fixed approved dispatcher.
import {createHash} from 'node:crypto';
import {gcsReadJson,gcsWriteJson,gcsReplaceJson} from '../src/lib.mjs';
import {submitApprovedDevOpsBuild,projectDevBuildStatus,validateDevOpsBuildInput} from '../build/dev-cloud-build-controller.mjs';

const HEX64=/^[0-9a-f]{64}$/;
const ID_KEY=/^[a-zA-Z0-9][a-zA-Z0-9_-]{7,99}$/;
const STATUSES=new Set(['RESERVED','VERIFYING','SUBMITTING','SUBMISSION_UNKNOWN',
  'SUBMITTED','WORKING','SUCCEEDED','FAILED','BLOCKED','CANCELLED']);
const FINAL=new Set(['SUCCEEDED','FAILED','BLOCKED','CANCELLED']);
const HASH=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');

export function operationIdentity({actor_sub_hash,idempotency_key,request}) {
  if (typeof actor_sub_hash!=='string' || !HEX64.test(actor_sub_hash) ||
      typeof idempotency_key!=='string' || !ID_KEY.test(idempotency_key))
    throw new Error('invalid_operation_identity');
  const normalized=validateDevOpsBuildInput(request);
  const requestHash=HASH(normalized);
  const key=HASH({actor_sub_hash,idempotency_key,operation:'dev-ops-build'});
  return Object.freeze({
    key,request_hash:requestHash,
    path:'control/v1/builds/'+key+'.json',
    actor_sub_hash,normalized,
  });
}

export function gcsDevOperationStore(bucket,{read=gcsReadJson,create=gcsWriteJson,replace=gcsReplaceJson}={}) {
  if(typeof bucket!=='string' || !/^jscc-dev-[a-z0-9-]{3,80}$/.test(bucket))
    throw new Error('invalid_dev_state_bucket');
  return Object.freeze({
    get:async path=>read(bucket,path),
    create:async(path,data)=>create(bucket,path,data,0),
    replace:async(path,data,generation)=>replace(bucket,path,data,generation),
  });
}

function recordSafe(record) {
  if (!record || typeof record!=='object' || !STATUSES.has(record.state))
    throw new Error('invalid_operation_record');
  return record;
}

export async function reserveDevBuildOperation(identity,store,{now=()=>new Date().toISOString()}={}) {
  if(typeof store?.get!=='function' || typeof store?.create!=='function' ||
     typeof store?.replace!=='function') throw new Error('operation_store_not_configured');
  const rec={
    schema_version:'1.0',environment:'dev',operation_kind:'dev-ops-build',
    operation_id:identity.key,actor_sub_hash:identity.actor_sub_hash,
    work_item_ref:identity.normalized.work_item_ref,
    request_hash:identity.request_hash,source_sha:identity.normalized.source_sha,
    trusted_ref:identity.normalized.trusted_ref,
    state:'RESERVED',build_id:null,approval_ref:null,
    created_at:now(),updated_at:now(),
  };
  try {
    await store.create(identity.path,rec);
    // First creator is the only execution owner.
    const readBack=await store.get(identity.path);
    if(!readBack?.generation) throw new Error('reservation_generation_unknown');
    return {created:true,record:recordSafe(readBack.data),generation:readBack.generation};
  } catch(e) {
    if(e?.message!=='generation_precondition_failed')throw e;
    const already=await store.get(identity.path);
    if (!already?.data || already.data.operation_id!==identity.key ||
        already.data.request_hash!==identity.request_hash ||
        already.data.actor_sub_hash!==identity.actor_sub_hash) throw new Error('idempotency_conflict');
    return {created:false,record:recordSafe(already.data),generation:already.generation};
  }
}

async function advance(identity,store,record,generation,next) {
  const updated={...record,...next,updated_at:new Date().toISOString()};
  await store.replace(identity.path,updated,generation);
  const current=await store.get(identity.path);
  if(!current?.generation || current.data?.state!==next.state ||
     current.data?.request_hash!==identity.request_hash) throw new Error('operation_write_unconfirmed');
  return {record:recordSafe(current.data),generation:current.generation};
}

export async function executeApprovedDevBuildOnce(identity,store,trust) {
  const reservation=await reserveDevBuildOperation(identity,store);
  if(!reservation.created) return {
    duplicate:true,state:reservation.record.state,build_id:reservation.record.build_id,
    operation_id:identity.key,
    // A duplicate never dispatches, even after a crashed/uncertain submission.
    retry_dispatched:false,
  };
  let {record,generation}=reservation;
  ({record,generation}=await advance(identity,store,record,generation,{state:'VERIFYING'}));
  let dispatchEntered=false;
  try {
    const adapter={
      verifyApproval:trust?.verifyApproval,
      verifyTrustedRef:trust?.verifyTrustedRef,
      verifySourceSnapshot:trust?.verifySourceSnapshot,
      verifyCostAdmission:trust?.verifyCostAdmission,
      dispatch:typeof trust?.dispatch==='function' ? async request=>{
        dispatchEntered=true;
        return trust.dispatch(request);
      } : undefined,
    };
    // Explicitly separate trusted callbacks from caller-controlled records.
    const receipt=await submitApprovedDevOpsBuild(identity.normalized,adapter);
    ({record,generation}=await advance(identity,store,record,generation,{
      state:'SUBMITTED',build_id:receipt.build_id,approval_ref:receipt.actor_approval_ref,
    }));
    return {duplicate:false,state:record.state,build_id:receipt.build_id,
      operation_id:identity.key,retry_dispatched:false};
  } catch(e) {
    // A remote submission may have succeeded before transport/receipt failure.
    // Do NOT try a second build. Record an uncertain outcome for reconciliation.
    const state=dispatchEntered?'SUBMISSION_UNKNOWN':'BLOCKED';
    try {
      ({record,generation}=await advance(identity,store,record,generation,{
        state,coarse_error:dispatchEntered?'submission_outcome_unknown':'admission_blocked',
      }));
    } catch {
      // If GCS itself is unavailable, original VERIFYING state also blocks
      // retries. A separate operator must reconcile from Cloud Build audit.
      return {duplicate:false,state:'SUBMISSION_UNKNOWN',
        operation_id:identity.key,retry_dispatched:false};
    }
    return {duplicate:false,state:record.state,operation_id:identity.key,retry_dispatched:false};
  }
}

export async function observeDevBuildOnce(identity,store,{getBuild}={}) {
  if(typeof getBuild!=='function') throw new Error('build_observer_not_configured');
  const current=await store.get(identity.path);
  if(!current?.data || current.data.request_hash!==identity.request_hash ||
     current.data.actor_sub_hash!==identity.actor_sub_hash)throw new Error('operation_not_found');
  const {record,generation}={record:recordSafe(current.data),generation:current.generation};
  if(FINAL.has(record.state))return {operation_id:identity.key,state:record.state,unchanged:true};
  if(record.state!=='SUBMITTED' && record.state!=='WORKING')
    throw new Error('submission_not_reconciled');
  const raw=await getBuild({project:'jscc-shared',region:'europe-west1',build_id:record.build_id});
  const status=projectDevBuildStatus(raw,{
    project:'jscc-shared',region:'europe-west1',build_id:record.build_id,
    source_sha:record.source_sha,
  });
  const state=status.status==='SUCCESS'?'SUCCEEDED'
    :status.status==='CANCELLED'?'CANCELLED'
    :status.terminal?'FAILED':'WORKING';
  const next=await advance(identity,store,record,generation,{
    state,build_status:status.status,immutable_image_count:status.immutable_image_count,
  });
  return {operation_id:identity.key,state:next.record.state,
    build_id:record.build_id,build_status:status.status,
    immutable_image_count:status.immutable_image_count,
    // Always unverified until independent source/archive attestation.
    source_provenance:'UNVERIFIED'};
}
