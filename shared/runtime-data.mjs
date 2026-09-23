export const PROTECTED_DATA_FILES = Object.freeze([
  'jobs.json',
  'run-status.json',
  'run-history.json',
  'search-config.json',
  'sources.json',
  'source-categories.json',
  'nomenclatures.json',
  'applications.json',
]);

export const INTERNAL_DATA_FILES = Object.freeze([
  'search-state.json',
]);

// Source-controlled shared/product files that may be reconciled independently
// into each isolated runtime. This is intentionally not the protected-data
// list: environment-owned/personal/runtime state must never be promoted by
// generic release automation.
export const CANDIDATE_MANAGED_DATA_FILES = Object.freeze([
  'sources.json',
  'source-categories.json',
  'nomenclatures.json',
]);

export function protectedDataPaths() {
  return new Set(PROTECTED_DATA_FILES.map(file => `/data/${file}`));
}
