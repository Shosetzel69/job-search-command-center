import { evaluateFitV2 } from '../../shared/fit-v2.mjs';
import { geographyIndex } from '../../shared/nomenclatures.mjs';
import { evaluateEligibility } from './eligibility.js';
import { ROLE_TAXONOMY, normalizeRoleFamilies, normalizeRoleSubfamilies } from '../../shared/role-taxonomy-runtime.mjs';
import { canonicalPostedDate, postedAgeHours, parsePostedDate } from './posted-date.mjs';

export const FIT_ALGORITHM_VERSION = 'fit-v2-independent-2';
export const EVALUATION_VERSION = FIT_ALGORITHM_VERSION;


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
  return 'Unknown';
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

function contractType(payload, row = {}) {
  const explicit = String(row.contract_type && row.contract_type !== 'unknown' ? row.contract_type : payload.contract_type || '').trim().toLowerCase();
  if (['permanent','temporary','contract','freelance'].includes(explicit)) return explicit;
  const raw = values(payload.employment_statuses || payload.employment_type || payload.employment_status || payload.job_type)
    .join(' ').toLowerCase();
  if (/freelance/.test(raw)) return 'freelance';
  if (/contract|contractor|b2b/.test(raw)) return 'contract';
  if (/temporary|fixed[- ]term/.test(raw)) return 'temporary';
  if (/permanent/.test(raw)) return 'permanent';
  return 'unknown';
}

function mode(row, payload) {
  const code = String(row.work_mode || payload.work_mode || payload.work_arrangement || payload.mode || '').trim().toLowerCase();
  if (payload.remote === true || code === 'remote') return 'remote';
  if (payload.hybrid === true || code === 'hybrid') return 'hybrid';
  if (['onsite','on-site','on site','office','in-office'].includes(code)) return 'onsite';
  return 'unknown';
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

export function sourcePostingDates(row, now=new Date()) {
  const p=row.posting_payload||{};
  // Never replace an absent source publication date with a canonical age, retrieval timestamp, or another posting.
  const raw=[p.date_posted,p.posted_at].find(x=>parsePostedDate(x,now));
  const fromPosting=parsePostedDate(row.posted_at,now);
  const parsed=fromPosting||parsePostedDate(raw,now);
  const originalDay=typeof raw==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(raw)&&parsePostedDate(raw,now)===parsed;
  return {
    retrieve_date:parsePostedDate(row.posting_last_seen_at,now),
    publication_date:originalDay?raw:parsed,
    publication_precision:parsed?(originalDay?'date':'timestamp'):null,
  };
}

// A stored classification cannot corroborate itself. Use the existing shared
// taxonomy as a conservative title-evidence gate, without changing the corpus.
export function titleRoleEvidence(title, row, preferences) {
  const selected=normalizeRoleFamilies(preferences?.target_role_families);
  if(!selected.length)return true;
  const normalized=String(title||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
  const matches=[];
  for(const [family,definition] of Object.entries(ROLE_TAXONOMY.families)){
    for(const member of definition.members||[]){
      if(member.include_patterns.some(p=>new RegExp(p,'iu').test(normalized)) &&
         !member.exclude_patterns.some(p=>new RegExp(p,'iu').test(normalized)))matches.push({family,code:member.code});
    }
  }
  const families=new Set(matches.map(m=>m.family));
  const family=String(row.role_family||'UNKNOWN').toUpperCase();
  if(families.size!==1||!families.has(family)||!selected.includes(family))return false;
  const members=normalizeRoleSubfamilies(preferences.target_role_subfamilies,family);
  return !members.length||matches.some(m=>members.includes(m.code));
}

function fitEvidence(row,payload,company,workMode,type){
  // Structured fields only; never infer compensation, industry or career from title/description.
  return {
    compensation:payload.compensation??payload.salary??null,
    work_mode:workMode,
    contract_type:type,
    industry:payload.industry??null,
    career:payload.career_opportunities??null,
    company:company||null,
  };
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
  const type = contractType(payload, row);
  const repost = Boolean(row.repost_of_posting_id || payload.reposted || payload.repost);

  const eligibility = evaluateEligibility({
    ...row,
    country_codes:countryCodes,
    work_mode:workMode,
    contract_type:row.contract_type || type,
    remote_scope:row.remote_scope || remoteScope,
    repost_of_posting_id:row.repost_of_posting_id,
    payload,
  }, preferences, nomenclatures);

  const compatibilityReasons = {
      ROLE_FAMILY_EXCLUDED:'jobs family disabled',
      ROLE_FAMILY_UNKNOWN:'role family unresolved',
      COMPANY_EXCLUDED:'excluded company',
      ROLE_EXCLUDED:'excluded role',
      HARD_EXCLUSION_MATCH:'deep ERP implementation',
      WORK_MODE_EXCLUDED:workMode + ' disabled',
      CONTRACT_TYPE_EXCLUDED:'contract type disabled',
      GEOGRAPHY_EXCLUDED:'outside target geography',
      REMOTE_SCOPE_EXCLUDED:'outside target geography',
      OUTSIDE_TARGET_GEOGRAPHY:'outside target geography',
      REMOTE_AUTHORIZATION_INCOMPATIBLE:'remote eligibility geography incompatible',
      REPOST_EXCLUDED:'repost disabled',
    };

  const roleCorroborated=titleRoleEvidence(title,row,preferences);
  const eligibilityState=eligibility.state==='INELIGIBLE'||roleCorroborated||eligibility.reasons.includes('ROLE_FAMILY_UNKNOWN')?eligibility.state:'UNKNOWN';
  const eligibilityReasonCode=eligibility.state==='INELIGIBLE'||roleCorroborated||eligibility.reasons.includes('ROLE_FAMILY_UNKNOWN')?eligibility.reason_code:'ROLE_TITLE_UNCONFIRMED';
  const fit=evaluateFitV2(preferences.fit_config,fitEvidence(row,payload,company,workMode,type));
  const score=fit.score;
  const pros=fit.matrix.filter(v=>v.weight&&v.grade===5).map(v=>v.criterion+': preferinta confirmata');
  const risks=fit.matrix.filter(v=>v.weight&&v.reason==='MISSING_DATA').map(v=>v.criterion+': date lipsa');
  if(!roleCorroborated)risks.unshift('Clasificarea rolului nu este confirmata de titlu');
  if(eligibility.state!=='ELIGIBLE')risks.unshift('Eligibilitate neconfirmata: '+eligibility.reason_code);

  const posted = canonicalPostedDate(row, now);
  const age = postedAgeHours(posted, now);
  const threshold = Number(preferences.fit_threshold ?? 80);
  const url = row.canonical_url || payload.final_url || payload.source_url || payload.url || null;
  const modeLabel = workMode === 'remote' ? 'Remote' : workMode === 'hybrid' ? 'Hybrid' : workMode === 'onsite' ? 'Onsite' : 'N/A';

  return {
    eligible:eligibility.state!=='INELIGIBLE'&&!eligibility.reasons.includes('ROLE_FAMILY_UNKNOWN'),
    eligibilityState,
    eligibilityReasonCode,
    score,
    pros:pros.slice(0, 2),
    risks:risks.slice(0, 2),
    exclusionReason:eligibility.state==='INELIGIBLE' ? compatibilityReasons[eligibility.reason_code] || eligibility.reason_code : null,
    job:{
      id:String(row.job_id),
      title,
      company,
      initial:company.split(/\s+/).slice(0,2).map(x => x[0]).join('').toUpperCase() || '?',
      eligibility_state:eligibilityState,
      eligibility_reason:eligibilityReasonCode,
      fit:score,
      fit_matrix:fit.matrix,
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
      b2b:['contract','freelance'].includes(type),
      repost,
      status:score != null && score >= threshold ? 'new' : 'review',
      pros:pros.slice(0,2),
      risks:risks.slice(0,2),
      url,
      description,
      ...sourcePostingDates(row,now),
      date_posted:posted,
      age_basis:posted ? 'posted_at' : 'unknown',
      source:row.source_name || payload.source || 'Nespecificata',
      verified_at:payload.verified_at || null,
      archived_at:row.archived_at || null,
    },
  };
}


export function materializeCachedJob(row, cached, preferences, now = new Date()) {
  const payload = { ...(row.payload || {}), ...(row.posting_payload || {}) };
  const title = String(row.title || payload.job_title || payload.title || '').trim();
  const company = String(row.company || payload.company || payload.company_name || '').trim();
  const workMode = mode(row, payload);
  const remote = workMode === 'remote';
  const countries = values(payload.countries);
  const countryCodes = [...new Set([...(row.country_codes || []), ...values(payload.country_codes), payload.country_code, payload.job_country_code]
    .map(x => String(x || '').trim().toUpperCase()).filter(x => /^[A-Z]{2}$/.test(x)))];
  const remoteScope = countryScope(payload, countryCodes, remote);
  const type = contractType(payload, row);
  const description = String(payload.description || '');
  const text = title + ' ' + description;
  const repost = Boolean(row.repost_of_posting_id || payload.reposted || payload.repost);
  const posted = canonicalPostedDate(row, now);
  const age = postedAgeHours(posted, now);
  const score = cached.score != null ? Number(cached.score) : null;
  const threshold = Number(preferences.fit_threshold ?? 80);
  const url = row.canonical_url || payload.final_url || payload.source_url || payload.url || null;
  const modeLabel = workMode === 'remote' ? 'Remote' : workMode === 'hybrid' ? 'Hybrid' : workMode === 'onsite' ? 'Onsite' : 'N/A';
  const pros = Array.isArray(cached.pros) ? cached.pros : [];
  const risks = Array.isArray(cached.risks) ? cached.risks : [];

  return {
    id:String(row.job_id),
    title,
    company,
    initial:company.split(/\s+/).slice(0,2).map(x => x[0]).join('').toUpperCase() || '?',
    eligibility_state:cached.eligibilityState,
    eligibility_reason:cached.eligibilityReasonCode,
    fit:score,
    fit_matrix:score===null?[]:evaluateFitV2(preferences.fit_config,fitEvidence(row,payload,company,workMode,type)).matrix,
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
    b2b:['contract','freelance'].includes(type),
    repost,
    status:score != null && score >= threshold ? 'new' : 'review',
    pros:pros.slice(0,2),
    risks:risks.slice(0,2),
    url,
    description,
    ...sourcePostingDates(row,now),
    date_posted:posted,
    age_basis:posted ? 'posted_at' : 'unknown',
    source:row.source_name || payload.source || 'Nespecificata',
    verified_at:payload.verified_at || null,
    archived_at:row.archived_at || null,
  };
}