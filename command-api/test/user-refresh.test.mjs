import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import { decideUserRefresh, userRefresh } from '../src/user-refresh.js';
import { sharedCorpusRefreshState } from '../src/multiuser-repository.js';

const SHA = '1'.repeat(40);
const RUNTIME_SHA = '2'.repeat(40);
const baseEnv = {
  APP_ENV:'dev',
  JSCC_RUNTIME_BACKEND:'gcp',
  GCP_PROJECT_ID:'jscc-dev',
  GCP_RUNTIME_BUCKET:'jscc-dev-runtime-test',
  GCP_SEARCH_JOB:'jscc-dev-search',
  GCP_REGION:'europe-west1',
  SOURCE_SHA:SHA,
  RUNTIME_DATA_SHA:RUNTIME_SHA,
  SEARCH_MODE:'disabled',
  FRONTEND_ORIGIN:'https://dev.example.test',
};
const user = { user_id:'user-1', profile_id:'profile-1', role:'USER', status:'ACTIVE' };

function state(overrides = {}) {
  return {
    policy:{},
    user_refresh_enabled:true,
    collection_freshness_hours:24,
    latest_usable_run:{
      run_id:'run-1',
      status:'completed',
      completed_at:'2026-10-05T10:00:00.000Z',
    },
    corpus_age_hours:2,
    corpus_fresh:true,
    ...overrides,
  };
}

function runtime(overrides = {}) {
  return { appEnv:'dev', searchMode:'disabled', ...overrides };
}

test('USER refresh decision exposes exactly the four canonical outcomes', () => {
  assert.equal(decideUserRefresh({ state:state(), runtime:runtime(), activeRun:false }).outcome, 'REUSED_CORPUS');
  assert.equal(decideUserRefresh({ state:state(), runtime:runtime(), activeRun:true }).outcome, 'JOINED_EXISTING_RUN');
  assert.equal(decideUserRefresh({ state:state({ corpus_fresh:false }), runtime:runtime(), activeRun:false }).outcome, 'STARTED_RUN');
  assert.equal(decideUserRefresh({ state:state({ user_refresh_enabled:false }), runtime:runtime(), activeRun:false }).outcome, 'BLOCKED_BY_POLICY');
});

test('fresh shared corpus is reused with zero dispatch', async () => {
  let dispatches = 0;
  const result = await userRefresh(user, baseEnv, {
    readState:async () => state(),
    isActive:async () => false,
    dispatch:async () => { dispatches += 1; },
    buildIdentity:{},
  });
  assert.equal(result.outcome, 'REUSED_CORPUS');
  assert.equal(dispatches, 0);
});

test('active global Retrieve coalesces USER refresh with zero second dispatch', async () => {
  let dispatches = 0;
  const result = await userRefresh(user, baseEnv, {
    readState:async () => state({ corpus_fresh:false }),
    isActive:async () => true,
    dispatch:async () => { dispatches += 1; },
    buildIdentity:{},
  });
  assert.equal(result.outcome, 'JOINED_EXISTING_RUN');
  assert.equal(dispatches, 0);
});

test('stale shared corpus starts exactly one existing global Retrieve', async () => {
  const calls = [];
  const result = await userRefresh(user, baseEnv, {
    readState:async () => state({ corpus_fresh:false, corpus_age_hours:30 }),
    isActive:async () => false,
    dispatch:async (...args) => {
      calls.push(args);
      return { name:'projects/jscc-dev/locations/europe-west1/operations/op-1' };
    },
    buildIdentity:{},
  });
  assert.equal(result.outcome, 'STARTED_RUN');
  assert.equal(result.operation_name, 'projects/jscc-dev/locations/europe-west1/operations/op-1');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][2], 'manual-ui');
  assert.equal(calls[0][3], true);
  assert.equal(calls[0][4], 'manual-full');
});

test('dispatch race 409 becomes JOINED_EXISTING_RUN', async () => {
  const result = await userRefresh(user, baseEnv, {
    readState:async () => state({ corpus_fresh:false }),
    isActive:async () => false,
    dispatch:async () => { throw Object.assign(new Error('active'), { status:409 }); },
    buildIdentity:{},
  });
  assert.equal(result.outcome, 'JOINED_EXISTING_RUN');
  assert.equal(result.reason, 'COALESCED_AFTER_RACE');
});

test('USER refresh policy disables before lock or dispatch interaction', async () => {
  let activeReads = 0;
  let dispatches = 0;
  const result = await userRefresh(user, baseEnv, {
    readState:async () => state({ user_refresh_enabled:false }),
    isActive:async () => { activeReads += 1; return false; },
    dispatch:async () => { dispatches += 1; },
    buildIdentity:{},
  });
  assert.equal(result.outcome, 'BLOCKED_BY_POLICY');
  assert.equal(result.reason, 'USER_REFRESH_DISABLED');
  assert.equal(activeReads, 0);
  assert.equal(dispatches, 0);
});

test('PROD USER refresh is blocked even when general search mode is live', async () => {
  const result = await userRefresh(user, { ...baseEnv, APP_ENV:'prod', GCP_PROJECT_ID:'jscc-prod', SEARCH_MODE:'live' }, {
    readState:async () => state({ corpus_fresh:false }),
    isActive:async () => false,
    dispatch:async () => { throw new Error('must not dispatch'); },
    buildIdentity:{},
  });
  assert.equal(result.outcome, 'BLOCKED_BY_POLICY');
  assert.equal(result.reason, 'PROD_NOT_AUTHORIZED');
});

test('shared freshness is global and derives from latest usable terminal run', async () => {
  const queries = [];
  const db = {
    async query(sql) {
      queries.push(sql);
      if (sql.includes('collection_policy')) {
        return { rows:[{ policy:{ collection_freshness_hours:24, user_refresh_enabled:true } }] };
      }
      return { rows:[{
        run_id:'run-global',
        status:'completed_with_errors',
        completed_at:new Date('2026-10-05T10:00:00Z'),
      }] };
    },
  };
  const result = await sharedCorpusRefreshState({}, { db, now:new Date('2026-10-05T12:00:00Z') });
  assert.equal(result.latest_usable_run.run_id, 'run-global');
  assert.equal(result.corpus_age_hours, 2);
  assert.equal(result.corpus_fresh, true);
  assert.equal(queries.some(sql => sql.includes("status IN ('completed','completed_with_errors')")), true);
  assert.equal(queries.some(sql => /tenant_id|search_profile_id/.test(sql)), false);
});

test('POST me refresh is same-origin USER route and does not become ADMIN-only', async () => {
  const api = await readFile(new URL('../src/multiuser-api.js', import.meta.url), 'utf8');
  const secure = await readFile(new URL('../src/secure-entry.js', import.meta.url), 'utf8');
  const start = api.indexOf("url.pathname === '/me/refresh'");
  assert.ok(start > 0);
  const block = api.slice(start, api.indexOf("\n  if (request.method", start + 1));
  assert.match(block, /requireSameOrigin\(request, env\)/);
  assert.match(block, /userRefresh\(context, env\)/);
  assert.doesNotMatch(block, /requireAdmin/);
  assert.doesNotMatch(secure, /adminOnlyPath[\s\S]{0,500}\/me\/refresh/);
});

test('USER refresh orchestration cannot mutate profile criteria or compute FIT directly', async () => {
  const source = await readFile(new URL('../src/user-refresh.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /savePreferences|listProfileJobs|evaluateSharedJob|profile_job_evaluation/);
  assert.match(source, /dispatchWorkflow/);
  assert.match(source, /hasActiveWorkflowRun/);
});

test('USER refresh enablement is system-owned collection policy', async () => {
  const repository = await readFile(new URL('../src/multiuser-repository.js', import.meta.url), 'utf8');
  assert.match(repository, /'user_refresh_enabled'/);
  assert.match(repository, /collection_freshness_hours/);
  assert.match(repository, /FROM search_runs/);
});
