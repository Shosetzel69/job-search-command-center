
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildJobsPath, JOBS_PAGE_SIZE } from '../src/job-page-model.mjs';
import { filterAndSortJobRows } from '../src/job-row-filters.mjs';

const root = new URL('../../', import.meta.url);
const source = path => readFileSync(new URL(path, root), 'utf8');

test('591: B2B filter is sent to backend before pagination', () => {
  const all = buildJobsPath({ filters:{quick:'all'} });
  const b2b = buildJobsPath({ filters:{quick:'b2b'} });
  assert.notEqual(all, b2b);
  assert.equal(new URL(b2b, 'https://test.invalid').searchParams.get('b2b'), 'true');
  assert.equal(JOBS_PAGE_SIZE, 20);
});

test('591: UNKNOWN uses a distinct backend population', () => {
  const url = new URL(buildJobsPath({
    filters:{quick:'unknown'}
  }), 'https://test.invalid');
  assert.equal(url.searchParams.get('eligibility'), 'unknown');
});

test('591: switching filters changes the pagination request identity', () => {
  const filters = [
    {quick:'all',sort:'fit-desc'},
    {quick:'b2b',sort:'fit-desc'},
    {quick:'unknown',sort:'fit-desc'},
    {quick:'all',sort:'fit-asc'}
  ];
  const keys = filters.map(f => buildJobsPath({filters:f}));
  assert.equal(new Set(keys).size, keys.length);
});

test('591: unknown jobs have no FIT and are excluded from normal rows', () => {
  const unknown = {
    id:'unknown',title:'Unclassified',company:'Example',
    description:'',source:'',location:'',countries:[],
    fit:null,b2b:false,mode:'N/A',age:null,
    eligibility_state:'UNKNOWN'
  };
  const eligible = {
    ...unknown,id:'eligible',fit:85,eligibility_state:'ELIGIBLE'
  };
  const args = {
    view:'jobs',threshold:80,kpiFilter:'all',
    ageHours:() => null
  };
  const all = filterAndSortJobRows(
    [unknown,eligible], {...args,filters:{quick:'all',sort:'fit-desc'}}
  );
  const unclassified = filterAndSortJobRows(
    [unknown,eligible], {...args,filters:{quick:'unknown',sort:'fit-desc'}}
  );
  assert.deepEqual(all.map(j=>j.id), ['eligible']);
  assert.deepEqual(unclassified.map(j=>j.id), ['unknown']);
  assert.equal(unclassified[0].fit,null);
});

test('591: backend does not score unknown eligibility', () => {
  const code = source('command-api/src/profile-evaluation.js');
  assert.match(code, /eligibility\.state === 'UNKNOWN'/);
  assert.match(code, /eligibilityState:'UNKNOWN'/);
  assert.match(code, /score:null/);
});

test('591: incomplete backend rankings are not advertised as global', () => {
  const code = source('command-api/src/multiuser-repository.js');
  assert.match(code, /PARTIAL_UNVERIFIED/);
  assert.match(code, /GLOBAL_VERIFIED/);
});

test('591: unknown classification has a persisted reason', () => {
  const code = source('command-api/src/multiuser-repository.js');
  assert.match(code, /eligibility_reason_code/);
  assert.match(code, /ELIGIBILITY_UNKNOWN/);
});
