import { ROLE_FAMILIES } from '../../shared/role-taxonomy-runtime.mjs';
import nomenclatures from '../../data/nomenclatures.json' with { type:'json' };

export const UI_STATE_KEY = 'jscc-ui-state-v1';

const VIEWS = new Set(['jobs','review','unclassified','applications','criteria','admin']);
const SORTS = new Set(['fit','title','country','work_mode','publication','retrieve'].flatMap(key=>['asc','desc'].map(dir=>key+'-'+dir)));
const MODES = new Set(['Remote','Hybrid','Onsite']);
const ROLE_CODES=new Set(ROLE_FAMILIES.flatMap(family=>family.subfamilies.map(role=>role.code)));
const CONTRACT_CODES=new Set((nomenclatures.domains?.contract_types?.values||[]).filter(value=>value.active).map(value=>value.code));

function cleanSelection(value, allowed) {
  const raw=Array.isArray(value)?value:[];
  const selected=[...new Set(raw.filter(code=>typeof code==='string'&&allowed.has(code)))];
  return {selected,allInvalid:raw.length>0&&selected.length===0};
}

function finiteNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function cleanFilters(input = {}) {
  const roles=cleanSelection(input.roleSubfamilies,ROLE_CODES);
  const contracts=cleanSelection(input.contractTypes,CONTRACT_CODES);
  const modes = Array.isArray(input.workModes)
    ? [...new Set(input.workModes.filter(mode => MODES.has(mode)))]
    : ['Remote','Hybrid','Onsite'];
  return {
    search:String(input.search || '').slice(0, 200),
    quick:'all',
    freshness:finiteNumber(input.freshness, null),
    workModes:modes,
    roleSubfamilies:input.roleSubfamiliesNone===true?[]:roles.selected,
    contractTypes:input.contractTypesNone===true?[]:contracts.selected,
    // Obsolete choices fail closed instead of showing ALL while sending a hidden code.
    roleSubfamiliesNone:input.roleSubfamiliesNone===true||roles.allInvalid,
    contractTypesNone:input.contractTypesNone===true||contracts.allInvalid,
    minFit:input.minFit===''||input.minFit==null?'':(Number.isInteger(Number(input.minFit))&&Number(input.minFit)>=0&&Number(input.minFit)<=100?String(Number(input.minFit)):'') ,
    sort:SORTS.has(input.sort) ? input.sort : 'fit-desc',
    ...(input.pageSize!=null?{pageSize:[20,30,40].includes(Number(input.pageSize))?Number(input.pageSize):20}:{}),
  };
}

export function sanitizeUiState(input = {}) {
  return {
    schema_version:1,
    view:VIEWS.has(input.view) ? input.view : 'jobs',
    filters:cleanFilters(input.filters),
    selectedJobId:input.selectedJobId ? String(input.selectedJobId) : null,
    scrollY:Math.max(0, finiteNumber(input.scrollY, 0)),
  };
}

function browserSessionStorage() {
  try { return globalThis.sessionStorage; } catch { return null; }
}

export function readUiState(storage = browserSessionStorage()) {
  if (!storage?.getItem) return sanitizeUiState();
  try {
    const parsed = JSON.parse(storage.getItem(UI_STATE_KEY) || '{}');
    if (parsed?.schema_version !== 1) return sanitizeUiState();
    return sanitizeUiState(parsed);
  } catch {
    return sanitizeUiState();
  }
}

export function writeUiState(input, storage = browserSessionStorage()) {
  if (!storage?.setItem) return false;
  try {
    storage.setItem(UI_STATE_KEY, JSON.stringify(sanitizeUiState(input)));
    return true;
  } catch {
    return false;
  }
}

// UI return context is tab-local but not user-scoped. Remove it on every sign-out.
export function clearUiState(storage = browserSessionStorage()) {
  if (!storage?.removeItem) return false;
  try {
    storage.removeItem(UI_STATE_KEY);
    return true;
  } catch {
    return false;
  }
}
