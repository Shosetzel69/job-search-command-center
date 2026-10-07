import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import { adminRefresh, decideAdminRefresh } from '../src/admin-refresh.js';
import { aggregateAdminRefreshScopes } from '../src/db/cross-tenant-refresh-scope-aggregator.js';
import { buildRetrieveRequest } from '../src/retrieve-scope.js';

const SHA='3'.repeat(40);
const RUNTIME_SHA='4'.repeat(40);
const baseEnv={
  APP_ENV:'dev',
  JSCC_RUNTIME_BACKEND:'gcp',
  GCP_PROJECT_ID:'jscc-dev',
  GCP_RUNTIME_BUCKET:'jscc-dev-runtime-test',
  GCP_SEARCH_JOB:'jscc-search-dev',
  GCP_REGION:'europe-west1',
  SOURCE_SHA:SHA,
  RUNTIME_DATA_SHA:RUNTIME_SHA,
  SEARCH_MODE:'disabled',
  FRONTEND_ORIGIN:'https://dev.example.test',
};
const admin={ user_id:'admin-1', profile_id:'tenant-admin', role:'ADMIN', status:'ACTIVE' };
const user={ user_id:'user-1', profile_id:'tenant-user', role:'USER', status:'ACTIVE' };

function state(overrides={}){
  return {
    policy:{},
    user_refresh_enabled:true,
    collection_freshness_hours:24,
    latest_usable_run:{run_id:'run-1',status:'completed',completed_at:'2026-10-05T10:00:00.000Z'},
    corpus_age_hours:2,
    corpus_fresh:true,
    ...overrides,
  };
}
function aggregate(overrides={}){
  return {
    active_profile_count:2,
    scope_count:1,
    scopes:[{
      role_family:'PROJECT_MANAGEMENT',
      target_regions:['EU'],
      target_country_codes:['RO'],
      remote_eligible_country_codes:['RO'],
      work_modes:['remote'],
      contract_types:['contract'],
      active_profile_count:2,
    }],
    ...overrides,
  };
}
function runtime(overrides={}){ return {appEnv:'dev',searchMode:'disabled',...overrides}; }
function coverage(kind='SUFFICIENT', scopes=aggregate().scopes, overrides={}) {
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
function request(a=aggregate()){
  return buildRetrieveRequest({scopes:a.scopes,collectionFreshnessHours:24});
}
function deps(overrides={}){
  return {
    aggregateScopes:async()=>aggregate(),
    readState:async()=>state(),
    readCoverage:async()=>coverage(),
    getActive:async()=>null,
    dispatch:async()=>({name:'op',run_id:'run-admin'}),
    buildIdentity:{},
    ...overrides,
  };
}

test('ADMIN refresh decision exposes canonical outcomes',()=>{
  const a=aggregate(),req=request(a);
  assert.equal(decideAdminRefresh({state:state(),coverage:coverage(),runtime:runtime(),activeRun:null,aggregate:a,request:req}).outcome,'REUSED_CORPUS');
  assert.equal(decideAdminRefresh({state:state(),coverage:coverage('STALE'),runtime:runtime(),activeRun:{run_id:'live',request_signature:req.request_signature},aggregate:a,request:req}).outcome,'JOINED_EXISTING_RUN');
  assert.equal(decideAdminRefresh({state:state(),coverage:coverage('STALE'),runtime:runtime(),activeRun:null,aggregate:a,request:req}).outcome,'STARTED_RUN');
  assert.equal(decideAdminRefresh({state:state(),coverage:coverage('STALE'),runtime:runtime({appEnv:'prod',searchMode:'live'}),activeRun:null,aggregate:a,request:req}).outcome,'BLOCKED_BY_POLICY');
});

test('non-ADMIN cannot invoke ADMIN refresh',async()=>{
  await assert.rejects(
    adminRefresh(user,baseEnv,deps()),
    error=>error?.status===403,
  );
});

test('SUFFICIENT coverage is reused with zero dispatch',async()=>{
  let dispatches=0;
  const result=await adminRefresh(admin,baseEnv,deps({dispatch:async()=>{dispatches+=1;}}));
  assert.equal(result.outcome,'REUSED_CORPUS');
  assert.equal(result.scope_summary.active_profile_count,2);
  assert.equal(result.scope_summary.scope_count,1);
  assert.ok(result.scope_summary.source_count>0);
  assert.equal(dispatches,0);
});

test('equivalent active global Retrieve coalesces ADMIN refresh',async()=>{
  const req=request();
  let dispatches=0;
  const result=await adminRefresh(admin,baseEnv,deps({
    readState:async()=>state(),
    readCoverage:async()=>coverage('STALE'),
    getActive:async()=>({run_id:'run-live',request_signature:req.request_signature}),
    dispatch:async()=>{dispatches+=1;},
  }));
  assert.equal(result.outcome,'JOINED_EXISTING_RUN');
  assert.equal(result.run_id,'run-live');
  assert.equal(dispatches,0);
});

test('non-equivalent active run blocks a second ADMIN heavy Retrieve',async()=>{
  let dispatches=0;
  const result=await adminRefresh(admin,baseEnv,deps({
    readState:async()=>state(),
    readCoverage:async()=>coverage('STALE'),
    getActive:async()=>({run_id:'other',request_signature:'0'.repeat(64)}),
    dispatch:async()=>{dispatches+=1;},
  }));
  assert.equal(result.outcome,'BLOCKED_BY_POLICY');
  assert.equal(result.reason,'NON_EQUIVALENT_RUN_ACTIVE');
  assert.equal(dispatches,0);
});

test('stale corpus starts exactly one bounded admin-ui Retrieve',async()=>{
  const calls=[];
  const result=await adminRefresh(admin,baseEnv,deps({
    readState:async()=>state(),
    readCoverage:async()=>coverage('STALE'),
    dispatch:async(...args)=>{calls.push(args);return{name:'projects/jscc-dev/operations/admin-1',run_id:'run-admin-1'};},
  }));
  assert.equal(result.outcome,'STARTED_RUN');
  assert.equal(result.run_id,'run-admin-1');
  assert.equal(calls.length,1);
  assert.equal(calls[0][2],'admin-ui');
  assert.equal(calls[0][3],true);
  assert.equal(calls[0][4],'manual-full');
  assert.match(calls[0][5].request_signature,/^[0-9a-f]{64}$/);
});

test('dispatch race 409 joins only equivalent ADMIN request',async()=>{
  const req=request();
  let reads=0;
  const result=await adminRefresh(admin,baseEnv,deps({
    readState:async()=>state(),
    readCoverage:async()=>coverage('STALE'),
    getActive:async()=>{reads+=1;return reads===1?null:{run_id:'run-race',request_signature:req.request_signature};},
    dispatch:async()=>{throw Object.assign(new Error('active'),{status:409});},
  }));
  assert.equal(result.outcome,'JOINED_EXISTING_RUN');
  assert.equal(result.reason,'COALESCED_AFTER_RACE');
  assert.equal(result.run_id,'run-race');
});

test('completed Retrieve race reuses fresh corpus before dispatch',async()=>{
  let reads=0,dispatches=0;
  const result=await adminRefresh(admin,baseEnv,deps({
    readState:async()=>state(),
    readCoverage:async()=>{
      reads+=1;
      return reads===1?coverage('STALE'):coverage('SUFFICIENT');
    },
    dispatch:async()=>{dispatches+=1;},
  }));
  assert.equal(result.outcome,'REUSED_CORPUS');
  assert.equal(reads,2);
  assert.equal(dispatches,0);
});

test('zero active refresh scopes fail closed without dispatch',async()=>{
  let activeReads=0,dispatches=0;
  const result=await adminRefresh(admin,baseEnv,deps({
    aggregateScopes:async()=>aggregate({active_profile_count:0,scope_count:0,scopes:[]}),
    readState:async()=>state(),
    readCoverage:async()=>coverage('INSUFFICIENT',[]),
    getActive:async()=>{activeReads+=1;return null;},
    dispatch:async()=>{dispatches+=1;},
  }));
  assert.equal(result.outcome,'BLOCKED_BY_POLICY');
  assert.equal(result.reason,'NO_ACTIVE_REFRESH_SCOPES');
  assert.equal(activeReads,0);
  assert.equal(dispatches,0);
});

test('PROD ADMIN refresh fails closed without runtime interaction',async()=>{
  let activeReads=0,dispatches=0;
  const result=await adminRefresh(admin,{...baseEnv,APP_ENV:'prod',GCP_PROJECT_ID:'jscc-prod',SEARCH_MODE:'live'},deps({
    readState:async()=>state(),
    readCoverage:async()=>coverage('STALE'),
    getActive:async()=>{activeReads+=1;return null;},
    dispatch:async()=>{dispatches+=1;},
  }));
  assert.equal(result.outcome,'BLOCKED_BY_POLICY');
  assert.equal(result.reason,'PROD_NOT_AUTHORIZED');
  assert.equal(activeReads,0);
  assert.equal(dispatches,0);
});

test('cross-tenant aggregator deduplicates equivalent scopes without identity output',async()=>{
  let sql='';
  const db={query:async query=>{
    sql=query;
    return {rows:[
      {
        target_role_families:['PROJECT_MANAGEMENT'],
        role_groups:{},
        target_regions:['eu'],
        target_country_codes:['ro'],
        remote_eligible_country_codes:['ro'],
        work_modes:{remote:true,hybrid:false,onsite:false},
        contract_types:['CONTRACT'],
      },
      {
        target_role_families:['project_management'],
        role_groups:{},
        target_regions:['EU'],
        target_country_codes:['RO'],
        remote_eligible_country_codes:['RO'],
        work_modes:{remote:true,hybrid:false,onsite:false},
        contract_types:['contract'],
      },
    ]};
  }};
  const result=await aggregateAdminRefreshScopes({}, {db});
  assert.equal(result.active_profile_count,2);
  assert.equal(result.scope_count,1);
  assert.equal(result.scopes[0].active_profile_count,2);
  assert.equal(result.scopes[0].role_family,'PROJECT_MANAGEMENT');
  assert.deepEqual(result.scopes[0].target_country_codes,['RO']);
  assert.equal(/tenant_id|search_profile_id|user_id/.test(JSON.stringify(result)),false);
  assert.match(sql,/account\.status = 'ACTIVE'/);
  assert.match(sql,/sp\.status = 'ACTIVE'/);
});

test('cross-tenant aggregator query excludes empty unconfigured preference rows',async()=>{
  let sql='';
  const db={query:async query=>{sql=query;return {rows:[]};}};
  const result=await aggregateAdminRefreshScopes({}, {db});
  assert.equal(result.active_profile_count,0);
  assert.equal(result.scope_count,0);
  assert.match(sql,/COALESCE\(pref\.preferences, '\{\}'::jsonb\) <> '\{\}'::jsonb/);
});

test('legacy role groups explode to distinct role-family scopes',async()=>{
  const db={query:async()=>({rows:[{
    target_role_families:[],
    role_groups:{pm:{enabled:true},delivery:{enabled:true},service:{enabled:false},scrum:{enabled:false},program:{enabled:false}},
    target_regions:[],
    target_country_codes:['RO'],
    remote_eligible_country_codes:['RO'],
    work_modes:{remote:true,hybrid:true,onsite:false},
    contract_types:['contract'],
  }]})};
  const result=await aggregateAdminRefreshScopes({}, {db});
  assert.deepEqual(result.scopes.map(x=>x.role_family),['DELIVERY','PROJECT_MANAGEMENT']);
});

test('POST admin refresh is same-origin and ADMIN-only',async()=>{
  const api=await readFile(new URL('../src/multiuser-api.js',import.meta.url),'utf8');
  const start=api.indexOf("url.pathname === '/admin/refresh'");
  assert.ok(start>0);
  const block=api.slice(start,api.indexOf("\n  if (request.method",start+1));
  assert.match(block,/requireSameOrigin\(request, env\)/);
  assert.match(block,/requireAdmin\(context\)/);
  assert.match(block,/adminRefresh\(context, env\)/);
  assert.doesNotMatch(block,/request\.json|tenant_id|user_id|profile_id/);
});

test('aggregator is a narrow ADR-008 allowlisted exception',async()=>{
  const guard=await readFile(new URL('../scripts/check-tenant-boundary.mjs',import.meta.url),'utf8');
  const aggregator=await readFile(new URL('../src/db/cross-tenant-refresh-scope-aggregator.js',import.meta.url),'utf8');
  assert.match(guard,/db\/cross-tenant-refresh-scope-aggregator\.js/);
  assert.doesNotMatch(aggregator,/structured_evidence|profile_job_evaluation|applications|email/);
  assert.match(aggregator,/active_profile_count/);
});

test('both runtime adapters expose active run identity and accept admin-ui trigger',async()=>{
  for(const path of ['../src/runtime-gcp.js','../src/runtime-github.js']){
    const source=await readFile(new URL(path,import.meta.url),'utf8');
    assert.match(source,/admin-ui/);
    assert.match(source,/activeWorkflowRun/);
  }
});