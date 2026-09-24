import test from 'node:test';
import assert from 'node:assert/strict';
import { jobCountScopeLabel, jobViewCounts, jobViewPopulation } from '../src/job-count-model.mjs';

const ageHours = (_datePosted, age) => age;
const jobs = [
  { id:'a', age:10, mode:'Remote', fit:90, b2b:true, repost:false },
  { id:'b', age:30, mode:'Remote', fit:85, b2b:false, repost:true },
  { id:'c', age:80, mode:'Hybrid', fit:95, b2b:true, repost:false },
  { id:'d', age:10, mode:'Onsite', fit:60, b2b:false, repost:false },
];

test('Joburi noi counts derive from one freshness/work-mode population', () => {
  const population = jobViewPopulation(jobs,{freshness:48,workModes:['Remote','Hybrid']},ageHours);
  assert.deepEqual(population.map(job => job.id), ['a','b']);
  assert.deepEqual(jobViewCounts(population,80,ageHours), {
    all:2, high:2, b2b:1, new24h:1, reposts:1, remote:2,
  });
});

test('freshness changes displayed population but not underlying jobs', () => {
  const pop24 = jobViewPopulation(jobs,{freshness:24,workModes:['Remote','Hybrid']},ageHours);
  const pop120 = jobViewPopulation(jobs,{freshness:120,workModes:['Remote','Hybrid']},ageHours);
  assert.equal(jobViewCounts(pop24,80,ageHours).all,1);
  assert.equal(jobViewCounts(pop120,80,ageHours).all,3);
  assert.equal(jobs.length,4);
});

test('scope labels explain current population', () => {
  assert.equal(jobCountScopeLabel(24),'filtrul curent: 24h + mod lucru');
  assert.equal(jobCountScopeLabel(120),'filtrul curent: 5 zile + mod lucru');
});
