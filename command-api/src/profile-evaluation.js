import { geographyIndex } from '../../shared/nomenclatures.mjs';

export const EVALUATION_VERSION = 'multiuser-v1';

const FAMILY_TO_GROUP = Object.freeze({
  PROJECT_MANAGEMENT:'pm',
  DELIVERY:'delivery',
  SERVICE_MANAGEMENT:'service',
  SCRUM_AGILE:'scrum',
  PROGRAM_PMO:'program',
});

function values(input) {
  if (Array.isArray(input)) return input.map(x => String(x || '').trim()).filter(Boolean);
  if (input == null || input === '') return [];
  return [String(input).trim()].filter(Boolean);
}

function regexList(items) {
  const patterns = values(items);
  if (!patterns.length) return null;
  try { return new RegExp(patterns.map(x => '(?:' + x + ')').join('|'), 'i'); }
  catch { return null; }
}

function countryScope(payload, countryCodes, remote) {
  const explicit = String(payload.remote_scope || '').trim();
  if (explicit) return explicit;
  if (countryCodes.length) return 'Country';
  if (!remote) return 'Unknown';
  const text = [
    payload.location,
    ...values(payload.countries),
    ...values(payload.remote_locations),
    String(payload.description || '').slice(0, 5000),
  ].join(' ');
  if (/worldwide|work from anywhere|anywhere in the world|global remote/i.test(text)) return 'Worldwide';
  if (/\bEMEA\b/i.test(text)) return 'EMEA';
  if (/\b(EU|European Union|Europe only|within Europe|across Europe|Europe)\b/i.test(text)) return 'EU';
  return 'Worldwide';
}

function targetCountryCodes(preferences, nomenclatures) {
  const { membership } = geographyIndex(nomenclatures);
  const result = new Set(values(preferences.target_country_codes).map(x => x.toUpperCase()));
  for (const region of values(preferences.target_regions).map(x => x.toUpperCase())) {
    for (const code of membership.get(region) || []) result.add(code);
  }
  return result;
}

function excludedCountryCodes(preferences, nomenclatures) {
  const { membership } = geographyIndex(nomenclatures);
  const result = new Set(values(preferences.excluded_country_codes).map(x => x.toUpperCase()));
  for (const region of values(preferences.excluded_regions).map(x => x.toUpperCase())) {
    for (const code of membership.get(region) || []) result.add(code);
  }
  return result;
}

function contractType(payload) {
  const explicit = String(payload.contract_type || '').trim().toLowerCase();
  if (['permanent','temporary','contract','freelance'].includes(explicit)) return explicit;
  const raw = values(payload.employment_statuses || payload.employment_type || payload.employment_status || payload.job_type)
    .join(' ').toLowerCase();
  if (/freelance/.test(raw)) return 'freelance';
  if (/contract|contractor|b2b/.test(raw)) return 'contract';
  if (/temporary|fixed[- ]term/.test(raw)) return 'temporary';
  if (/permanent|full[- ]time/.test(raw)) return 'permanent';
  return 'unknown';
}

function mode(row, payload) {
  const code = String(row.work_mode || payload.work_mode || payload.work_arrangement || payload.mode || '').trim().toLowerCase();
  if (payload.remote === true || code === 'remote') return 'remote';
  if (payload.hybrid === true || code === 'hybrid') return 'hybrid';
  if (['onsite','on-site','on site','office','in-office'].includes(code)) return 'onsite';
  return 'unknown';
}

function roleEnabled(row, preferences) {
  const family = String(row.role_family || 'UNKNOWN');
  if (family === 'UNKNOWN') return true;
  const group = FAMILY_TO_GROUP[family];
  return group ? preferences.role_groups?.[group]?.enabled !== false : true;
}

function geographicEligibility({ countryCodes, remoteScope, remote }, preferences, nomenclatures) {
  const { membership } = geographyIndex(nomenclatures);
  const targets = targetCountryCodes(preferences, nomenclatures);
  const excluded = excludedCountryCodes(preferences, nomenclatures);
  const targetRegions = new Set(values(preferences.target_regions).map(x => x.toUpperCase()));
  const excludedRegions = new Set(values(preferences.excluded_regions).map(x => x.toUpperCase()));
  if (!targets.size && !targetRegions.size) return true;

  if (remote && remoteScope === 'Worldwide') {
    return [...targets].some(code => !excluded.has(code)) || targetRegions.size > 0;
  }

  if (remote && ['EU','EMEA'].includes(remoteScope)) {
    if (excludedRegions.has('EU')) return false;
    const eu = membership.get('EU') || new Set();
    return targetRegions.has('EU') || [...targets].some(code => eu.has(code) && !excluded.has(code));
  }

  if (!countryCodes.length) return true;
  return countryCodes.some(code => targets.has(code) && !excluded.has(code));
}

function remoteEligibilityMatches({ countryCodes, remoteScope, remote }, preferences, nomenclatures) {
  if (!remote) return true;
  const eligible = new Set(values(preferences.remote_eligible_country_codes).map(x => x.toUpperCase()));
  if (!eligible.size) return true;
  if (remoteScope === 'Worldwide') return true;
  if (['EU','EMEA'].includes(remoteScope)) {
    const { membership } = geographyIndex(nomenclatures);
    const eu = membership.get('EU') || new Set();
    return [...eligible].some(code => eu.has(code));
  }
  if (!countryCodes.length) return true;
  return countryCodes.some(code => eligible.has(code));
}

export function evaluateSharedJob(row, preferences, nomenclatures, now = new Date()) {
  const payload = { ...(row.payload || {}), ...(row.posting_payload || {}) };
  const title = String(row.title || payload.job_title || payload.title || '').trim();
  const company = String(row.company || payload.company || payload.company_name || '').trim();
  const description = String(payload.description || '');
  const text = title + ' ' + description;
  const workMode = mode(row, payload);
  const remote = workMode === 'remote';
  const hybrid = workMode === 'hybrid';
  const countries = values(payload.countries);
  const countryCodes = [...new Set([...(row.country_codes || []), ...values(payload.country_codes), payload.country_code, payload.job_country_code]
    .map(x => String(x || '').trim().toUpperCase()).filter(x => /^[A-Z]{2}$/.test(x)))];
  const remoteScope = countryScope(payload, countryCodes, remote);
  const type = contractType(payload);
  const repost = Boolean(row.repost_of_posting_id || payload.reposted || payload.repost);

  let exclusion = null;
  if (!roleEnabled(row, preferences)) exclusion = 'role family disabled';
  const excludedCompany = regexList(preferences.excluded_company_patterns);
  const excludedRole = regexList(preferences.excluded_role_keywords);
  const deepErp = regexList(preferences.deep_erp_terms);
  if (!exclusion && excludedCompany?.test(company)) exclusion = 'excluded company';
  if (!exclusion && excludedRole?.test(title)) exclusion = 'excluded role';
  if (!exclusion && deepErp?.test(text) && /implement|consultant|specialist|functional/i.test(text)) exclusion = 'deep ERP implementation';
  if (!exclusion && preferences.work_modes?.[workMode] === false) exclusion = workMode + ' disabled';
  const selectedTypes = new Set(values(preferences.contract_types).map(x => x.toLowerCase()));
  if (!exclusion && type !== 'unknown' && selectedTypes.size && !selectedTypes.has(type)) exclusion = 'contract type disabled';
  if (!exclusion && !geographicEligibility({ countryCodes, remoteScope, remote }, preferences, nomenclatures)) exclusion = 'outside target geography';
  if (!exclusion && !remoteEligibilityMatches({ countryCodes, remoteScope, remote }, preferences, nomenclatures)) exclusion = 'remote eligibility geography incompatible';
  if (!exclusion && preferences.keep_reposts === false && repost) exclusion = 'repost disabled';

  if (exclusion) {
    return { eligible:false, score:null, pros:[], risks:[], exclusionReason:exclusion, job:null };
  }

  let score = 68;
  const lower = title.toLowerCase();
  if (lower.includes('it project') || lower.includes('technical project')) score += 13;
  else if (lower.includes('project manager')) score += 9;
  if (lower.includes('delivery')) score += 9;
  if (lower.includes('service')) score += 6;
  if (/program|programme|pmo/.test(lower)) score += 6;
  if (lower.includes('scrum')) score += 3;
  if (remote) score += 8;
  else if (hybrid) score += 4;
  if (/contract|freelance|b2b/i.test(text) || ['contract','freelance'].includes(type)) score += 6;
  if (/European Commission|European Parliament|EU institution|public sector/i.test(text)) score += 7;
  if (/bank|financial|compliance|regulated|governance/i.test(text)) score += 5;
  if (/Dutch|German|native French|fluent French/i.test(text)) score -= 7;
  score = Math.max(40, Math.min(96, score));

  const pros = [];
  if (remote) pros.push('Remote');
  if (geographicEligibility({ countryCodes, remoteScope, remote }, preferences, nomenclatures)) pros.push('Geografie eligibila');
  if (/bank|financial|compliance|regulated|governance/i.test(text)) pros.push('Mediu reglementat relevant');
  if (/European Commission|European Parliament|EU institution|public sector/i.test(text)) pros.push('Context public sau institutii europene');
  if (!pros.length) pros.push('Titlu si responsabilitati relevante pentru profil');

  const risks = [];
  if (/Dutch|German|native French|fluent French/i.test(text)) risks.push('Cerinta lingvistica trebuie verificata');
  if (!['contract','freelance'].includes(type) && !/contract|freelance|b2b/i.test(text)) risks.push('Forma B2B nu este confirmata');
  if (!risks.length) risks.push('Conditiile contractuale trebuie confirmate');

  const posted = row.posted_at || payload.date_posted || payload.posted_at || null;
  const age = posted ? Math.max(0, Math.floor((now.getTime() - new Date(posted).getTime()) / 3600000)) : 0;
  const threshold = Number(preferences.fit_threshold ?? 80);
  const url = row.canonical_url || payload.final_url || payload.source_url || payload.url || null;
  const modeLabel = workMode === 'remote' ? 'Remote' : workMode === 'hybrid' ? 'Hybrid' : workMode === 'onsite' ? 'Onsite' : 'N/A';

  return {
    eligible:true,
    score,
    pros:pros.slice(0, 2),
    risks:risks.slice(0, 2),
    exclusionReason:null,
    job:{
      id:String(row.job_id),
      title,
      company,
      initial:company.split(/\s+/).slice(0,2).map(x => x[0]).join('').toUpperCase() || '?',
      fit:score,
      location:row.location || payload.location || payload.short_location || 'Nespecificat',
      countries,
      country_codes:countryCodes,
      remote_scope:remoteScope,
      mode:modeLabel,
      type:type === 'unknown' ? 'Nespecificat' : type,
      contract_type:type,
      employment_type_raw:values(payload.employment_statuses || payload.employment_type).join(', ') || null,
      age,
      remote,
      b2b:['contract','freelance'].includes(type) || /contract|freelance|b2b/i.test(text),
      repost,
      status:score >= threshold ? 'new' : 'review',
      pros:pros.slice(0,2),
      risks:risks.slice(0,2),
      url,
      description,
      date_posted:posted,
      source:row.source_name || payload.source || 'Nespecificata',
      verified_at:payload.verified_at || null,
      archived_at:row.archived_at || null,
    },
  };
}
