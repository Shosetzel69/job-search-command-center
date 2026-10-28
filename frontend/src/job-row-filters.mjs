export function isNewWithin24Hours(job, ageHours) {
  const age = ageHours(job.date_posted, job.age);
  return age !== null && Number.isFinite(age) && age <= 24;
}

export function compareAgeNullsLast(a, b) {
  const left = a?.age, right = b?.age;
  const lv = left !== null && Number.isFinite(left);
  const rv = right !== null && Number.isFinite(right);
  if (!lv && !rv) return 0;
  if (!lv) return 1;
  if (!rv) return -1;
  return left - right;
}

export function filterAndSortJobRows(baseRows, { view, filters, threshold, kpiFilter, ageHours }) {
  if (view === 'applications') return [...baseRows];
  const q = (filters.search || '').trim().toLowerCase();
  const rows = baseRows.filter(job => {
    const quick = filters.quick === 'all'
      || (filters.quick === 'high' && job.fit !== null && job.fit >= threshold)
      || (filters.quick === 'b2b' && job.b2b);
    const kpi = kpiFilter === 'all'
      || (kpiFilter === 'new' && isNewWithin24Hours(job, ageHours))
      || (kpiFilter === 'high' && job.fit !== null && job.fit >= threshold)
      || (kpiFilter === 'repost' && job.repost)
      || (kpiFilter === 'remote' && job.mode === 'Remote');
    const text = (job.title + ' ' + job.company + ' ' + job.description + ' ' + job.source + ' ' + job.location + ' ' + (job.countries || []).join(' ')).toLowerCase();
    return quick && kpi && (!q || text.includes(q));
  });
  return [...rows].sort((a,b) => {
    const fit = filters.sort === 'fit-asc'
      ? (a.fit ?? Number.MAX_SAFE_INTEGER) - (b.fit ?? Number.MAX_SAFE_INTEGER)
      : (b.fit ?? -1) - (a.fit ?? -1);
    return fit || compareAgeNullsLast(a,b);
  });
}
