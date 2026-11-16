// ATC-535-FP02-R6: page, completeness and exact totals from one statement.
import { createHash } from 'node:crypto';
import { getPool } from './db/pool.js';
import { withTenantTransaction } from './db/tenant-gateway.js';
import { FIT_ALGORITHM_VERSION,materializeCachedJob } from './profile-evaluation.js';
import { readEvaluationBasisTx } from './evaluation-advance.js';
import { normalizeJobSearchQuery } from './multiuser-repository.js';
import { EVALUATION_SOURCE_SQL,EVALUATION_FIELDS_SQL,EVALUATION_JOIN_SQL,
 EVALUATION_VISIBLE_SQL,EVALUATION_PENDING_SQL } from './evaluation-basis.js';

const SORTS=Object.freeze({fit:['score','numeric'],title:['sort_title','text'],
 country:['display_country','text'],work_mode:['display_work_mode','text'],
 publication:['publication_at','timestamptz'],retrieve:['retrieve_at','timestamptz']});
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const error=(message,status=400)=>Object.assign(new Error(message),{status});
const HEX=/^[0-9a-f]{64}$/;
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const stale=()=>error('STALE_CURSOR: restart pagination');

export function normalizeGlobalQuery(input={}) {
  const spec=normalizeJobSearchQuery({...input,cursor:null,count_only:false});
  const sort=String(input.sort||'publication'),dir=String(input.dir||'desc');
  if(!Object.hasOwn(SORTS,sort)||!['asc','desc'].includes(dir))throw error('Invalid global sort');
  if(![20,30,40].includes(spec.limit))throw error('Invalid page size');
  const scope={...spec};delete scope.cursor;delete scope.limit;delete scope.prefetch;delete scope.as_of;
  for(const k of ['role_family','role_subfamily','work_mode','contract_type'])scope[k]=[...new Set(scope[k])].sort();
  return {...spec,sort,dir,filter_hash:hash(scope),cursor:decodeGlobalCursor(input.cursor)};
}
export function decodeGlobalCursor(raw) {
  if(!raw)return null;
  try{
    if(String(raw).length>4096)throw stale();
    const c=JSON.parse(Buffer.from(String(raw),'base64url').toString('utf8'));
    if(c.v!==3||!Object.hasOwn(SORTS,c.sort)||!['asc','desc'].includes(c.dir)||
      !UUID.test(c.job_id)||!HEX.test(c.filter_hash)||!HEX.test(c.profile_eval_digest)||
      !HEX.test(c.watermark)||!['GLOBAL','PROVISIONAL'].includes(c.order_status)||
      !Number.isFinite(Date.parse(c.as_of))||typeof c.null_flag!=='boolean'||
      (c.null_flag?c.value!==null:typeof c.value!=='string'||c.value.length>1024))throw stale();
    const type=c.order_status==='PROVISIONAL'?'timestamptz':SORTS[c.sort][1];
    if(!c.null_flag&&type==='numeric'&&(!/^[0-9]+(?:\.[0-9]+)?$/.test(c.value)||Number(c.value)>100))throw stale();
    if(!c.null_flag&&type==='timestamptz'&&!Number.isFinite(Date.parse(c.value)))throw stale();
    return c;
  }catch{throw stale();}
}
export function encodeGlobalCursor(c){return Buffer.from(JSON.stringify({v:3,...c})).toString('base64url');}

export function buildGlobalListingQuery(tenant,basis,spec,anchor){
  const p=[tenant,anchor,basis.search_profile_id,basis.preference_digest,FIT_ALGORITHM_VERSION,
    basis.profile_version,JSON.stringify(basis.personal),JSON.stringify(basis.policy)];
  const add=v=>{p.push(v);return '$'+p.length;};
  const threshold=add(Number(basis.preferences.fit_threshold??80));
  const structural=[];
  if(!spec.include_archived)structural.push('archived_at IS NULL');
  if(spec.empty_modes)structural.push('false');
  if(spec.role_family.length)structural.push('role_family=ANY('+add(spec.role_family)+'::text[])');
  if(spec.role_subfamily.length)structural.push('role_subfamily && '+add(spec.role_subfamily)+'::text[]');
  if(spec.work_mode.length)structural.push("COALESCE(display_work_mode,'unknown')=ANY("+add(spec.work_mode)+"::text[])");
  if(spec.contract_type.length)structural.push("COALESCE(display_contract_type,'unknown')=ANY("+add(spec.contract_type)+"::text[])");
  if(spec.q)structural.push("concat_ws(' ',title,company,location) ILIKE "+add('%'+spec.q+'%'));
  if(spec.freshness_hours!=null)structural.push('publication_at >= $2 - ('+add(spec.freshness_hours)+"::integer * interval '1 hour')");
  if(spec.min_fit!=null)structural.push('score >= '+add(spec.min_fit)+'::numeric');
  if(spec.result_view==='unclassified')structural.push("eligibility_state='UNKNOWN' AND eligibility_reason_code='ROLE_FAMILY_UNKNOWN'");
  if(spec.result_view==='review')structural.push('(score IS NULL OR score < '+threshold+'::numeric)');
  const matches=[...structural];
  if(spec.quick==='high'||spec.kpi==='high')matches.push('score >= '+threshold+'::numeric');
  if(spec.quick==='b2b')matches.push('b2b IS TRUE');
  if(spec.kpi==='remote')matches.push('is_remote IS TRUE');
  if(spec.kpi==='repost')matches.push('is_repost IS TRUE');
  const new24="publication_at > $2 - interval '25 hours' AND publication_at <= $2";
  if(spec.kpi==='new')matches.push(new24);
  const [column,type]=SORTS[spec.sort];
  // Text wire format avoids lossy JSON numeric conversions and gives one
  // deterministic value to the cursor; comparisons cast to the allowed type.
  const orderValue=spec.sort==='publication'?'publication_at':column;
  const direction=spec.dir.toUpperCase();
  const sortExpr=spec.sort==='publication'?'publication_at':orderValue;
  const typedValue=add(spec.cursor?.value??null);
  const cursorId=add(spec.cursor?.job_id??null);
  const cursorNull=add(spec.cursor?.null_flag??false);
  const cursorStatus=add(spec.cursor?.order_status??null);
  const cursorWatermark=add(spec.cursor?.watermark??null);
  const limit=add(spec.limit+1);
  const op=spec.dir==='asc'?'>':'<';
  const keyset=(expression,cast,compare)=>`(${cursorId}::uuid IS NULL OR
   (NOT ${cursorNull}::boolean AND (${expression} IS NULL OR ${expression} ${compare} ${typedValue}::${cast}
    OR (${expression}=${typedValue}::${cast} AND job_id>${cursorId}::uuid)))
   OR (${cursorNull}::boolean AND ${expression} IS NULL AND job_id>${cursorId}::uuid))`;
  return {params:p,sql:`WITH basis_guard AS (
   SELECT p.search_profile_id FROM search_profile p
    LEFT JOIN search_profile_preferences pref ON pref.tenant_id=p.tenant_id AND pref.search_profile_id=p.search_profile_id
    LEFT JOIN collection_policy policy ON policy.singleton=true
   WHERE p.tenant_id=$1 AND p.search_profile_id=$3 AND p.status='ACTIVE'
    AND p.profile_version=$6 AND COALESCE(pref.preferences,'{}'::jsonb)=$7::jsonb
    AND COALESCE(policy.policy,'{}'::jsonb)=$8::jsonb
  ), population AS (
   SELECT ${EVALUATION_FIELDS_SQL}, state.archived_at,
    eval.score,eval.eligibility_state,eval.eligibility_reason_code,eval.eligible,
    eval.pros,eval.risks,eval.exclusion_reason,eval.fit_matrix,eval.sort_title,
    eval.display_country,eval.display_work_mode,eval.display_contract_type,
    eval.b2b,eval.publication_at,eval.publication_precision,eval.retrieve_at,
    eval.is_repost,eval.is_remote,eval.evaluated_at,
    NOT ${EVALUATION_PENDING_SQL} AND eval.fit_matrix IS NOT NULL AS current_evaluation
   ${EVALUATION_SOURCE_SQL} ${EVALUATION_JOIN_SQL}
   LEFT JOIN profile_job_state state ON state.tenant_id=$1 AND state.job_id=j.job_id
   WHERE ${EVALUATION_VISIBLE_SQL} AND EXISTS(SELECT 1 FROM basis_guard)
  ), summary AS (
   SELECT COUNT(*) FILTER(WHERE NOT current_evaluation)::integer AS pending,
    encode(sha256(convert_to(COALESCE(string_agg(
      jsonb_build_array(job_id,input_digest,current_evaluation,archived_at,score,
        sort_title,display_country,display_work_mode,display_contract_type,
        publication_at,retrieve_at,eligibility_state,eligibility_reason_code,b2b,is_remote,is_repost)::text,
      E'\\n' ORDER BY job_id),''),'UTF8')),'hex') AS watermark
   FROM population
  ), matched AS (
   SELECT * FROM population WHERE current_evaluation AND ${matches.length?matches.join(' AND '):'true'}
  ), totals AS (
   SELECT count(*)::integer AS all_count,
    count(*) FILTER(WHERE score>=${threshold}::numeric)::integer AS high,
    count(*) FILTER(WHERE b2b)::integer AS b2b,
    count(*) FILTER(WHERE is_remote)::integer AS remote,
    count(*) FILTER(WHERE is_repost)::integer AS repost,
    count(*) FILTER(WHERE ${new24})::integer AS new24h FROM matched
  ), page AS (
   SELECT matched.*,CASE WHEN summary.pending=0 THEN ${sortExpr}::text ELSE publication_at::text END AS cursor_value
   FROM matched CROSS JOIN summary
   WHERE (${cursorWatermark}::text IS NULL OR summary.watermark=${cursorWatermark}::text)
    AND ((summary.pending=0 AND (${cursorStatus}::text IS NULL OR ${cursorStatus}::text='GLOBAL')
      AND ${keyset(sortExpr,type,op)})
     OR (summary.pending>0 AND (${cursorStatus}::text IS NULL OR ${cursorStatus}::text='PROVISIONAL')
      AND ${keyset('publication_at','timestamptz','<')}))
   ORDER BY CASE WHEN summary.pending=0 THEN ${sortExpr} END ${direction} NULLS LAST,
    CASE WHEN summary.pending>0 THEN publication_at END DESC NULLS LAST,job_id ASC
   LIMIT ${limit}::integer
  )
  SELECT EXISTS(SELECT 1 FROM basis_guard) AS basis_ok,summary.pending,summary.watermark,
   to_jsonb(totals) AS totals,COALESCE((SELECT jsonb_agg(to_jsonb(page) ORDER BY
    CASE WHEN summary.pending=0 THEN page.${sortExpr} END ${direction} NULLS LAST,
    CASE WHEN summary.pending>0 THEN page.publication_at END DESC NULLS LAST,page.job_id ASC) FROM page),'[]'::jsonb) AS page
  FROM summary CROSS JOIN totals`};
}

export async function listGlobalProfileJobs(authContext,nomenclatures,query,env=process.env,
 {db=getPool(env),now=new Date()}={}){
  const spec=normalizeGlobalQuery(query);
  const anchor=spec.cursor?new Date(spec.cursor.as_of):new Date(now);
  if(anchor>new Date(now))throw stale();
  return withTenantTransaction(authContext,async tx=>{
    const basis=await readEvaluationBasisTx(tx,nomenclatures);
    if(spec.cursor&&(spec.cursor.sort!==spec.sort||spec.cursor.dir!==spec.dir||
      spec.cursor.filter_hash!==spec.filter_hash||spec.cursor.profile_eval_digest!==basis.preference_digest))throw stale();
    const q=buildGlobalListingQuery(tx.tenantId,basis,spec,anchor);
    const snapshot=(await tx.query(q.sql,q.params)).rows?.[0];
    if(!snapshot?.basis_ok)throw stale();
    const pending=Number(snapshot.pending);
    if(!Number.isSafeInteger(pending)||pending<0||!HEX.test(snapshot.watermark)||!Array.isArray(snapshot.page))throw error('Global listing unavailable',503);
    const status=pending===0?'GLOBAL':'PROVISIONAL';
    if(spec.cursor&&(spec.cursor.watermark!==snapshot.watermark||spec.cursor.order_status!==status))throw stale();
    const rows=snapshot.page.slice(0,spec.limit);
    const jobs=rows.map(row=>materializeCachedJob(row,{
      eligible:row.eligible,eligibilityState:row.eligibility_state,eligibilityReasonCode:row.eligibility_reason_code,
      score:row.score,fitMatrix:row.fit_matrix,pros:row.pros,risks:row.risks,exclusionReason:row.exclusion_reason,
    },basis.preferences,anchor));
    const last=rows.at(-1);
    const next_cursor=snapshot.page.length>spec.limit&&last?encodeGlobalCursor({
      sort:spec.sort,dir:spec.dir,value:last.cursor_value??null,null_flag:last.cursor_value==null,
      job_id:String(last.job_id),filter_hash:spec.filter_hash,profile_eval_digest:basis.preference_digest,
      watermark:snapshot.watermark,order_status:status,as_of:anchor.toISOString(),
    }):null;
    const t=snapshot.totals||{};
    return {schema_version:'3.0',bounded:true,generated_at:anchor.toISOString(),search_profile_id:basis.search_profile_id,
      profile_version:basis.profile_version,fit_algorithm_version:FIT_ALGORITHM_VERSION,limit:spec.limit,
      order_status:status,count_status:pending===0?'EXACT':'INCOMPLETE',pending,next_cursor,
      totals:pending===0?{all:Number(t.all_count),high:Number(t.high),b2b:Number(t.b2b),
        remote:Number(t.remote),repost:Number(t.repost),new24h:Number(t.new24h)}:null,
      results:jobs.length,jobs};
  },{env,db});
}
