const MODE_CODE = Object.freeze({ Remote:'remote', Hybrid:'hybrid', Onsite:'onsite' });

export function isSearchProfileConfigured(criteria = {}) {
  const role = Boolean(criteria.rolePm || criteria.roleDelivery || criteria.roleService || criteria.roleScrum || criteria.roleProgram);
  const geography = Boolean(criteria.targetRegions?.length || criteria.targetCountries?.length);
  const workMode = Boolean(criteria.workRemote || criteria.workHybrid || criteria.workOnsite);
  const contract = Array.isArray(criteria.contractTypes) && criteria.contractTypes.length > 0;
  return role && geography && workMode && contract;
}

export function buildJobsPath({ filters = {}, cursor = null, limit = 25, prefetch = 25 } = {}) {
  const params = new URLSearchParams();
  params.set('limit', String(limit));
  params.set('prefetch', String(prefetch));
  const q = String(filters.search || '').trim();
  if (q) params.set('q', q.slice(0, 200));
  const freshness = Number(filters.freshness);
  if (Number.isInteger(freshness) && freshness > 0) params.set('freshness_hours', String(freshness));
  const modes = Array.isArray(filters.workModes) ? filters.workModes : [];
  if (modes.length > 0 && modes.length < Object.keys(MODE_CODE).length) {
    for (const mode of modes) if (MODE_CODE[mode]) params.append('work_mode', MODE_CODE[mode]);
  }
  if (cursor) params.set('cursor', String(cursor));
  return '/me/jobs?' + params.toString();
}

export function validateJobsPage(payload) {
  if (payload?.schema_version !== '2.0' || payload?.bounded !== true || !Array.isArray(payload?.jobs)) {
    throw new Error('me/jobs: invalid bounded profile-job contract');
  }
  return payload;
}

export function mergeJobPages(current = [], incoming = [], key = job => String(job?.id || '')) {
  const rows = new Map();
  for (const job of [...current, ...incoming]) {
    const id = key(job);
    if (id) rows.set(id, job);
  }
  return [...rows.values()];
}

export function refreshOutcomeNotice(result = {}) {
  switch (result.outcome) {
    case 'REUSED_CORPUS':
      return { type:'success', message:'Corpusul partajat este deja proaspat. Rezultatele au fost reincarcate.', terminal:true };
    case 'JOINED_EXISTING_RUN':
      return { type:'info', message:'Exista deja o actualizare globala in curs. Nu a fost pornita o rulare duplicata.', terminal:false };
    case 'STARTED_RUN':
      return { type:'info', message:'Actualizarea globala a joburilor a fost pornita.', terminal:false };
    case 'BLOCKED_BY_POLICY':
      return { type:'error', message:'Actualizarea este blocata de politica mediului curent.', terminal:true };
    default:
      return { type:'error', message:'Raspuns necunoscut de la actualizarea joburilor.', terminal:true };
  }
}
