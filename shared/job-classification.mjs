import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const TAXONOMY_PATH = new URL('./role-taxonomy.json', import.meta.url);
let cachedTaxonomy = null;

function values(input) {
  if (Array.isArray(input)) return input.map(x => String(x ?? '').trim()).filter(Boolean);
  if (input == null || input === '') return [];
  return [String(input).trim()].filter(Boolean);
}

function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function loadRoleTaxonomy() {
  if (cachedTaxonomy) return cachedTaxonomy;
  const taxonomy = JSON.parse(readFileSync(TAXONOMY_PATH, 'utf8'));
  if (!taxonomy?.taxonomy_version || !Array.isArray(taxonomy?.canonical_families) || !taxonomy?.families) {
    throw new Error('Invalid role taxonomy contract');
  }
  cachedTaxonomy = taxonomy;
  return taxonomy;
}

export function classifyRoleTitle(title, taxonomy = loadRoleTaxonomy()) {
  const normalized = normalizeText(title);
  const matched = [];
  for (const familyCode of taxonomy.canonical_families || []) {
    if (familyCode === 'UNKNOWN') continue;
    const family = taxonomy.families?.[familyCode];
    for (const member of family?.members || []) {
      const included = (member.include_patterns || []).some(pattern => new RegExp(pattern, 'i').test(normalized));
      if (!included) continue;
      const excluded = (member.exclude_patterns || []).some(pattern => new RegExp(pattern, 'i').test(normalized));
      if (!excluded) matched.push([familyCode, String(member.code)]);
    }
  }

  if (!matched.length) {
    return Object.freeze({
      classification_status:'unknown',
      role_family:'UNKNOWN',
      role_subfamily:[],
      family_candidates:[],
    });
  }

  const families = [...new Set(matched.map(([family]) => family))].sort();
  const members = [...new Set(matched.map(([, member]) => member))].sort();
  if (families.length > 1) {
    return Object.freeze({
      classification_status:'conflict',
      role_family:'UNKNOWN',
      role_subfamily:members,
      family_candidates:families,
    });
  }
  return Object.freeze({
    classification_status:'matched',
    role_family:families[0],
    role_subfamily:members,
    family_candidates:families,
  });
}

export function normalizedContractType(payload = {}) {
  const explicit = String(payload.contract_type ?? '').trim().toLowerCase();
  if (['permanent','temporary','contract','freelance'].includes(explicit)) return explicit;
  const raw = values(payload.employment_statuses ?? payload.employment_type ?? payload.employment_status ?? payload.job_type)
    .join(' ')
    .toLowerCase();
  if (/freelance/.test(raw)) return 'freelance';
  if (/contract|contractor|b2b/.test(raw)) return 'contract';
  if (/temporary|fixed[- ]term/.test(raw)) return 'temporary';
  if (/permanent|full[- ]time/.test(raw)) return 'permanent';
  return 'unknown';
}

export function normalizedWorkMode(row = {}, payload = {}) {
  const explicit = String(row.work_mode ?? payload.work_mode ?? payload.work_arrangement ?? payload.mode ?? '')
    .trim()
    .toLowerCase();
  if (payload.remote === true || explicit === 'remote') return 'remote';
  if (payload.hybrid === true || explicit === 'hybrid') return 'hybrid';
  if (['onsite','on-site','on site','office','in-office'].includes(explicit)) return 'onsite';
  return 'unknown';
}

export function normalizedCountryCodes(row = {}, payload = {}) {
  const result = new Set();
  for (const value of [
    ...(Array.isArray(row.country_codes) ? row.country_codes : []),
    ...(Array.isArray(payload.country_codes) ? payload.country_codes : []),
    payload.country_code,
    payload.job_country_code,
  ]) {
    const code = String(value ?? '').trim().toUpperCase();
    if (/^[A-Z]{2}$/.test(code)) result.add(code);
  }
  return [...result].sort();
}

export function normalizedRemoteScope(row = {}, payload = {}, workMode = normalizedWorkMode(row, payload), countryCodes = normalizedCountryCodes(row, payload)) {
  const explicit = String(payload.remote_scope ?? row.remote_scope ?? '').trim();
  if (explicit) return explicit;
  if (workMode !== 'remote') return 'unknown';
  if (countryCodes.length) return 'Country';
  const text = [
    payload.location,
    ...(Array.isArray(payload.countries) ? payload.countries : []),
    ...(Array.isArray(payload.remote_locations) ? payload.remote_locations : []),
    String(payload.description ?? '').slice(0, 5000),
  ].join(' ');
  if (/worldwide|work from anywhere|anywhere in the world|global remote/i.test(text)) return 'Worldwide';
  if (/\bEMEA\b/i.test(text)) return 'EMEA';
  if (/\b(EU|European Union|Europe only|within Europe|across Europe|Europe)\b/i.test(text)) return 'EU';
  return 'unknown';
}

export function normalizedSeniority(payload = {}) {
  const raw = String(payload.seniority ?? payload.seniority_level ?? payload.experience_level ?? '').trim();
  if (!raw) return 'unknown';
  const normalized = normalizeText(raw).replace(/\s+/g, '_');
  return normalized || 'unknown';
}

function stableBasis(job) {
  return {
    title:String(job.title ?? '').trim(),
    company:String(job.company ?? '').trim(),
    location:String(job.location ?? '').trim(),
    country_codes:[...(job.country_codes || [])].sort(),
    work_mode:String(job.work_mode ?? 'unknown'),
    role_family:String(job.role_family ?? 'UNKNOWN'),
    role_subfamily:[...(job.role_subfamily || [])].sort(),
    seniority:String(job.seniority ?? 'unknown'),
    contract_type:String(job.contract_type ?? 'unknown'),
    remote_scope:String(job.remote_scope ?? 'unknown'),
    description:String(job.description ?? '').replace(/\s+/g, ' ').trim(),
  };
}

export function evaluationBasisHash(job) {
  return createHash('sha256').update(JSON.stringify(stableBasis(job)), 'utf8').digest('hex');
}

export function classifyCanonicalJob(row = {}) {
  const payload = { ...(row.payload || {}) };
  const role = classifyRoleTitle(row.title ?? payload.job_title ?? payload.title ?? '');
  const workMode = normalizedWorkMode(row, payload);
  const countryCodes = normalizedCountryCodes(row, payload);
  const contractType = normalizedContractType(payload);
  const remoteScope = normalizedRemoteScope(row, payload, workMode, countryCodes);
  const seniority = normalizedSeniority(payload);
  const taxonomy = loadRoleTaxonomy();
  const classification = {
    role_family:role.role_family,
    role_subfamily:role.role_subfamily,
    seniority,
    contract_type:contractType,
    remote_scope:remoteScope,
    classification_status:role.classification_status,
    classification_confidence:role.classification_status === 'matched' ? 1 : 0,
    classification_version:String(taxonomy.taxonomy_version),
  };
  return Object.freeze({
    ...classification,
    evaluation_basis_hash:evaluationBasisHash({
      title:row.title ?? payload.job_title ?? payload.title ?? '',
      company:row.company ?? payload.company ?? payload.company_name ?? '',
      location:row.location ?? payload.location ?? payload.short_location ?? '',
      country_codes:countryCodes,
      work_mode:workMode,
      ...classification,
      description:payload.description ?? '',
    }),
  });
}
