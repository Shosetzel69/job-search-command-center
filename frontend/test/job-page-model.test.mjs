import test from 'node:test';
import assert from 'node:assert/strict';
import { buildJobsPath, isSearchProfileConfigured, mergeJobPages, refreshOutcomeNotice, validateJobsPage } from '../src/job-page-model.mjs';

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
    rolePm:true,
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
