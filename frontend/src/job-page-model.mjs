export const JOBS_PAGE_SIZE = 20;
export const JOBS_PAGE_SIZES = Object.freeze([20,30,40]);
export const jobPageSize = value => JOBS_PAGE_SIZES.includes(Number(value)) ? Number(value) : JOBS_PAGE_SIZE;

const MODE_CODE = Object.freeze({ Remote:'remote', Hybrid:'hybrid', Onsite:'onsite' });

export function isSearchProfileConfigured(criteria = {}) {
  const families = Array.isArray(criteria.roleFamilies) ? criteria.roleFamilies : [];
  const subfamilies = Array.isArray(criteria.roleSubfamilies) ? criteria.roleSubfamilies : [];
  const role = families.length > 0 && subfamilies.length > 0;
  const geography = Boolean(criteria.targetRegions?.length || criteria.targetCountries?.length);
  return role && geography;
}

export function buildJobsPath({ filters = {}, cursor = null, limit = jobPageSize(filters.pageSize), prefetch = jobPageSize(filters.pageSize), view = null, kpiFilter = 'all', countOnly = false, asOf = null, countBasis = null } = {}) {
  const params = new URLSearchParams();
  const boundedLimit = Math.min(40, Math.max(1, Number.isFinite(Number(limit)) ? Math.trunc(Number(limit)) : JOBS_PAGE_SIZE));
  const boundedPrefetch = Math.min(40, Math.max(0, Number.isFinite(Number(prefetch)) ? Math.trunc(Number(prefetch)) : JOBS_PAGE_SIZE));
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
  if (view) {
    if (filters.unknownFamily === true) params.append('role_family', 'UNKNOWN');
    for (const code of new Set(filters.roleSubfamilies || [])) params.append('role_subfamily', String(code));
    for (const code of new Set(filters.contractTypes || [])) params.append('contract_type', String(code));
    if (filters.minFit != null && filters.minFit !== '') params.set('min_fit', String(filters.minFit));
    if (filters.roleSubfamiliesNone === true) params.set('empty_role_subfamilies', 'true');
    if (filters.contractTypesNone === true) params.set('empty_contract_types', 'true');
    if(!countOnly){
      const [key,dir]=String(filters.sort||'fit-desc').split('-');
      params.set('sort',['fit','title','country','work_mode','publication','retrieve'].includes(key)?key:'publication');
      params.set('dir',dir==='asc'?'asc':'desc');
    }
    params.set('result_view',['jobs','review','unclassified','analysis','archived'].includes(view)?view:'jobs');
    params.set('quick',view==='unclassified'?'all':filters.quick||'all');
    params.set('kpi',view==='jobs'?kpiFilter:'all');
    if(Array.isArray(filters.workModes)&&filters.workModes.length===0)params.set('empty_modes','true');
  }
  if (countOnly) {
    params.set('count_only','true');
    if(asOf)params.set('as_of',asOf);
    if(countBasis)params.set('count_basis',countBasis);
  }
  if (cursor) params.set('cursor', String(cursor));
  return '/me/jobs?' + params.toString();
}

// Any filter or view change invalidates cursor history, including GUI-only filters.
export function pageRequestKey({filters = {}, view = 'jobs', kpiFilter = 'all'} = {}) {
  return JSON.stringify({
    path:buildJobsPath({filters,view,kpiFilter}),
    view, quick:filters.quick || 'all', sort:filters.sort || 'date', kpiFilter,
  });
}

// Only an unchanged server path can reuse the current first page.
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

// The same async transition drives both buttons, including ignored and expired cursors.
export async function navigateJobPage({direction, page, history, nextCursor, load}) {
  if (direction !== 'next' && direction !== 'previous') throw new Error('Invalid pagination direction');
  if ((direction === 'next' && !nextCursor) || (direction === 'previous' && page <= 1)) {
    return {outcome:'unavailable'};
  }
  const cursor = direction === 'next' ? nextCursor : (history[page - 2] || null);
  const result = await load(cursor);
  if (result?.restarted) return {outcome:'restarted'};
  if (result?.ignored) return {outcome:'ignored'};
  const updatedHistory = [...history];
  if (direction === 'next') updatedHistory[page] = cursor;
  return {outcome:'loaded',page:page+(direction === 'next' ? 1 : -1),history:updatedHistory};
}

export function validateJobsPage(payload) {
  if (!['2.0','3.0'].includes(payload?.schema_version) || payload?.bounded !== true || !Array.isArray(payload?.jobs)) {
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

// Read-only count scan, same query scope as visible page, bounded per request
// and overall. A partial or stale scan must never become a displayed total.
export async function scanResultCount({load,basis,anchor,isCurrent=()=>true,maxBatches=32}) {
  if(!basis||!anchor)return null;
  let cursor=null,total=0;
  const seen=new Set();
  for(let batch=0;batch<maxBatches&&isCurrent();batch++){
    const next=await load(cursor);
    if(!isCurrent()||next?.count_only!==true||next.count_basis!==basis||next.generated_at!==anchor||!Number.isSafeInteger(next.results)||next.results<0)return null;
    total+=next.results;
    cursor=next.next_cursor||null;
    if(!cursor)return total;
    if(seen.has(cursor))return null;
    seen.add(cursor);
  }
  return null;
}
