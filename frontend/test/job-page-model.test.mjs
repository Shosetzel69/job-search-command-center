import test from 'node:test';
import assert from 'node:assert/strict';
import { buildJobsPath, JOBS_PAGE_SIZE, pageBounds, isSearchProfileConfigured, mergeJobPages, refreshOutcomeNotice, validateJobsPage } from '../src/job-page-model.mjs';

test('canonical job query is bounded, profile-scoped and provider-free', () => {
  const path = buildJobsPath({
    filters:{search:'technical pm',freshness:48,workModes:['Remote']},
    cursor:'cursor-1',
    limit:25,
    prefetch:10,
  });
  assert.match(path, /^\/me\/jobs\?/);
  assert.match(path, /q=technical\+pm/);
  assert.match(path, /freshness_hours=48/);
  assert.match(path, /work_mode=remote/);
  assert.match(path, /cursor=cursor-1/);
  assert.doesNotMatch(path, /provider|retrieve|source/);
});

test('empty onboarding profile does not qualify for job retrieval', () => {
  assert.equal(isSearchProfileConfigured({}), false);
  assert.equal(isSearchProfileConfigured({
    roleFamilies:['PROJECT_DELIVERY_MANAGEMENT'],
    roleSubfamilies:['project_management'],
    targetRegions:['EU'],
    workRemote:true,
    contractTypes:['contract'],
  }), true);
});

test('bounded job page validation and append dedupe preserve canonical job identity', () => {
  const page = validateJobsPage({schema_version:'2.0',bounded:true,jobs:[{id:'a'}]});
  assert.equal(page.jobs.length,1);
  assert.deepEqual(mergeJobPages([{id:'a',fit:1}],[{id:'a',fit:2},{id:'b'}]),[{id:'a',fit:2},{id:'b'}]);
});

test('refresh outcome mapping distinguishes reuse, join, start and policy block', () => {
  assert.equal(refreshOutcomeNotice({outcome:'REUSED_CORPUS'}).terminal,true);
  assert.equal(refreshOutcomeNotice({outcome:'JOINED_EXISTING_RUN'}).terminal,false);
  assert.equal(refreshOutcomeNotice({outcome:'STARTED_RUN'}).terminal,false);
  assert.equal(refreshOutcomeNotice({outcome:'BLOCKED_BY_POLICY'}).type,'error');
});

test('F-04 page size never exceeds twenty and defaults to twenty', () => {
  assert.equal(JOBS_PAGE_SIZE, 20);
  assert.equal(new URL(buildJobsPath(), 'https://jscc.example').searchParams.get('limit'), '20');
  assert.equal(new URL(buildJobsPath({limit:500}), 'https://jscc.example').searchParams.get('limit'), '20');
  assert.equal(new URL(buildJobsPath({limit:1}), 'https://jscc.example').searchParams.get('limit'), '1');
});

test('F-04 navigation reports exact page boundaries for a known database total', () => {
  assert.deepEqual(pageBounds(1, 41), {page:1,pageCount:3,canPrevious:false,canNext:true});
  assert.deepEqual(pageBounds(2, 41), {page:2,pageCount:3,canPrevious:true,canNext:true});
  assert.deepEqual(pageBounds(3, 41), {page:3,pageCount:3,canPrevious:true,canNext:false});
  assert.equal(pageBounds(99, 41).page, 3);
  assert.equal(pageBounds(1, 0).pageCount, 1);
});

test('F-04 no invented page total while the database aggregate is unknown', () => {
  assert.deepEqual(pageBounds(1, null), {page:1,pageCount:null,canPrevious:false,canNext:null});
});
