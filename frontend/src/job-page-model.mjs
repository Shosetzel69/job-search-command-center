export const JOBS_PAGE_SIZE = 20;

// The API owns the dataset and cursor. Never infer a global total from a page.
export function pageBounds(page, total, pageSize = JOBS_PAGE_SIZE) {
  const safeTotal = Number.isInteger(total) && total >= 0 ? total : null;
  const count = safeTotal === null ? null : Math.max(1, Math.ceil(safeTotal / pageSize));
  const current = Math.max(1, Number.isInteger(page) ? page : 1);
  const resolved = count === null ? current : Math.min(current, count);
  return { page:resolved, pageCount:count, canPrevious:resolved > 1,
    canNext:count === null ? null : resolved < count };
}

const MODE_CODE = Object.freeze({ Remote:'remote', Hybrid:'hybrid', Onsite:'onsite' });

export function isSearchProfileConfigured(criteria = {}) {
  const families = Array.isArray(criteria.roleFamilies) ? criteria.roleFamilies : [];
  const subfamilies = Array.isArray(criteria.roleSubfamilies) ? criteria.roleSubfamilies : [];
  const role = families.length > 0 && subfamilies.length > 0;
  const geography = Boolean(criteria.targetRegions?.length || criteria.targetCountries?.length);
  const workMode = Boolean(criteria.workRemote || criteria.workHybrid || criteria.workOnsite);
  const contract = Array.isArray(criteria.contractTypes) && criteria.contractTypes.length > 0;
  return role && geography && workMode && contract;
}

export function buildJobsPath({ filters = {}, cursor = null, limit = JOBS_PAGE_SIZE, prefetch = JOBS_PAGE_SIZE } = {}) {
  const params = new URLSearchParams();
  const boundedLimit = Math.min(JOBS_PAGE_SIZE, Math.max(1, Number.isFinite(Number(limit)) ? Math.trunc(Number(limit)) : JOBS_PAGE_SIZE));
  const boundedPrefetch = Math.min(JOBS_PAGE_SIZE, Math.max(0, Number.isFinite(Number(prefetch)) ? Math.trunc(Number(prefetch)) : JOBS_PAGE_SIZE));
  params.set('limit', String(boundedLimit));
  params.set('prefetch', String(boundedPrefetch));
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

// Any filter or view change invalidates cursor history, including GUI-only filters.
export function pageRequestKey({filters = {}, view = 'jobs', kpiFilter = 'all'} = {}) {
  return JSON.stringify({
    path:buildJobsPath({filters}),
    view, quick:filters.quick || 'all', sort:filters.sort || 'date', kpiFilter,
  });
}

// GUI-only filters change presentation, not the server cursor query.
export function needsPageReload({page = 1, loadedServerPath = '', nextServerPath = ''} = {}) {
  return page !== 1 || !loadedServerPath || loadedServerPath !== nextServerPath;
}

// Ignore outdated navigation without leaving the current page permanently loading.
export function ignorePageResponse({requestSerial, currentSerial, append, navigationContext, currentContext}, setPage) {
  if (requestSerial !== currentSerial) return true;
  if (!append || navigationContext === currentContext) return false;
  setPage(current => ({...current, loading:false, loadingMore:false}));
  return true;
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