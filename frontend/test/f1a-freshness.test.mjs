import test from 'node:test';
import assert from 'node:assert/strict';
import { jobViewPopulation, jobViewCounts } from '../src/job-count-model.mjs';
import { reviewRowsForFilters } from '../src/review-selection.mjs';

const ageHours = (_posted, age) => age;
const mode = ['Remote','Hybrid','Onsite'];
const undated = { id:'unknown', fit:70, date_posted:null, age:null, mode:'Remote', b2b:true };
const newJob = { id:'new', fit:75, date_posted:'2026-10-12', age:23, mode:'Remote' };
const older = { id:'older', fit:75, date_posted:'2026-10-11', age:25, mode:'Remote' };

test('RV-5 undated is visible in eligible population and De evaluat, not new24h', () => {
  const all = jobViewPopulation([undated,newJob,older], { freshness:24, workModes:mode }, ageHours);
  assert.deepEqual(all.map(x=>x.id), ['unknown','new']);
  assert.deepEqual(reviewRowsForFilters([undated,newJob,older], { freshness:24,workModes:mode }, ageHours,80).map(x=>x.id), ['unknown','new']);
  assert.equal(jobViewCounts(all,80,ageHours).new24h,1);
  assert.equal(jobViewCounts(all,80,ageHours).b2b,1);
});

test('freshness 30d retains undated and old dated jobs but new24h stays precise',()=>{
  const all = jobViewPopulation([undated,newJob,older], { freshness:720, workModes:mode }, ageHours);
  assert.equal(all.length,3);
  assert.equal(jobViewCounts(all,80,ageHours).new24h,1);
});

test('missing age cannot use JS coercion to claim new24h',()=>{
  assert.equal(jobViewCounts([undated],80,ageHours).new24h,0);
  const invalid={...undated,age:undefined};
  assert.equal(jobViewCounts([invalid],80,ageHours).new24h,0);
});
