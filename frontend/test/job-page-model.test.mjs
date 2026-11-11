import test from 'node:test';
import assert from 'node:assert/strict';
import { JOBS_PAGE_SIZE, buildJobsPath, pageBounds, pageRequestKey, isSearchProfileConfigured, mergeJobPages, refreshOutcomeNotice, validateJobsPage } from '../src/job-page-model.mjs';

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
test('pagination is 20 per page without FIT ranking or provider requests', () => {
  assert.equal(JOBS_PAGE_SIZE,20);
  for (const [limit,prefetch,expectedLimit,expectedPrefetch] of [[undefined,undefined,20,20],[500,100,20,20],[1,0,1,0]]) {
    const url=new URL(buildJobsPath({limit,prefetch}), 'https://jscc.example');
    assert.equal(url.searchParams.get('limit'),String(expectedLimit));
    assert.equal(url.searchParams.get('prefetch'),String(expectedPrefetch));
    assert.equal(url.searchParams.has('sort_fit'),false);
  }
});

test('pagination bounds are honest when global total is unknown', () => {
  assert.deepEqual(pageBounds(1,41),{page:1,pageCount:3,canPrevious:false,canNext:true});
  assert.deepEqual(pageBounds(3,41),{page:3,pageCount:3,canPrevious:true,canNext:false});
  assert.deepEqual(pageBounds(99,41),{page:3,pageCount:3,canPrevious:true,canNext:false});
  assert.deepEqual(pageBounds(1,null),{page:1,pageCount:null,canPrevious:false,canNext:null});
  assert.equal(pageBounds(1,0).pageCount,1);
});

test('cursor context changes whenever visible filters, sort or view change', () => {
  const baseline={filters:{search:'project',freshness:24,workModes:['Remote'],quick:'all',sort:'date'},view:'jobs',kpiFilter:'all'};
  const key=pageRequestKey(baseline);
  for(const modified of [
    {...baseline,view:'review'},
    {...baseline,kpiFilter:'high'},
    {...baseline,filters:{...baseline.filters,quick:'b2b'}},
    {...baseline,filters:{...baseline.filters,sort:'fit-desc'}},
    {...baseline,filters:{...baseline.filters,search:'architect'}},
    {...baseline,filters:{...baseline.filters,freshness:48}},
  ]) assert.notEqual(pageRequestKey(modified),key);
});
