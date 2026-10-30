// Shared by API and frontend; quality is independent of FIT and review selection.
const LABELS = new Map([
  ['INVALID_LOCATION','Locație incorectă'],
  ['INCOMPLETE_DESCRIPTION','Descriere incompletă'],
  ['NON_JOB_PAGE','Pagina sursă nu este un anunț de angajare'],
  ['SUSPECT_APPLY_URL','URL de aplicare suspect'],
  ['SUSPECT_LOCATION','Locație suspectă'],
  ['MISSING_DESCRIPTION','Descriere lipsă'],
]);
export function locationQualityCodes(location) {
  const value = String(location || '').trim();
  if (!value) return [];
  if (/<[^>]+>/.test(value) || /https?:\/\//i.test(value) || value.length > 240) return ['INVALID_LOCATION'];
  // Navigation text scraped instead of a place: require multiple distinctive
  // website-navigation terms, rather than rejecting unfamiliar real locations.
  const navigationTerms = [/\bfor freelancers\b/i,/\bfind projects\b/i,/\bbenefits for freelancers\b/i,
    /\bprices and features\b/i,/\bprivacy preference\b/i,/\bcookie consent\b/i];
  if (navigationTerms.filter(term => term.test(value)).length >= 2) return ['SUSPECT_LOCATION'];
  return [];
}
export function qualityIssueCodes(job = {}) {
  const explicit = Array.isArray(job.data_quality_issues) ? job.data_quality_issues :
    Array.isArray(job.quality_issues) ? job.quality_issues : [];
  return [...explicit, ...locationQualityCodes(job.location)];
}
export function jobQualityWarnings(job = {}) {
  const reasons = qualityIssueCodes(job).map(item => {
    if (typeof item === 'string') {
      const value=item.trim();
      return LABELS.get(value) || value;
    }
    if (!item || typeof item !== 'object' || Array.isArray(item)) return '';
    const code=String(item.code || item.reason_code || '').trim();
    return String(item.message || item.reason || LABELS.get(code) || '').trim();
  }).filter(reason => typeof reason === 'string' && reason.trim());
  return [...new Set(reasons)];
}
