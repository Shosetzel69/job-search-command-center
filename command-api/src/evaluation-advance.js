// ATC-535-FP02-R6: server-side, tenant-scoped resumable evaluation.
import { performance } from 'node:perf_hooks';
import { getPool } from './db/pool.js';
import { guardDevProjectionWrite, withTenantTransaction } from './db/tenant-gateway.js';
import { FIT_ALGORITHM_VERSION, evaluateSharedJob } from './profile-evaluation.js';
import { mergeEffectiveConfig } from './multiuser-repository.js';
import { evaluationPreferenceDigest, EVALUATION_SOURCE_SQL, EVALUATION_FIELDS_SQL,
 EVALUATION_JOIN_SQL, EVALUATION_VISIBLE_SQL, EVALUATION_PENDING_SQL } from './evaluation-basis.js';

export const ADVANCE_BATCH_MAX=100;
export const ADVANCE_BUDGET_MS=8000;
const LOCK_NAMESPACE=5910401;
const httpError=(message,status)=>Object.assign(new Error(message),{status});
const knownAlgorithmRank=(alias)=>`CASE ${alias}.fit_algorithm_version WHEN 'fit-v2-independent-2' THEN 2 WHEN 'fit-v1' THEN 1 ELSE 0 END`;

export async function readEvaluationBasisTx(tx,nomenclatures) {
  const result=await tx.query(`SELECT p.search_profile_id,p.profile_version,
    pref.preferences,policy.policy
    FROM search_profile p
    LEFT JOIN search_profile_preferences pref ON pref.tenant_id=p.tenant_id AND pref.search_profile_id=p.search_profile_id
    LEFT JOIN collection_policy policy ON policy.singleton=true
    WHERE p.tenant_id=$1 AND p.status='ACTIVE'`,[tx.tenantId]);
  if(result.rows?.length!==1)throw httpError('Exactly one active Search Profile is required',503);
  const row=result.rows[0];
  const preferences=mergeEffectiveConfig(row.preferences,row.policy);
  return Object.freeze({search_profile_id:String(row.search_profile_id),
    profile_version:Number(row.profile_version),preferences,
    preference_digest:evaluationPreferenceDigest(preferences,nomenclatures)});
}

export function evaluationProjection(row,evaluation) {
  const job=evaluation.job;
  const first=(job.country_codes||[])[0];
  return {
    input_digest:row.input_digest,fit_matrix:job.fit_matrix,
    sort_title:job.title?job.title.normalize('NFKC').toLowerCase():null,
    display_country:first|| (job.remote_scope==='Worldwide'?'WORLDWIDE':null),
    display_work_mode:job.mode==='N/A'?null:job.mode.toLowerCase(),
    display_contract_type:job.contract_type==='unknown'?null:job.contract_type,
    b2b:Boolean(job.b2b),publication_at:job.publication_date||null,
    publication_precision:job.publication_precision||null,retrieve_at:job.retrieve_date||null,
    is_repost:Boolean(job.repost),is_remote:Boolean(job.remote),
  };
}

// Writes are provisional. A conflicting newer record is not an error, and
// all consumers must validate the full input digest against authoritative input.
export async function persistIncrementalEvaluationTx(tx,basis,row,evaluation,now) {
  const p=evaluationProjection(row,evaluation);
  const result=await tx.query(`INSERT INTO profile_job_evaluation AS cur(
    tenant_id,search_profile_id,job_id,eligibility_state,eligibility_reason_code,eligible,
    score,pros,risks,exclusion_reason,profile_version,job_version,fit_algorithm_version,
    evaluation_version,evaluated_at,input_digest,fit_matrix,sort_title,display_country,
    display_work_mode,display_contract_type,b2b,publication_at,publication_precision,
    retrieve_at,is_repost,is_remote)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12,$13,$13,$14,
      $15,$16::jsonb,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)
    ON CONFLICT(tenant_id,search_profile_id,job_id) DO UPDATE SET
      eligibility_state=EXCLUDED.eligibility_state,eligibility_reason_code=EXCLUDED.eligibility_reason_code,
      eligible=EXCLUDED.eligible,score=EXCLUDED.score,pros=EXCLUDED.pros,risks=EXCLUDED.risks,
      exclusion_reason=EXCLUDED.exclusion_reason,profile_version=EXCLUDED.profile_version,
      job_version=EXCLUDED.job_version,fit_algorithm_version=EXCLUDED.fit_algorithm_version,
      evaluation_version=EXCLUDED.evaluation_version,evaluated_at=EXCLUDED.evaluated_at,
      input_digest=EXCLUDED.input_digest,fit_matrix=EXCLUDED.fit_matrix,sort_title=EXCLUDED.sort_title,
      display_country=EXCLUDED.display_country,display_work_mode=EXCLUDED.display_work_mode,
      display_contract_type=EXCLUDED.display_contract_type,b2b=EXCLUDED.b2b,
      publication_at=EXCLUDED.publication_at,publication_precision=EXCLUDED.publication_precision,
      retrieve_at=EXCLUDED.retrieve_at,is_repost=EXCLUDED.is_repost,is_remote=EXCLUDED.is_remote
    WHERE EXCLUDED.profile_version>=cur.profile_version AND EXCLUDED.job_version>=cur.job_version
      AND (${knownAlgorithmRank('EXCLUDED')})>=(${knownAlgorithmRank('cur')})
    RETURNING job_id`,[tx.tenantId,basis.search_profile_id,String(row.job_id),
      evaluation.eligibilityState,evaluation.eligibilityReasonCode||null,evaluation.eligible,
      evaluation.score,JSON.stringify(evaluation.pros||[]),JSON.stringify(evaluation.risks||[]),
      evaluation.exclusionReason||null,basis.profile_version,Number(row.job_version),
      FIT_ALGORITHM_VERSION,now,p.input_digest,JSON.stringify(p.fit_matrix),p.sort_title,
      p.display_country,p.display_work_mode,p.display_contract_type,p.b2b,p.publication_at,
      p.publication_precision,p.retrieve_at,p.is_repost,p.is_remote]);
  return Boolean(result.rows?.length);
}

export async function advanceProfileEvaluation(authContext,nomenclatures,env=process.env,
 {db=getPool(env),clock=()=>performance.now(),now=new Date()}={}) {
  const deadline=clock()+ADVANCE_BUDGET_MS;
  const remaining=()=>Math.floor(deadline-clock());
  try {
    return await withTenantTransaction(authContext,async tx=>{
      // PostgreSQL timeout bounds each SQL statement by the remaining budget.
      // Reserve time for response and transaction completion. Native Nile proof required.
      const budget=async()=>{
        const ms=remaining()-250;
        if(ms<=0)throw httpError('EVALUATION_ADVANCE_DEADLINE',503);
        await tx.query("SELECT set_config('statement_timeout',$1,true)",[String(ms)]);
      };
      await budget();
      await guardDevProjectionWrite(tx,env);
      await budget();
      const basis=await readEvaluationBasisTx(tx,nomenclatures);
      await budget();
      const lock=await tx.query('SELECT pg_try_advisory_xact_lock($1::integer,hashtext($2::text)) AS acquired',
        [LOCK_NAMESPACE,tx.tenantId+':'+basis.search_profile_id]);
      if(lock.rows?.[0]?.acquired!==true)return {status:'BUSY',pending:null,evaluated:0};
      const args=[tx.tenantId,now,basis.search_profile_id,basis.preference_digest,FIT_ALGORITHM_VERSION];
      const from=`${EVALUATION_SOURCE_SQL} ${EVALUATION_JOIN_SQL}
        WHERE ${EVALUATION_VISIBLE_SQL} AND ${EVALUATION_PENDING_SQL}`;
      await budget();
      const batch=await tx.query(`SELECT ${EVALUATION_FIELDS_SQL}
        ${from} ORDER BY j.job_id ASC LIMIT ${ADVANCE_BATCH_MAX}`,args);
      let evaluated=0;
      for(const row of batch.rows||[]){
        // Keep the unprocessed tail resumable; do not emit a score on evaluator failure.
        if(remaining()<1100)break;
        const evaluation=evaluateSharedJob(row,basis.preferences,nomenclatures,now);
        await budget();
        if(await persistIncrementalEvaluationTx(tx,basis,row,evaluation,now))evaluated++;
      }
      await budget();
      const current=await readEvaluationBasisTx(tx,nomenclatures);
      if(current.search_profile_id!==basis.search_profile_id ||
        current.preference_digest!==basis.preference_digest)
        return {status:'INVALIDATED',pending:null,evaluated};
      await budget();
      const result=await tx.query(`SELECT COUNT(*)::integer AS pending ${from}`,args);
      const pending=Number(result.rows?.[0]?.pending);
      if(!Number.isSafeInteger(pending)||pending<0)throw httpError('EVALUATION_PENDING_UNAVAILABLE',503);
      return {status:pending===0?'COMPLETE':'INCOMPLETE',pending,evaluated,
        basis:{profile_version:basis.profile_version,preference_digest:basis.preference_digest,
          fit_algorithm_version:FIT_ALGORITHM_VERSION}};
    },{env,db});
  }catch(error){
    if(error?.code==='57014'||error?.message==='EVALUATION_ADVANCE_DEADLINE')
      return {status:'RETRY',pending:null,evaluated:0};
    throw error;
  }
}
