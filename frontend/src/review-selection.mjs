export function reviewRowsForFilters(jobs, { freshness, workModes }, ageHours) {
  const allowedModes = new Set(workModes || []);
  return (jobs || []).filter(job =>
    job?.status === 'review' &&
    ageHours(job.date_posted, job.age) <= freshness &&
    allowedModes.has(job.mode)
  );
}
