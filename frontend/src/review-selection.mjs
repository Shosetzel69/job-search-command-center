const CANONICAL_WORK_MODES = ['Remote', 'Hybrid', 'Onsite'];

function allCanonicalWorkModesSelected(workModes = []) {
  const selected = new Set(workModes);
  return CANONICAL_WORK_MODES.every(mode => selected.has(mode));
}

export function reviewRowsForFilters(jobs, { freshness, workModes }, ageHours, threshold = 80) {
  const allowedModes = new Set(workModes || []);
  const noWorkModePresentationFilter = allCanonicalWorkModesSelected(workModes || []);
  return (jobs || []).filter(job => {
    const fit = Number(job?.fit);
    const reviewByCurrentThreshold = !Number.isFinite(fit) || fit < threshold;
    return reviewByCurrentThreshold
      && ageHours(job.date_posted, job.age) <= freshness
      && (noWorkModePresentationFilter || allowedModes.has(job.mode));
  });
}
