export const UI_STATE_KEY = 'jscc-ui-state-v1';

const VIEWS = new Set(['jobs','review','applications','criteria','admin']);
const QUICK = new Set(['all','high','b2b']);
const SORTS = new Set(['fit-desc','fit-asc']);
const MODES = new Set(['Remote','Hybrid','Onsite']);

function finiteNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function cleanFilters(input = {}) {
  const modes = Array.isArray(input.workModes)
    ? [...new Set(input.workModes.filter(mode => MODES.has(mode)))]
    : ['Remote','Hybrid','Onsite'];
  return {
    search:String(input.search || '').slice(0, 200),
    quick:QUICK.has(input.quick) ? input.quick : 'all',
    freshness:finiteNumber(input.freshness, null),
    workModes:modes,
    sort:SORTS.has(input.sort) ? input.sort : 'fit-desc',
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

export function readUiState(storage = globalThis?.sessionStorage) {
  if (!storage?.getItem) return sanitizeUiState();
  try {
    const parsed = JSON.parse(storage.getItem(UI_STATE_KEY) || '{}');
    if (parsed?.schema_version !== 1) return sanitizeUiState();
    return sanitizeUiState(parsed);
  } catch {
    return sanitizeUiState();
  }
}

export function writeUiState(input, storage = globalThis?.sessionStorage) {
  if (!storage?.setItem) return false;
  try {
    storage.setItem(UI_STATE_KEY, JSON.stringify(sanitizeUiState(input)));
    return true;
  } catch {
    return false;
  }
}
