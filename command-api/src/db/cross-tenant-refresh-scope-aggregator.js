import { getPool } from './pool.js';
import {
  normalizeRoleFamilies,
  normalizeRoleSubfamilies,
  roleSubfamiliesForFamily,
} from '../../../shared/role-taxonomy-runtime.mjs';

function list(value, { upper = false, lower = false } = {}) {
  const source = Array.isArray(value) ? value : [];
  const normalized = source
    .map(item => String(item ?? '').trim())
    .filter(Boolean)
    .map(item => upper ? item.toUpperCase() : lower ? item.toLowerCase() : item);
  return [...new Set(normalized)].sort();
}

function roleFamilies(row) {
  return normalizeRoleFamilies(row.target_role_families).sort();
}

function roleSubfamilies(row, family) {
  const explicit = normalizeRoleSubfamilies(row.target_role_subfamilies, family);
  return (explicit.length ? explicit : roleSubfamiliesForFamily(family)).sort();
}

function workModes(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return ['remote','hybrid','onsite'].filter(mode => source?.[mode] !== false && (Object.hasOwn(source, mode) || Object.keys(source).length === 0));
}

function scopeKey(scope) {
  return JSON.stringify([
    scope.role_family,
    scope.role_subfamilies,
    scope.target_regions,
    scope.target_country_codes,
    scope.remote_eligible_country_codes,
    scope.work_modes,
    scope.contract_types,
  ]);
}

/**
 * Explicit ADR-008 global-mode exception for ADMIN refresh scope aggregation.
 *
 * The SQL deliberately selects no tenant/user/search-profile identifier and no
 * arbitrary preferences payload. Only allowlisted collection-scope fields leave
 * the database boundary.
 */
export async function aggregateAdminRefreshScopes(
  env = process.env,
  { db = getPool(env) } = {},
) {
  const result = await db.query(
    `SELECT
        COALESCE(pref.preferences->'target_role_families', '[]'::jsonb) AS target_role_families,
        COALESCE(pref.preferences->'target_role_subfamilies', '[]'::jsonb) AS target_role_subfamilies,
        COALESCE(pref.preferences->'target_regions', '[]'::jsonb) AS target_regions,
        COALESCE(pref.preferences->'target_country_codes', '[]'::jsonb) AS target_country_codes,
        COALESCE(pref.preferences->'remote_eligible_country_codes', '[]'::jsonb) AS remote_eligible_country_codes,
        COALESCE(pref.preferences->'work_modes', '{}'::jsonb) AS work_modes,
        COALESCE(pref.preferences->'contract_types', '[]'::jsonb) AS contract_types
       FROM search_profile sp
       JOIN profile workspace
         ON workspace.profile_id = sp.tenant_id
       JOIN app_user account
         ON account.user_id = workspace.user_id
       LEFT JOIN search_profile_preferences pref
         ON pref.tenant_id = sp.tenant_id
        AND pref.search_profile_id = sp.search_profile_id
      WHERE sp.status = 'ACTIVE'
        AND account.status = 'ACTIVE'
        AND account.deletion_started_at IS NULL
        AND COALESCE(pref.preferences, '{}'::jsonb) <> '{}'::jsonb`,
  );

  const aggregate = new Map();
  for (const row of result.rows || []) {
    const shared = {
      target_regions:list(row.target_regions, { upper:true }),
      target_country_codes:list(row.target_country_codes, { upper:true }),
      remote_eligible_country_codes:list(row.remote_eligible_country_codes, { upper:true }),
      work_modes:workModes(row.work_modes),
      contract_types:list(row.contract_types, { lower:true }),
    };
    for (const roleFamily of roleFamilies(row)) {
      const scope = {
        role_family:roleFamily,
        role_subfamilies:roleSubfamilies(row, roleFamily),
        ...shared,
      };
      const key = scopeKey(scope);
      const current = aggregate.get(key);
      if (current) current.active_profile_count += 1;
      else aggregate.set(key, { ...scope, active_profile_count:1 });
    }
  }

  const scopes = [...aggregate.values()].sort((a, b) =>
    a.role_family.localeCompare(b.role_family)
      || scopeKey(a).localeCompare(scopeKey(b))
  );
  return Object.freeze({
    active_profile_count:Number(result.rows?.length || 0),
    scope_count:scopes.length,
    scopes,
  });
}
