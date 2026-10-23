import { createHash } from 'node:crypto';
import sourcesCatalog from '../../data/sources.json' with { type:'json' };
import {
  ROLE_FAMILY_CODES,
  normalizeRoleFamilies,
  normalizeRoleSubfamilies,
  roleSubfamiliesForFamily,
} from '../../shared/role-taxonomy-runtime.mjs';

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
  const families = normalizeRoleFamilies(preferences?.target_role_families);
  return maxFamilies == null ? families : families.slice(0, maxFamilies);
}

function subfamiliesForScope(preferences, family) {
  const explicit = normalizeRoleSubfamilies(preferences?.target_role_subfamilies, family);
  return (explicit.length ? explicit : roleSubfamiliesForFamily(family)).sort();
}

function workModes(value) {
  if (Array.isArray(value)) return list(value, { lower:true }).filter(x => ['remote','hybrid','onsite'].includes(x));
  const source = value && typeof value === 'object' ? value : {};
  if (!Object.keys(source).length) return ['remote','hybrid','onsite'];
  return ['remote','hybrid','onsite'].filter(mode => source?.[mode] === true);
}

function canonicalScope(scope) {
  const family = String(scope?.role_family || '').trim().toUpperCase();
  return Object.freeze({
    role_family:family,
    role_subfamilies:normalizeRoleSubfamilies(scope?.role_subfamilies, family).sort(),
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
  return orderedFamilies(p, 2).map(role_family => canonicalScope({
    role_family,
    role_subfamilies:subfamiliesForScope(p, role_family),
    ...shared,
  }));
}

export function canonicalizeRefreshScopes(scopes) {
  const keyed = new Map();
  for (const raw of Array.isArray(scopes) ? scopes : []) {
    const scope = canonicalScope(raw);
    if (!ROLE_FAMILY_CODES.includes(scope.role_family)) continue;
    if (!scope.role_subfamilies.length) continue;
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
    schema_version:'1.1',
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
      role_subfamilies:[...new Set(keyedScopes.flatMap(item => item.role_subfamilies))].sort(),
      source_count:sourceIds.length,
    }),
  });
}

export function equivalentActiveRun(activeRun, request) {
  const activeSignature = String(activeRun?.request_signature || '').trim().toLowerCase();
  const requestSignature = String(request?.request_signature || '').trim().toLowerCase();
  return Boolean(activeSignature && requestSignature && activeSignature === requestSignature);
}
