import { getPool } from './db/pool.js';
import { canonicalizeRefreshScopes, coverageScopeKey } from './retrieve-scope.js';

const COVERAGE_STATES = Object.freeze(['SUFFICIENT','INSUFFICIENT','STALE']);

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function boundedNumber(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER, integer = false } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max || (integer && !Number.isInteger(parsed))) {
    return fallback;
  }
  return parsed;
}

export function coveragePolicy(input = {}) {
  const policy = object(input);
  const freshness = boundedNumber(policy.collection_freshness_hours, 24, { min:0.001, max:24 * 365 });
  const minVolume = boundedNumber(policy.coverage_min_corpus_volume, 1, { min:0, max:1000000, integer:true });
  const maxVolumeRaw = policy.coverage_max_corpus_volume;
  const maxVolume = maxVolumeRaw == null || maxVolumeRaw === ''
    ? null
    : boundedNumber(maxVolumeRaw, null, { min:1, max:1000000, integer:true });
  const minDiversity = boundedNumber(policy.coverage_min_source_diversity, 1, { min:0, max:10000, integer:true });
  const cooldown = boundedNumber(policy.coverage_refresh_cooldown_hours, 0, { min:0, max:24 * 365 });
  return Object.freeze({
    collection_freshness_hours:freshness,
    coverage_min_corpus_volume:minVolume,
    coverage_max_corpus_volume:maxVolume,
    coverage_min_source_diversity:minDiversity,
    coverage_refresh_cooldown_hours:cooldown,
  });
}

export function classifyCoverageObservation(scope, observation, policyInput, now = new Date()) {
  const policy = coveragePolicy(policyInput);
  const lastUsableAt = observation?.last_usable_at ? new Date(observation.last_usable_at) : null;
  const ageHours = lastUsableAt && !Number.isNaN(lastUsableAt.getTime())
    ? Math.max(0, (now.getTime() - lastUsableAt.getTime()) / 3600000)
    : null;
  const corpusVolume = Number(observation?.corpus_volume || 0);
  const sourceDiversity = Number(observation?.source_diversity || 0);

  let state = 'INSUFFICIENT';
  let reason = 'NO_USABLE_COVERAGE';
  if (ageHours != null && ageHours > policy.collection_freshness_hours) {
    state = 'STALE';
    reason = 'FRESHNESS_EXPIRED';
  } else if (ageHours != null && corpusVolume < policy.coverage_min_corpus_volume) {
    reason = 'CORPUS_VOLUME_BELOW_MINIMUM';
  } else if (ageHours != null && sourceDiversity < policy.coverage_min_source_diversity) {
    reason = 'SOURCE_DIVERSITY_BELOW_MINIMUM';
  } else if (ageHours != null) {
    state = 'SUFFICIENT';
    reason = null;
  }

  const cooldownRemainingHours = state === 'SUFFICIENT' || ageHours == null || policy.coverage_refresh_cooldown_hours <= 0
    ? 0
    : Math.max(0, policy.coverage_refresh_cooldown_hours - ageHours);
  const refreshAllowed = state !== 'SUFFICIENT' && cooldownRemainingHours <= 0;

  return Object.freeze({
    scope_key:coverageScopeKey(scope),
    scope,
    state,
    reason,
    last_usable_run_id:observation?.last_usable_run_id || null,
    last_usable_at:lastUsableAt?.toISOString() || null,
    age_hours:ageHours == null ? null : Number(ageHours.toFixed(3)),
    corpus_volume:corpusVolume,
    source_diversity:sourceDiversity,
    source_ids:Array.isArray(observation?.source_ids) ? observation.source_ids : [],
    refresh_allowed:refreshAllowed,
    cooldown_remaining_hours:Number(cooldownRemainingHours.toFixed(3)),
    over_max:policy.coverage_max_corpus_volume != null && corpusVolume > policy.coverage_max_corpus_volume,
  });
}

async function readPolicy(db) {
  const result = await db.query('SELECT policy FROM collection_policy WHERE singleton=true');
  return object(result.rows?.[0]?.policy);
}

async function rowsForKeys(db, keys) {
  if (!keys.length) return [];
  const result = await db.query(
    `SELECT scope_key, role_family, role_subfamilies, scope, last_usable_run_id, last_usable_at,
            corpus_volume, source_diversity, source_ids, updated_at
       FROM coverage_scope_state
      WHERE scope_key = ANY($1::text[])`,
    [keys],
  );
  return result.rows || [];
}

export async function coverageStateForScopes(
  scopes,
  env = process.env,
  { db = getPool(env), now = new Date() } = {},
) {
  const canonical = canonicalizeRefreshScopes(scopes);
  const keyed = canonical.map(scope => ({ scope, scope_key:coverageScopeKey(scope) }));
  const [policyInput, observations] = await Promise.all([
    readPolicy(db),
    rowsForKeys(db, keyed.map(item => item.scope_key)),
  ]);
  const byKey = new Map(observations.map(row => [String(row.scope_key), row]));
  const entries = keyed.map(({ scope, scope_key }) =>
    classifyCoverageObservation(scope, byKey.get(scope_key) || null, policyInput, now)
  );
  const refreshScopes = entries
    .filter(entry => entry.state !== 'SUFFICIENT' && entry.refresh_allowed)
    .map(entry => entry.scope);
  return Object.freeze({
    schema_version:'1.0',
    policy:coveragePolicy(policyInput),
    scopes:entries,
    refresh_scopes:refreshScopes,
    all_sufficient:entries.length > 0 && entries.every(entry => entry.state === 'SUFFICIENT'),
    blocked_by_cooldown:entries.some(entry => entry.state !== 'SUFFICIENT' && !entry.refresh_allowed),
    state_counts:Object.fromEntries(COVERAGE_STATES.map(state => [
      state,
      entries.filter(entry => entry.state === state).length,
    ])),
  });
}

export async function adminCoverageSnapshot(
  authContext,
  env = process.env,
  { db = getPool(env), now = new Date() } = {},
) {
  if (authContext?.role !== 'ADMIN') {
    throw Object.assign(new Error('ADMIN role required'), { status:403 });
  }
  const [policyInput, result] = await Promise.all([
    readPolicy(db),
    db.query(
      `SELECT scope_key, role_family, role_subfamilies, scope, last_usable_run_id, last_usable_at,
              corpus_volume, source_diversity, source_ids, updated_at
         FROM coverage_scope_state
        ORDER BY role_family, scope_key`,
    ),
  ]);
  const policy = coveragePolicy(policyInput);
  const scopes = (result.rows || []).map(row =>
    classifyCoverageObservation(object(row.scope), row, policyInput, now)
  );
  return Object.freeze({
    schema_version:'1.0',
    policy,
    scopes,
    state_counts:Object.fromEntries(COVERAGE_STATES.map(state => [
      state,
      scopes.filter(entry => entry.state === state).length,
    ])),
  });
}