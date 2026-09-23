export function jobViewPopulation(jobs = [], filters = {}, ageHours) {
  const freshness = Number(filters.freshness ?? 24);
  const workModes = Array.isArray(filters.workModes) ? filters.workModes : [];
  return jobs.filter(job =>
    ageHours(job.date_posted, job.age) <= freshness
    && workModes.includes(job.mode)
  );
}

export function jobViewCounts(population = [], threshold = 80, ageHours) {
  return {
    all: population.length,
    high: population.filter(job => job.fit !== null && job.fit !== undefined && job.fit >= threshold).length,
    b2b: population.filter(job => job.b2b).length,
    new24h: population.filter(job => ageHours(job.date_posted, job.age) <= 24).length,
    reposts: population.filter(job => job.repost).length,
    remote: population.filter(job => job.mode === 'Remote').length,
  };
}

export function jobCountScopeLabel(freshness) {
  const hours = Number(freshness ?? 24);
  return hours === 120 ? 'filtrul curent: 5 zile + mod lucru' : `filtrul curent: ${hours}h + mod lucru`;
}
