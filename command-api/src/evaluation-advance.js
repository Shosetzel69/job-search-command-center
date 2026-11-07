import { getPool } from './db/pool.js';
import { withTenantTransaction } from './db/tenant-gateway.js';
import { FIT_ALGORITHM_VERSION, evaluateSharedJob } from './profile-evaluation.js';
import { resolveEvaluationBasisTx, persistEvaluationBatchTx } from './multiuser-repository.js';

const BATCH_SIZE = 100;
const LOCK_NAMESPACE = 5910401;

function httpError(message,status) {
  return Object.assign(new Error(message), {status});
}
function values(value) {
  if(Array.isArray(value)) return value.map(x=>String(x).trim()).filter(Boolean);
  return value == null || value === '' ? [] : [String(value).trim()];
}
function object(value) {
  return value && typeof value==='object' && !Array.isArray(value) ? value : {};
}

/**
 * Stage A: process at most one bounded set of unevaluated candidates.
 * Must be invoked by an authenticated same-origin request. No background
 * operation, provider request, cross-tenant query or client profile authority.
 */
export async function advanceProfileEvaluation(
  authContext,nomenclatures,env=process.env,{db=getPool(env)}={},
) {
  return withTenantTransaction(authContext,async tx=>{
    const {foundation,preferences}=await resolveEvaluationBasisTx(tx);
    const lock=await tx.query(
      'SELECT pg_try_advisory_xact_lock($1::integer, hashtext($2::text)) AS acquired',
      [LOCK_NAMESPACE,tx.tenantId+':'+foundation.search_profile_id],
    );
    if(lock.rows?.[0]?.acquired!==true) throw httpError('IN_PROGRESS',409);

    const args=[tx.tenantId,foundation.search_profile_id,foundation.profile_version,FIT_ALGORITHM_VERSION];
    const where=[
      "(j.lifecycle_status <> 'INACTIVE' OR j.retention_until IS NULL OR j.retention_until > now())",
      "(eval.profile_version IS DISTINCT FROM $3::bigint OR eval.job_version IS DISTINCT FROM j.job_version OR eval.fit_algorithm_version IS DISTINCT FROM $4::text)",
    ];
    const add=value=>{args.push(value);return '$'+args.length;};
    const families=values(preferences.target_role_families).map(x=>x.toUpperCase());
    if(families.length)where.push(`(j.role_family=ANY(${add(families)}::text[]) OR j.role_family='UNKNOWN')`);
    const subfamilies=values(preferences.target_role_subfamilies);
    if(subfamilies.length)where.push(`(j.role_family='UNKNOWN' OR cardinality(j.role_subfamily)=0 OR j.role_subfamily && ${add(subfamilies)}::text[])`);
    const disabled=Object.entries(object(preferences.work_modes))
      .filter(([,enabled])=>enabled===false).map(([mode])=>String(mode).toLowerCase());
    if(disabled.length)where.push(`lower(COALESCE(j.work_mode,'unknown')) <> ALL(${add(disabled)}::text[])`);
    const contracts=values(preferences.contract_types).map(x=>x.toLowerCase());
    if(contracts.length)where.push(`(lower(COALESCE(j.contract_type,'unknown'))=ANY(${add(contracts)}::text[]) OR lower(COALESCE(j.contract_type,'unknown'))='unknown')`);

    const fromSql=`FROM canonical_jobs j
      JOIN LATERAL (
        SELECT source_name,canonical_url,posted_at,repost_of_posting_id,payload
          FROM source_postings
         WHERE job_id=j.job_id
         ORDER BY CASE lifecycle_status WHEN 'ACTIVE' THEN 0 WHEN 'UNCONFIRMED' THEN 1 ELSE 2 END,
                  last_seen_at DESC,posting_id ASC
         LIMIT 1
      ) sp ON true
      LEFT JOIN profile_job_evaluation eval
        ON eval.tenant_id=$1 AND eval.search_profile_id=$2 AND eval.job_id=j.job_id
      WHERE ${where.join(' AND ')}`;
    const countArgs=[...args];
    const batch=await tx.query(
      `SELECT j.job_id,j.title,j.company,j.location,j.country_codes,j.work_mode,
              j.role_family,j.role_subfamily,j.seniority,j.contract_type,
              j.remote_scope,j.job_version,j.payload,j.last_seen_at,
              sp.source_name,sp.canonical_url,sp.posted_at,sp.repost_of_posting_id,
              sp.payload AS posting_payload
         ${fromSql} ORDER BY j.job_id ASC LIMIT ${add(BATCH_SIZE)}::integer`,
      args,
    );

    const entries=[];
    for(const row of batch.rows||[]){
      let evaluation;
      try {
        evaluation=evaluateSharedJob(row,preferences,nomenclatures,new Date());
        if(evaluation.eligibilityState==='UNKNOWN'){
          evaluation={...evaluation,score:null,
            job:evaluation.job?{...evaluation.job,fit:null,status:'review'}:null};
        }
      }catch{
        // Completion is processing coverage; poison rows never receive a fake FIT.
        evaluation={eligible:true,eligibilityState:'UNKNOWN',
          eligibilityReasonCode:'EVALUATION_ERROR',score:null,
          pros:[],risks:[],exclusionReason:'EVALUATION_ERROR',job:null};
      }
      entries.push({row,evaluation});
    }
    const written=await persistEvaluationBatchTx(tx,foundation,entries);
    const pending=await tx.query(`SELECT COUNT(*)::integer AS pending ${fromSql}`,countArgs);
    const remaining=Number(pending.rows?.[0]?.pending||0);
    if(entries.length && written.size===0 && remaining>0){
      throw httpError('STALE_BASIS',409);
    }
    const failed=entries.filter(item=>written.has(String(item.row.job_id))
      && item.evaluation.eligibilityReasonCode==='EVALUATION_ERROR').length;
    return Object.freeze({
      status:remaining===0?'COMPLETE':'INCOMPLETE',
      processed:written.size,remaining,failed,
      completion_semantics:'PROCESSING_COVERAGE',
      basis:{profile_version:foundation.profile_version,
        fit_algorithm_version:FIT_ALGORITHM_VERSION},
    });
  },{env,db});
}
