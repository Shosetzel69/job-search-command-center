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

export function protectedDataPaths() {
  return new Set(PROTECTED_DATA_FILES.map(file => `/data/${file}`));
}
