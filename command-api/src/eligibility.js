import { geographyIndex } from '../../shared/nomenclatures.mjs';

export const ELIGIBILITY_STATES = Object.freeze({
  ELIGIBLE:'ELIGIBLE',
  INELIGIBLE:'INELIGIBLE',
  UNKNOWN:'UNKNOWN',
});

const FAMILY_TO_GROUP = Object.freeze({
  PROJECT_MANAGEMENT:'pm',
  DELIVERY:'delivery',
  SERVICE_MANAGEMENT:'service',
  SCRUM_AGILE:'scrum',
  PROGRAM_PMO:'program',
});

function values(input) {
  if (Array.isArray(input)) return input.map(x => String(x ?? '').trim()).filter(Boolean);
  if (input == null || input === '') return [];
  return [String(input).trim()].filter(Boolean);
}

function compileRegex(items) {
  const patterns = values(items);
  if (!patterns.length) return { regex:null, invalid:false };
  try {
    return { regex:new RegExp(patterns.map(x => '(?:' + x + ')').join('|'), 'i'), invalid:false };
  } catch {
    return { regex:null, invalid:true };
  }
}

function targetCountries(preferences, nomenclatures) {
  const { membership } = geographyIndex(nomenclatures);
  const result = new Set(values(preferences.target_country_codes).map(x => x.toUpperCase()));
  for (const region of values(preferences.target_regions).map(x => x.toUpperCase())) {
    for (const code of membership.get(region) || []) result.add(code);
  }
  return result;
}

function excludedCountries(preferences, nomenclatures) {
  const { membership } = geographyIndex(nomenclatures);
  const result = new Set(values(preferences.excluded_country_codes).map(x => x.toUpperCase()));
  for (const region of values(preferences.excluded_regions).map(x => x.toUpperCase())) {
    for (const code of membership.get(region) || []) result.add(code);
  }
  return result;
}

function normalizeFamilySet(preferences) {
  const explicit = new Set(values(preferences.target_role_families).map(x => x.toUpperCase()));
  if (explicit.size) return explicit;
  const result = new Set();
  const groups = preferences.role_groups || {};
  for (const [family, group] of Object.entries(FAMILY_TO_GROUP)) {
    if (groups?.[group]?.enabled !== false) result.add(family);
  }
  return result;
}

function roleRestricted(preferences) {
  if (values(preferences.target_role_families).length) return true;
  const groups = preferences.role_groups || {};
  return Object.values(FAMILY_TO_GROUP).some(group => groups?.[group]?.enabled === false);
}

function geographicDecision(row, preferences, nomenclatures) {
  const countries = values(row.country_codes).map(x => x.toUpperCase());
  const remoteScope = String(row.remote_scope || '').trim();
  const workMode = String(row.work_mode || 'unknown').toLowerCase();
  const targets = targetCountries(preferences, nomenclatures);
  const excluded = excludedCountries(preferences, nomenclatures);
  const targetRegions = new Set(values(preferences.target_regions).map(x => x.toUpperCase()));
  const excludedRegions = new Set(values(preferences.excluded_regions).map(x => x.toUpperCase()));
  if (!targets.size && !targetRegions.size && !excluded.size && !excludedRegions.size) return null;

  if (countries.some(code => excluded.has(code))) {
    return { state:'INELIGIBLE', code:'GEOGRAPHY_EXCLUDED' };
  }

  if (workMode === 'remote' && remoteScope === 'Worldwide') return null;

  if (workMode === 'remote' && ['EU','EMEA'].includes(remoteScope)) {
    if (excludedRegions.has(remoteScope) || (remoteScope === 'EMEA' && excludedRegions.has('EU'))) {
      return { state:'INELIGIBLE', code:'REMOTE_SCOPE_EXCLUDED' };
    }
    const { membership } = geographyIndex(nomenclatures);
    const eu = membership.get('EU') || new Set();
    if (targetRegions.has('EU') || [...targets].some(code => eu.has(code) && !excluded.has(code))) return null;
    if (targets.size || targetRegions.size) return { state:'INELIGIBLE', code:'OUTSIDE_TARGET_GEOGRAPHY' };
  }

  if (countries.length) {
    if (!targets.size && !targetRegions.size) return null;
    if (countries.some(code => targets.has(code))) return null;
    return { state:'INELIGIBLE', code:'OUTSIDE_TARGET_GEOGRAPHY' };
  }

  if (targets.size || targetRegions.size) {
    return { state:'UNKNOWN', code:'GEOGRAPHY_UNKNOWN' };
  }
  return null;
}

function remoteAuthorizationDecision(row, preferences, nomenclatures) {
  if (String(row.work_mode || '').toLowerCase() !== 'remote') return null;
  const allowed = new Set(values(preferences.remote_eligible_country_codes).map(x => x.toUpperCase()));
  if (!allowed.size) return null;
  const scope = String(row.remote_scope || '').trim();
  const countries = values(row.country_codes).map(x => x.toUpperCase());
  if (scope === 'Worldwide') return null;
  if (['EU','EMEA'].includes(scope)) {
    const { membership } = geographyIndex(nomenclatures);
    const eu = membership.get('EU') || new Set();
    return [...allowed].some(code => eu.has(code))
      ? null
      : { state:'INELIGIBLE', code:'REMOTE_AUTHORIZATION_INCOMPATIBLE' };
  }
  if (countries.length) {
    return countries.some(code => allowed.has(code))
      ? null
      : { state:'INELIGIBLE', code:'REMOTE_AUTHORIZATION_INCOMPATIBLE' };
  }
  return { state:'UNKNOWN', code:'REMOTE_AUTHORIZATION_UNKNOWN' };
}

export function evaluateEligibility(row, preferences = {}, nomenclatures) {
  const payload = { ...(row.payload || {}), ...(row.posting_payload || {}) };
  const title = String(row.title || payload.job_title || payload.title || '').trim();
  const company = String(row.company || payload.company || payload.company_name || '').trim();
  const description = String(payload.description || '');
  const unknown = [];

  const allowedFamilies = normalizeFamilySet(preferences);
  const family = String(row.role_family || 'UNKNOWN').toUpperCase();
  if (roleRestricted(preferences)) {
    if (family === 'UNKNOWN') unknown.push('ROLE_FAMILY_UNKNOWN');
    else if (!allowedFamilies.has(family)) {
      return Object.freeze({ state:'INELIGIBLE', reason_code:'ROLE_FAMILY_EXCLUDED', reasons:['ROLE_FAMILY_EXCLUDED'] });
    }
  }

  const targetSubfamilies = new Set(values(preferences.target_role_subfamilies));
  if (targetSubfamilies.size) {
    const subfamilies = values(row.role_subfamily);
    if (!subfamilies.length) unknown.push('ROLE_SUBFAMILY_UNKNOWN');
    else if (!subfamilies.some(code => targetSubfamilies.has(code))) {
      return Object.freeze({ state:'INELIGIBLE', reason_code:'ROLE_SUBFAMILY_EXCLUDED', reasons:['ROLE_SUBFAMILY_EXCLUDED'] });
    }
  }

  const companyRule = compileRegex(preferences.excluded_company_patterns);
  const roleRule = compileRegex(preferences.excluded_role_keywords);
  const erpRule = compileRegex(preferences.deep_erp_terms);
  if (companyRule.invalid || roleRule.invalid || erpRule.invalid) unknown.push('HARD_EXCLUSION_RULE_INVALID');
  if (companyRule.regex?.test(company)) {
    return Object.freeze({ state:'INELIGIBLE', reason_code:'COMPANY_EXCLUDED', reasons:['COMPANY_EXCLUDED'] });
  }
  if (roleRule.regex?.test(title)) {
    return Object.freeze({ state:'INELIGIBLE', reason_code:'ROLE_EXCLUDED', reasons:['ROLE_EXCLUDED'] });
  }
  if (erpRule.regex) {
    const text = title + ' ' + description;
    if (erpRule.regex.test(text) && /implement|consultant|specialist|functional/i.test(text)) {
      return Object.freeze({ state:'INELIGIBLE', reason_code:'HARD_EXCLUSION_MATCH', reasons:['HARD_EXCLUSION_MATCH'] });
    }
    if (!description) unknown.push('HARD_EXCLUSION_EVIDENCE_UNKNOWN');
  }

  const workMode = String(row.work_mode || 'unknown').toLowerCase();
  const workModes = preferences.work_modes || {};
  if (workMode === 'unknown') {
    if (['remote','hybrid','onsite'].some(mode => workModes?.[mode] === false)) unknown.push('WORK_MODE_UNKNOWN');
  } else if (workModes?.[workMode] === false) {
    return Object.freeze({ state:'INELIGIBLE', reason_code:'WORK_MODE_EXCLUDED', reasons:['WORK_MODE_EXCLUDED'] });
  }

  const contractTypes = new Set(values(preferences.contract_types).map(x => x.toLowerCase()));
  const contractType = String(row.contract_type || payload.contract_type || 'unknown').toLowerCase();
  if (contractTypes.size) {
    if (contractType === 'unknown') unknown.push('CONTRACT_TYPE_UNKNOWN');
    else if (!contractTypes.has(contractType)) {
      return Object.freeze({ state:'INELIGIBLE', reason_code:'CONTRACT_TYPE_EXCLUDED', reasons:['CONTRACT_TYPE_EXCLUDED'] });
    }
  }

  const geography = geographicDecision(row, preferences, nomenclatures);
  if (geography?.state === 'INELIGIBLE') {
    return Object.freeze({ state:'INELIGIBLE', reason_code:geography.code, reasons:[geography.code] });
  }
  if (geography?.state === 'UNKNOWN') unknown.push(geography.code);

  const authorization = remoteAuthorizationDecision(row, preferences, nomenclatures);
  if (authorization?.state === 'INELIGIBLE') {
    return Object.freeze({ state:'INELIGIBLE', reason_code:authorization.code, reasons:[authorization.code] });
  }
  if (authorization?.state === 'UNKNOWN') unknown.push(authorization.code);

  const repost = Boolean(row.repost_of_posting_id || payload.reposted || payload.repost);
  if (preferences.keep_reposts === false && repost) {
    return Object.freeze({ state:'INELIGIBLE', reason_code:'REPOST_EXCLUDED', reasons:['REPOST_EXCLUDED'] });
  }

  const reasons = [...new Set(unknown)];
  if (reasons.length) return Object.freeze({ state:'UNKNOWN', reason_code:reasons[0], reasons });
  return Object.freeze({ state:'ELIGIBLE', reason_code:null, reasons:[] });
}
