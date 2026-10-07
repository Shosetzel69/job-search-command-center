import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import { decideUserRefresh, userRefresh } from '../src/user-refresh.js';
import { sharedCorpusRefreshState } from '../src/multiuser-repository.js';
import { buildRetrieveRequest } from '../src/retrieve-scope.js';

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
const scope = { scopes:[{
  role_family:'PROJECT_MANAGEMENT',
  target_regions:['EU'],
  target_country_codes:['RO'],
  remote_eligible_country_codes:['RO'],
  work_modes:['remote','hybrid'],
  contract_types:['contract'],
}] };

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
function runtime(overrides = {}) { return { appEnv:'dev', searchMode:'disabled', ...overrides }; }
function coverage(kind='SUFFICIENT', scopes=scope.scopes, overrides={}) {
  const entries=(scopes||[]).map(item=>({
    scope:item,
    state:kind,
    reason:kind==='SUFFICIENT'?null:kind==='STALE'?'FRESHNESS_EXPIRED':'CORPUS_VOLUME_BELOW_MINIMUM',
    refresh_allowed:kind!=='SUFFICIENT',
    corpus_volume:kind==='INSUFFICIENT'?0:10,
    source_diversity:kind==='INSUFFICIENT'?0:3,
    ...overrides,
  }));
  return {
    schema_version:'1.0',
    scopes:entries,
    refresh_scopes:kind==='SUFFICIENT'?[]:(scopes||[]),
    all_sufficient:entries.length>0&&entries.every(item=>item.state==='SUFFICIENT'),
    blocked_by_cooldown:false,
    state_counts:{
      SUFFICIENT:entries.filter(item=>item.state==='SUFFICIENT').length,
      INSUFFICIENT:entries.filter(item=>item.state==='INSUFFICIENT').length,
      STALE:entries.filter(item=>item.state==='STALE').length,
    },
  };
}
function request(overrides={}) {
  return buildRetrieveRequest({
    scopes:overrides.scopes || scope.scopes,
    collectionFreshnessHours:overrides.collectionFreshnessHours || 24,
  });
}
function deps(overrides={}) {
  return {
    readScope:async()=>scope,
    readState:async()=>state(),
    readCoverage:async()=>coverage(),
    getActive:async()=>null,
    dispatch:async()=>({name:'op',run_id:'run-new'}),
    buildIdentity:{},
    ...overrides,
  };
}

test('USER refresh decision exposes exactly the four canonical outcomes', () => {
  const req=request();
  assert.equal(decideUserRefresh({ state:state(), coverage:coverage(), runtime:runtime(), activeRun:null, request:req }).outcome, 'REUSED_CORPUS');
  assert.equal(decideUserRefresh({ state:state(), coverage:coverage('STALE'), runtime:runtime(), activeRun:{run_id:'live',request_signature:req.request_signature}, request:req }).outcome, 'JOINED_EXISTING_RUN');
  assert.equal(decideUserRefresh({ state:state(), coverage:coverage('STALE'), runtime:runtime(), activeRun:null, request:req }).outcome, 'STARTED_RUN');
  assert.equal(decideUserRefresh({ state:state({ user_refresh_enabled:false }), coverage:coverage('STALE'), runtime:runtime(), activeRun:null, request:req }).outcome, 'BLOCKED_BY_POLICY');
});

test('SUFFICIENT bounded coverage is reused with zero dispatch', async () => {
  let dispatches = 0;
  const result = await userRefresh(user, baseEnv, deps({dispatch:async()=>{dispatches+=1;}}));
  assert.equal(result.outcome, 'REUSED_CORPUS');
  assert.equal(dispatches, 0);
});

test('equivalent active Retrieve coalesces USER refresh with same run_id', async () => {
  const req=request();
  let dispatches = 0;
  const result = await userRefresh(user, baseEnv, deps({
    readState:async()=>state(),
    readCoverage:async()=>coverage('STALE'),
    getActive:async()=>({run_id:'run-live',request_signature:req.request_signature}),
    dispatch:async()=>{dispatches+=1;},
  }));
  assert.equal(result.outcome, 'JOINED_EXISTING_RUN');
  assert.equal(result.run_id, 'run-live');
  assert.equal(dispatches, 0);
});

test('non-equivalent active Retrieve blocks instead of starting second heavy run', async () => {
  let dispatches = 0;
  const result = await userRefresh(user, baseEnv, deps({
    readState:async()=>state(),
    readCoverage:async()=>coverage('STALE'),
    getActive:async()=>({run_id:'run-other',request_signature:'0'.repeat(64)}),
    dispatch:async()=>{dispatches+=1;},
  }));
  assert.equal(result.outcome, 'BLOCKED_BY_POLICY');
  assert.equal(result.reason, 'NON_EQUIVALENT_RUN_ACTIVE');
  assert.equal(dispatches, 0);
});

test('stale shared corpus starts exactly one bounded Retrieve and returns run_id', async () => {
  const calls = [];
  const result = await userRefresh(user, baseEnv, deps({
    readState:async()=>state(),
    readCoverage:async()=>coverage('STALE'),
    dispatch:async(...args)=>{
      calls.push(args);
      return { name:'projects/jscc-dev/locations/europe-west1/operations/op-1', run_id:'run-r1' };
    },
  }));
  assert.equal(result.outcome, 'STARTED_RUN');
  assert.equal(result.run_id, 'run-r1');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][2], 'manual-ui');
  assert.equal(calls[0][3], true);
  assert.equal(calls[0][4], 'manual-full');
  assert.match(calls[0][5].request_signature,/^[0-9a-f]{64}$/);
  assert.equal(calls[0][5].retrieve_scope.scopes.length,1);
});

test('completed Retrieve between lock check and dispatch is reused', async () => {
  let reads = 0;
  let dispatches = 0;
  const result = await userRefresh(user, baseEnv, deps({
    readState:async()=>state(),
    readCoverage:async()=>{
      reads += 1;
      return reads === 1 ? coverage('STALE') : coverage('SUFFICIENT');
    },
    dispatch:async()=>{dispatches+=1;},
  }));
  assert.equal(result.outcome, 'REUSED_CORPUS');
  assert.equal(reads, 2);
  assert.equal(dispatches, 0);
});

test('dispatch race 409 joins only the same signed run', async () => {
  const req=request();
  let activeReads=0;
  const result = await userRefresh(user, baseEnv, deps({
    readState:async()=>state(),
    readCoverage:async()=>coverage('STALE'),
    getActive:async()=>{
      activeReads+=1;
      return activeReads===1 ? null : {run_id:'run-race',request_signature:req.request_signature};
    },
    dispatch:async()=>{ throw Object.assign(new Error('active'), { status:409 }); },
  }));
  assert.equal(result.outcome, 'JOINED_EXISTING_RUN');
  assert.equal(result.reason, 'COALESCED_AFTER_RACE');
  assert.equal(result.run_id, 'run-race');
});

test('empty USER scope fails closed before lock or dispatch', async () => {
  let activeReads=0,dispatches=0;
  const result = await userRefresh(user, baseEnv, deps({
    readScope:async()=>({scopes:[]}),
    readState:async()=>state(),
    getActive:async()=>{activeReads+=1;return null;},
    dispatch:async()=>{dispatches+=1;},
  }));
  assert.equal(result.outcome,'BLOCKED_BY_POLICY');
  assert.equal(result.reason,'NO_ACTIVE_REFRESH_SCOPE');
  assert.equal(activeReads,0);
  assert.equal(dispatches,0);
});

test('USER refresh policy disables before lock or dispatch interaction', async () => {
  let activeReads = 0;
  let dispatches = 0;
  const result = await userRefresh(user, baseEnv, deps({
    readState:async()=>state({ user_refresh_enabled:false }),
    getActive:async()=>{ activeReads += 1; return null; },
    dispatch:async()=>{ dispatches += 1; },
  }));
  assert.equal(result.outcome, 'BLOCKED_BY_POLICY');
  assert.equal(result.reason, 'USER_REFRESH_DISABLED');
  assert.equal(activeReads, 0);
  assert.equal(dispatches, 0);
});

test('PROD USER refresh is blocked even when general search mode is live', async () => {
  const result = await userRefresh(user, { ...baseEnv, APP_ENV:'prod', GCP_PROJECT_ID:'jscc-prod', SEARCH_MODE:'live' }, deps({
    readState:async()=>state(),
    readCoverage:async()=>coverage('STALE'),
    dispatch:async()=>{ throw new Error('must not dispatch'); },
  }));
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

test('POST me refresh is same-origin USER route and caller body cannot select provider/profile scope', async () => {
  const api = await readFile(new URL('../src/multiuser-api.js', import.meta.url), 'utf8');
  const secure = await readFile(new URL('../src/secure-entry.js', import.meta.url), 'utf8');
  const start = api.indexOf("url.pathname === '/me/refresh'");
  assert.ok(start > 0);
  const block = api.slice(start, api.indexOf("\n  if (request.method", start + 1));
  assert.match(block, /requireSameOrigin\(request, env\)/);
  assert.match(block, /userRefresh\(context, env\)/);
  assert.doesNotMatch(block, /request\.json|provider|tenant_id|profile_id/);
  assert.doesNotMatch(block, /requireAdmin/);
  assert.doesNotMatch(secure, /adminOnlyPath[\s\S]{0,500}\/me\/refresh/);
});

test('USER refresh orchestration cannot mutate profile criteria or compute FIT directly', async () => {
  const source = await readFile(new URL('../src/user-refresh.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /savePreferences|listProfileJobs|evaluateSharedJob|profile_job_evaluation/);
  assert.match(source, /dispatchWorkflow/);
  assert.match(source, /activeWorkflowRun/);
  assert.match(source, /buildRetrieveRequest/);
});

test('USER refresh enablement is system-owned collection policy', async () => {
  const repository = await readFile(new URL('../src/multiuser-repository.js', import.meta.url), 'utf8');
  assert.match(repository, /'user_refresh_enabled'/);
  assert.match(repository, /collection_freshness_hours/);
  assert.match(repository, /FROM search_runs/);
});