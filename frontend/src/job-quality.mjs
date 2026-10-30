// Explicit quality signals only; no FIT / review / archive side effects.
const LABELS = Object.freeze({
  INVALID_LOCATION:'Locație incorectă',
  INCOMPLETE_DESCRIPTION:'Descriere incompletă',
  NON_JOB_PAGE:'Pagina sursă nu este un anunț de angajare',
  SUSPECT_APPLY_URL:'URL de aplicare suspect',
  SUSPECT_LOCATION:'Locație suspectă',
  MISSING_DESCRIPTION:'Descriere lipsă',
});
export function jobQualityWarnings(job = {}) {
  const explicit = Array.isArray(job.data_quality_issues) ? job.data_quality_issues
    : Array.isArray(job.quality_issues) ? job.quality_issues : [];
  const reasons = explicit.map(item => {
    if (typeof item === 'string') return LABELS[item] || item.trim();
    if (!item || typeof item !== 'object') return '';
    const code = String(item.code || item.reason_code || '').trim();
    return String(item.message || item.reason || LABELS[code] || '').trim();
  }).filter(Boolean);
  // Conservative checks: avoid flagging all historical sparse job descriptions.
  const location = String(job.location || '');
  if (/<[^>]+>/.test(location) || /^https?:\/\//i.test(location)
    || location.length > 240) reasons.push(LABELS.INVALID_LOCATION);
  return [...new Set(reasons)];
}
