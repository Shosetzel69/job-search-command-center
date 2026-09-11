import assert from 'node:assert/strict';
import test from 'node:test';

import { reviewRowsForFilters } from '../src/review-selection.mjs';

const ageHours = (_date, fallback = 0) => Number(fallback || 0);
const jobs = [
  { id: 'fresh-remote', status: 'review', age: 12, mode: 'Remote' },
  { id: 'old-remote', status: 'review', age: 140, mode: 'Remote' },
  { id: 'fresh-hybrid', status: 'review', age: 20, mode: 'Hybrid' },
  { id: 'new-job', status: 'new', age: 4, mode: 'Remote' },
];

test('review rows use the same freshness and work-mode eligibility as the review list', () => {
  assert.deepEqual(
    reviewRowsForFilters(jobs, { freshness: 24, workModes: ['Remote', 'Hybrid'] }, ageHours).map(job => job.id),
    ['fresh-remote', 'fresh-hybrid'],
  );
});

test('review rows change coherently when freshness or work modes change', () => {
  assert.deepEqual(
    reviewRowsForFilters(jobs, { freshness: 120, workModes: ['Remote'] }, ageHours).map(job => job.id),
    ['fresh-remote'],
  );
  assert.deepEqual(
    reviewRowsForFilters(jobs, { freshness: 168, workModes: ['Remote'] }, ageHours).map(job => job.id),
    ['fresh-remote', 'old-remote'],
  );
});
