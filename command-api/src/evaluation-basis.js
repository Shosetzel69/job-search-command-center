// ATC-535-FP02-R6: shared current-input basis for incremental and listing queries.
import { createHash } from 'node:crypto';
import { FIT_ALGORITHM_VERSION } from './profile-evaluation.js';

// Current evaluator and eligibility dependencies. Listing-only controls are excluded.
const EVALUATION_KEYS = Object.freeze([
  'fit_config','target_role_families','target_role_subfamilies',
  'target_regions','target_country_codes','excluded_regions','excluded_country_codes',
  'remote_eligible_country_codes','keep_reposts','excluded_role_keywords','deep_erp_terms',
  'work_modes','contract_types','excluded_company_patterns','exclusions',
  'rate_min_eur_day','rate_max_eur_day','immediate_start','work_mode_priority',
]);
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
  return value;
}
export function evaluationPreferenceDigest(preferences,nomenclatures) {
  const inputs=Object.fromEntries(EVALUATION_KEYS.map(key=>[key,preferences?.[key]??null]));
  return createHash('sha256').update(JSON.stringify(canonical([
    FIT_ALGORITHM_VERSION,inputs,nomenclatures??null,
  ]))).digest('hex');
}

// $1 tenant, $2 fixed time anchor, $3 profile, $4 preference/nomenclature digest.
// Whole canonical and preferred-posting payloads intentionally included: changes
// not represented by job_version cannot make an old evaluation appear current.
// SQL hash is computed from the very same row that is passed to the evaluator.
export const INPUT_DIGEST_SQL = `encode(sha256(convert_to(jsonb_build_array(
  $4::text,j.job_id,j.job_version,j.title,j.company,j.location,j.country_codes,
  j.work_mode,j.role_family,j.role_subfamily,j.seniority,j.contract_type,j.remote_scope,
  j.classification_status,j.classification_confidence,j.classification_version,
  j.lifecycle_status,j.payload,sp.posting_id,sp.source_name,sp.canonical_url,
  sp.payload,sp.posted_at,sp.last_seen_at,sp.repost_of_posting_id,
  publication.effective_posted_at
)::text,'UTF8')),'hex')`;

export const EVALUATION_SOURCE_SQL = `FROM canonical_jobs j
         JOIN LATERAL (
           SELECT posting_id, source_name, canonical_url, posted_at, last_seen_at, repost_of_posting_id, payload
             FROM source_postings
            WHERE job_id = j.job_id
            ORDER BY CASE lifecycle_status WHEN 'ACTIVE' THEN 0 WHEN 'UNCONFIRMED' THEN 1 ELSE 2 END,
                     last_seen_at DESC, posting_id ASC
            LIMIT 1
         ) sp ON true
         LEFT JOIN LATERAL (
           SELECT COALESCE(
             CASE WHEN date_trunc('milliseconds', sp.posted_at) <= $2
               THEN date_trunc('milliseconds', sp.posted_at) ELSE NULL END,
             (
               SELECT date_trunc('milliseconds', valid.posted_utc)
               FROM (
                 SELECT candidate.ord, CASE
                   WHEN parts.m IS NOT NULL
                    AND (parts.m)[1]::int BETWEEN 1 AND 9999
                    AND (parts.m)[2]::int BETWEEN 1 AND 12
                    AND (parts.m)[3]::int BETWEEN 1 AND
                      CASE (parts.m)[2]::int
                        WHEN 2 THEN CASE WHEN (parts.m)[1]::int % 400 = 0 OR
                          ((parts.m)[1]::int % 4 = 0 AND (parts.m)[1]::int % 100 <> 0)
                          THEN 29 ELSE 28 END
                        WHEN 4 THEN 30 WHEN 6 THEN 30 WHEN 9 THEN 30 WHEN 11 THEN 30
                        ELSE 31 END
                    AND COALESCE((parts.m)[5]::int, 0) BETWEEN 0 AND 23
                    AND COALESCE((parts.m)[6]::int, 0) BETWEEN 0 AND 59
                    AND COALESCE((parts.m)[8]::int, 0) BETWEEN 0 AND 59
                    AND COALESCE((parts.m)[13]::int, 0) BETWEEN 0 AND 23
                    AND COALESCE((parts.m)[14]::int, 0) BETWEEN 0 AND 59
                   THEN make_timestamptz(
                     (parts.m)[1]::int, (parts.m)[2]::int, (parts.m)[3]::int,
                     COALESCE((parts.m)[5]::int, 0),
                     COALESCE((parts.m)[6]::int, 0),
                     COALESCE((parts.m)[8]::int, 0)
                       + COALESCE(('0.' || (parts.m)[10])::double precision, 0),
                     'UTC'
                   ) - (CASE WHEN (parts.m)[12] = '-' THEN -1 ELSE 1 END)
                     * (COALESCE((parts.m)[13]::int, 0) * 60
                       + COALESCE((parts.m)[14]::int, 0)) * interval '1 minute'
                   ELSE NULL END AS posted_utc
                 FROM (VALUES
                   (1, sp.payload ->> 'date_posted', jsonb_typeof(sp.payload -> 'date_posted')),
                   (2, sp.payload ->> 'posted_at', jsonb_typeof(sp.payload -> 'posted_at')),
                   (3, j.payload ->> 'date_posted', jsonb_typeof(j.payload -> 'date_posted')),
                   (4, j.payload ->> 'posted_at', jsonb_typeof(j.payload -> 'posted_at'))
                 ) AS candidate(ord, raw_date, raw_type)
                 CROSS JOIN LATERAL (
                   SELECT CASE WHEN candidate.raw_type = 'string' THEN
                     regexp_match(candidate.raw_date,
                       '^([0-9]{4})-([0-9]{2})-([0-9]{2})(T([0-9]{2}):([0-9]{2})(:([0-9]{2})([.]([0-9]{1,6}))?)?(Z|([+-])([0-9]{2}):([0-9]{2})))?$')
                     ELSE NULL END AS m
                 ) parts
               ) valid
               WHERE valid.posted_utc IS NOT NULL
                 AND date_trunc('milliseconds', valid.posted_utc) <= $2
                 AND EXTRACT(YEAR FROM valid.posted_utc) BETWEEN 1 AND 9999
               ORDER BY valid.ord
               LIMIT 1
             )
           ) AS effective_posted_at
         ) publication ON true`;
export const EVALUATION_FIELDS_SQL = `j.job_id,j.title,j.company,j.location,j.country_codes,j.work_mode,
 j.role_family,j.role_subfamily,j.seniority,j.contract_type,j.remote_scope,j.job_version,
 j.classification_status,j.classification_confidence,j.classification_version,
 j.lifecycle_status,j.payload,j.last_seen_at,sp.posting_id,sp.source_name,sp.canonical_url,
 sp.posted_at,sp.last_seen_at AS posting_last_seen_at,sp.repost_of_posting_id,
 sp.payload AS posting_payload,publication.effective_posted_at,
 ${INPUT_DIGEST_SQL} AS input_digest`;

export const EVALUATION_VISIBLE_SQL = `(j.lifecycle_status <> 'INACTIVE' OR j.retention_until IS NULL OR j.retention_until > $2)`;
export const EVALUATION_PENDING_SQL = `(eval.fit_matrix IS NULL OR eval.input_digest IS DISTINCT FROM (${INPUT_DIGEST_SQL})
 OR eval.fit_algorithm_version IS DISTINCT FROM $5::text
 OR eval.job_version IS DISTINCT FROM j.job_version)`;
