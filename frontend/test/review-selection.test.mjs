import assert from 'node:assert/strict';
import test from 'node:test';

import { reviewRowsForFilters } from '../src/review-selection.mjs';

const ageHours = (_date, fallback = 0) => Number(fallback || 0);
const jobs = [
  { id:'fresh-remote', status:'review', age:12, mode:'Remote', fit:70 },
  { id:'old-remote', status:'review', age:140, mode:'Remote', fit:65 },
  { id:'fresh-hybrid', status:'review', age:20, mode:'Hybrid', fit:75 },
  { id:'stale-new-low-fit', status:'new', age:4, mode:'Remote', fit:55 },
  { id:'stale-review-high-fit', status:'review', age:4, mode:'Remote', fit:92 },
  { id:'unknown-mode', status:'new', age:6, mode:'N/A', fit:60 },
];

test('review rows derive from current FIT threshold, not stale backend status', () => {
  assert.deepEqual(
    reviewRowsForFilters(jobs,{freshness:24,workModes:['Remote','Hybrid']},ageHours,80).map(job=>job.id),
    ['fresh-remote','fresh-hybrid','stale-new-low-fit'],
  );
});

test('changing threshold reclassifies review rows without rerun', () => {
  assert.deepEqual(
    reviewRowsForFilters(jobs,{freshness:24,workModes:['Remote','Hybrid']},ageHours,60).map(job=>job.id),
    ['stale-new-low-fit'],
  );
});

test('work mode Toate includes technical N/A in review presentation', () => {
  assert.deepEqual(
    reviewRowsForFilters(jobs,{freshness:24,workModes:['Remote','Hybrid','Onsite']},ageHours,80).map(job=>job.id),
    ['fresh-remote','fresh-hybrid','stale-new-low-fit','unknown-mode'],
  );
});

test('review rows still honor freshness and subset work-mode filters', () => {
  assert.deepEqual(
    reviewRowsForFilters(jobs,{freshness:168,workModes:['Remote']},ageHours,80).map(job=>job.id),
    ['fresh-remote','old-remote','stale-new-low-fit'],
  );
});
