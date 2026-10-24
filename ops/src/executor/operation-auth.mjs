// Server-side policy adapter for the pre-existing authenticated JSCC gateway.
// No request body can supply actor identity, approval state, credentials or bucket.
import {createHash, timingSafeEqual} from 'node:crypto';
import {submitDevOperation} from './cloud-run-dispatch.mjs';
const sha=v=>createHash('sha256').update(String(v)).digest('hex');
const ACT=new Set(['verify','implement','publish','merge','deploy']);
const eq=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const ident=v=>typeof v==='string'&&/^ATC-[1-9][0-9]{0,7}-[0-9]{2}$/.test(v);

// Authorization records must be created independently by a trusted approver.
// GCS create-only writes and version-pinned reads are required for this store.
export function createExecutorHandler({authenticate, readBody, sendJson, gcsReadJson, gcsWriteJson, bucket, githubToken, signingKey, admissionKey, fetchImpl=fetch}) {
  if ([authenticate,readBody,sendJson,gcsReadJson,gcsWriteJson].some(x=>typeof x!=='function'))throw Error('executor_gateway_dependencies_missing');
  async function authorizeAction({actor,action,manifest}) {
    if(!ACT.has(action)||!actor?.sub||!ident(manifest?.atc_id))return false;
    const key=sha(JSON.stringify({actor_hash:sha(actor.sub),action,atc_id:manifest.atc_id,
      work_item_ref:manifest.work_item_ref,repository:manifest.repository,
      base_sha:manifest.base_sha,branch:manifest.branch,
      patch_sha256:manifest.patch_sha256??null,pr_number:manifest.pr_number??null,
      expected_head_sha:manifest.expected_head_sha??null,deploy_sha:manifest.deploy_sha??null}));
    const record=await gcsReadJson(bucket,`executor-authorizations/${key}.json`);
    const a=record?.data;
    return a?.status==='APPROVED' && eq(a.request_sha256,key) && eq(a.actor_hash,sha(actor.sub)) &&
      a.action===action && Number.isSafeInteger(a.expires_at_ms)&&a.expires_at_ms>Date.now() &&
      a.expires_at_ms<=Date.now()+3600000;
  }
  async function reserveOperation({key,digest,actor}) {
    try {
      await gcsWriteJson(bucket,`executor-reservations/${key}.json`,{request_sha256:digest,actor_hash:sha(actor),created_at:new Date().toISOString()},0);
      return {created:true};
    } catch(e) {
      if(e.message==='generation_precondition_failed')return {created:false};
      throw e;
    }
  }
  async function recordOperation(record) {
    // Append-only event; not a last-writer-wins overwrite of an operation record.
    // Collisions fail closed. Avoid storing raw actor credentials or manifest contents.
    const operationId=record.operationId||record.key;
    await gcsWriteJson(bucket,`executor-operations/${operationId}.json`,record,0);
  }
  return async function handleExecutor(req,res) {
    try {
      const auth=await authenticate(req);
      if(auth?.ok!==true||typeof auth?.record?.actor_sub!=='string')return sendJson(res,401,{error:'executor_unauthenticated'});
      const body=await readBody(req);
      if(!body||typeof body!=='object'||Array.isArray(body))return sendJson(res,400,{error:'invalid_request'});
      const result=await submitDevOperation(body,{actor:{sub:auth.record.actor_sub},authorizeAction,githubToken,signingKey,admissionKey,fetchImpl,bucket,reserveOperation,recordOperation});
      return sendJson(res,202,result);
    } catch(e) {return sendJson(res,403,{error:'executor_admission_denied'});}
  };
}
