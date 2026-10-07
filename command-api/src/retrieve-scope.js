import { createHash } from 'node:crypto';
import sourcesCatalog from '../../data/sources.json' with { type:'json' };

const FAMILY_TO_GROUP = Object.freeze({
  PROJECT_MANAGEMENT:'pm',
  DELIVERY:'delivery',
  SERVICE_MANAGEMENT:'service',
  SCRUM_AGILE:'scrum',
  PROGRAM_PMO:'program',
});
const FAMILY_ORDER = Object.freeze(Object.keys(FAMILY_TO_GROUP));

function list(value, { upper=false, lower=false } = {}) {
  const raw = Array.isArray(value) ? value : value == null ? [] : [value];
  const normalized = raw
    .flatMap(item => String(item ?? '').split(','))
    .map(item => item.trim())
    .filter(Boolean)
    .map(item => upper ? item.toUpperCase() : lower ? item.toLowerCase() : item);
  return [...new Set(normalized)];
}

function orderedFamilies(preferences, maxFamilies = null) {
  const explicit = list(preferences?.target_role_families, { upper:true })
    .filter(family => FAMILY_ORDER.includes(family));
  let families = explicit;
  if (!families.length) {
    const groups = preferences?.role_groups && typeof preferences.role_groups === 'object'
      && !Array.isArray(preferences.role_groups) ? preferences.role_groups : {};
    families = FAMILY_ORDER.filter(family => groups?.[FAMILY_TO_GROUP[family]]?.enabled === true);
  }
  const unique = [...new Set(families)];
  return maxFamilies == null ? unique : unique.slice(0, maxFamilies);
}

function workModes(value) {
  if (Array.isArray(value)) return list(value, { lower:true }).filter(x => ['remote','hybrid','onsite'].includes(x));
  const source = value && typeof value === 'object' ? value : {};
  if (!Object.keys(source).length) return ['remote','hybrid','onsite'];
  return ['remote','hybrid','onsite'].filter(mode => source?.[mode] === true);
}

function canonicalScope(scope) {
  return Object.freeze({
    role_family:String(scope?.role_family || '').trim().toUpperCase(),
    target_regions:list(scope?.target_regions, { upper:true }).sort(),
    target_country_codes:list(scope?.target_country_codes, { upper:true }).sort(),
    remote_eligible_country_codes:list(scope?.remote_eligible_country_codes, { upper:true }).sort(),
    work_modes:list(scope?.work_modes, { lower:true }).sort(),
    contract_types:list(scope?.contract_types, { lower:true }).sort(),
  });
}

export function userRefreshScopes(preferences) {
  const p = preferences && typeof preferences === 'object' && !Array.isArray(preferences) ? preferences : {};
  const shared = {
    target_regions:list(p.target_regions, { upper:true }),
    target_country_codes:list(p.target_country_codes, { upper:true }),
    remote_eligible_country_codes:list(p.remote_eligible_country_codes, { upper:true }),
    work_modes:workModes(p.work_modes),
    contract_types:list(p.contract_types, { lower:true }),
  };
  return orderedFamilies(p, 2).map(role_family => canonicalScope({ role_family, ...shared }));
}

export function canonicalizeRefreshScopes(scopes) {
  const keyed = new Map();
  for (const raw of Array.isArray(scopes) ? scopes : []) {
    const scope = canonicalScope(raw);
    if (!FAMILY_ORDER.includes(scope.role_family)) continue;
    const key = JSON.stringify(scope);
    if (!keyed.has(key)) keyed.set(key, scope);
  }
  return [...keyed.values()].sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

export function effectiveSourceIds(catalog = sourcesCatalog) {
  const sources = Array.isArray(catalog?.sources) ? catalog.sources : [];
  return sources
    .filter(source =>
      source?.active === true
      && source?.policy_excluded !== true
      && String(source?.name || '').trim().toLowerCase() !== 'monster'
    )
    .map(source => String(source?.id || '').trim())
    .filter(Boolean)
    .sort();
}

function stablePayload(value) {
  if (Array.isArray(value)) return value.map(stablePayload);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stablePayload(value[key])]));
  }
  return value;
}

export function coverageScopeKey(scope) {
  const canonical = canonicalScope(scope);
  const payload = JSON.stringify(stablePayload(canonical));
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

export function buildRetrieveRequest({
  scopes,
  collectionFreshnessHours,
  sourceCatalog = sourcesCatalog,
} = {}) {
  const canonicalScopes = canonicalizeRefreshScopes(scopes);
  const keyedScopes = canonicalScopes.map(scope => Object.freeze({
    ...scope,
    scope_key:coverageScopeKey(scope),
  }));
  const sourceIds = effectiveSourceIds(sourceCatalog);
  const freshness = Number(collectionFreshnessHours);
  const safeFreshness = Number.isFinite(freshness) && freshness > 0 ? Math.min(freshness, 24 * 365) : 24;
  const scope = Object.freeze({
    schema_version:'1.0',
    scopes:keyedScopes,
    effective_source_ids:sourceIds,
    freshness:{ collection_freshness_hours:safeFreshness },
  });
  const canonical = JSON.stringify(stablePayload(scope));
  const requestSignature = createHash('sha256').update(canonical, 'utf8').digest('hex');
  return Object.freeze({
    request_signature:requestSignature,
    retrieve_scope:scope,
    scope_summary:Object.freeze({
      scope_count:keyedScopes.length,
      role_families:[...new Set(keyedScopes.map(item => item.role_family))],
      source_count:sourceIds.length,
    }),
  });
}

export function equivalentActiveRun(activeRun, request) {
  const activeSignature = String(activeRun?.request_signature || '').trim().toLowerCase();
  const requestSignature = String(request?.request_signature || '').trim().toLowerCase();
  return Boolean(activeSignature && requestSignature && activeSignature === requestSignature);
}