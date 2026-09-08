export const NOMENCLATURE_SCHEMA_VERSION = '1.0';
export const REQUIRED_NOMENCLATURE_DOMAINS = Object.freeze([
  'regions',
  'countries',
  'work_modes',
  'contract_types',
  'application_statuses',
  'seniority',
]);

export function assertNomenclatures(payload) {
  if (!payload || payload.schema_version !== NOMENCLATURE_SCHEMA_VERSION || !payload.domains || typeof payload.domains !== 'object') {
    throw new Error('Invalid nomenclatures contract');
  }
  for (const name of REQUIRED_NOMENCLATURE_DOMAINS) {
    const domain = payload.domains[name];
    if (!domain || !Array.isArray(domain.values)) throw new Error(`Missing nomenclature domain: ${name}`);
  }
  return payload;
}

export function domainValues(payload, name, { activeOnly = false } = {}) {
  const domain = assertNomenclatures(payload).domains[name];
  if (!domain) throw new Error(`Unknown nomenclature domain: ${name}`);
  const values = [...domain.values].sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0) || String(a.label || '').localeCompare(String(b.label || ''), 'ro'));
  return activeOnly ? values.filter(item => item.active === true) : values;
}

export function domainOptions(payload, name) {
  return domainValues(payload, name, { activeOnly: true }).map(item => [item.code, item.label]);
}

export function activeCodes(payload, name) {
  return new Set(domainValues(payload, name, { activeOnly: true }).map(item => String(item.code)));
}

export function valueByCode(payload, domainName, code, { requireActive = false } = {}) {
  const normalized = String(code || '').trim().toUpperCase();
  const item = domainValues(payload, domainName).find(value => String(value.code || '').trim().toUpperCase() === normalized);
  if (!item || (requireActive && item.active !== true)) return null;
  return item;
}

export function countryLabel(payload, code) {
  return valueByCode(payload, 'countries', code)?.label || String(code || '').trim().toUpperCase();
}

export function countryOptions(payload) {
  return domainOptions(payload, 'countries');
}

export function regionOptions(payload) {
  return domainOptions(payload, 'regions');
}

export function regionMembership(payload) {
  return new Map(domainValues(payload, 'regions').map(region => [
    String(region.code || '').toUpperCase(),
    new Set((region.country_codes || []).map(code => String(code).toUpperCase())),
  ]));
}

export function geographyConflicts(criteria, payload) {
  const membership = regionMembership(payload);
  const targetRegions = new Set(criteria?.targetRegions || []);
  const excludedRegions = new Set(criteria?.excludedRegions || []);
  const targetCountries = new Set(criteria?.targetCountries || []);
  const excludedCountries = new Set(criteria?.excludedCountries || []);
  for (const value of targetRegions) if (excludedRegions.has(value)) return true;
  for (const value of targetCountries) if (excludedCountries.has(value)) return true;
  for (const region of targetRegions) {
    for (const country of excludedCountries) if (membership.get(region)?.has(country)) return true;
  }
  for (const region of excludedRegions) {
    for (const country of targetCountries) if (membership.get(region)?.has(country)) return true;
  }
  return false;
}

export function geographyIndex(payload) {
  const validCountries = new Set([...activeCodes(payload, 'countries')].map(code => code.toUpperCase()));
  const membership = regionMembership(payload);
  const validRegions = new Set([...activeCodes(payload, 'regions')].map(code => code.toUpperCase()));
  return { validCountries, validRegions, membership };
}
