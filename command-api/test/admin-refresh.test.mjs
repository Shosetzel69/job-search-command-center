import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import { adminRefresh, decideAdminRefresh } from '../src/admin-refresh.js';
import { aggregateAdminRefreshScopes } from '../src/db/cross-tenant-refresh-scope-aggregator.js';

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

test('ADMIN refresh decision exposes canonical outcomes',()=>{
  assert.equal(decideAdminRefresh({state:state(),runtime:runtime(),activeRun:false,aggregate:aggregate()}).outcome,'REUSED_CORPUS');
  assert.equal(decideAdminRefresh({state:state(),runtime:runtime(),activeRun:true,aggregate:aggregate()}).outcome,'JOINED_EXISTING_RUN');
  assert.equal(decideAdminRefresh({state:state({corpus_fresh:false}),runtime:runtime(),activeRun:false,aggregate:aggregate()}).outcome,'STARTED_RUN');
  assert.equal(decideAdminRefresh({state:state(),runtime:runtime({appEnv:'prod',searchMode:'live'}),activeRun:false,aggregate:aggregate()}).outcome,'BLOCKED_BY_POLICY');
});

test('non-ADMIN cannot invoke ADMIN refresh',async()=>{
  await assert.rejects(
    adminRefresh(user,baseEnv,{aggregateScopes:async()=>aggregate(),readState:async()=>state(),buildIdentity:{}}),
    error=>error?.status===403,
  );
});

test('fresh corpus is reused with zero dispatch',async()=>{
  let dispatches=0;
  const result=await adminRefresh(admin,baseEnv,{
    aggregateScopes:async()=>aggregate(),
    readState:async()=>state(),
    isActive:async()=>false,
    dispatch:async()=>{dispatches+=1;},
    buildIdentity:{},
  });
  assert.equal(result.outcome,'REUSED_CORPUS');
  assert.equal(result.scope_summary.active_profile_count,2);
  assert.equal(result.scope_summary.scope_count,1);
  assert.equal(dispatches,0);
});

test('active global Retrieve coalesces ADMIN refresh',async()=>{
  let dispatches=0;
  const result=await adminRefresh(admin,baseEnv,{
    aggregateScopes:async()=>aggregate(),
    readState:async()=>state({corpus_fresh:false,corpus_age_hours:30}),
    isActive:async()=>true,
    dispatch:async()=>{dispatches+=1;},
    buildIdentity:{},
  });
  assert.equal(result.outcome,'JOINED_EXISTING_RUN');
  assert.equal(dispatches,0);
});

test('stale corpus starts exactly one global admin-ui Retrieve',async()=>{
  const calls=[];
  const result=await adminRefresh(admin,baseEnv,{
    aggregateScopes:async()=>aggregate(),
    readState:async()=>state({corpus_fresh:false,corpus_age_hours:30}),
    isActive:async()=>false,
    dispatch:async(...args)=>{calls.push(args);return{name:'projects/jscc-dev/operations/admin-1'};},
    buildIdentity:{},
  });
  assert.equal(result.outcome,'STARTED_RUN');
  assert.equal(result.operation_name,'projects/jscc-dev/operations/admin-1');
  assert.equal(calls.length,1);
  assert.equal(calls[0][2],'admin-ui');
  assert.equal(calls[0][3],true);
  assert.equal(calls[0][4],'manual-full');
});

test('dispatch race 409 becomes JOINED_EXISTING_RUN',async()=>{
  const result=await adminRefresh(admin,baseEnv,{
    aggregateScopes:async()=>aggregate(),
    readState:async()=>state({corpus_fresh:false}),
    isActive:async()=>false,
    dispatch:async()=>{throw Object.assign(new Error('active'),{status:409});},
    buildIdentity:{},
  });
  assert.equal(result.outcome,'JOINED_EXISTING_RUN');
  assert.equal(result.reason,'COALESCED_AFTER_RACE');
});

test('completed Retrieve race reuses fresh corpus before dispatch',async()=>{
  let reads=0,dispatches=0;
  const result=await adminRefresh(admin,baseEnv,{
    aggregateScopes:async()=>aggregate(),
    readState:async()=>{
      reads+=1;
      return reads===1
        ? state({corpus_fresh:false,corpus_age_hours:30})
        : state({corpus_fresh:true,corpus_age_hours:0.01,latest_usable_run:{run_id:'just-finished',status:'completed',completed_at:'2026-10-05T12:00:00.000Z'}});
    },
    isActive:async()=>false,
    dispatch:async()=>{dispatches+=1;},
    buildIdentity:{},
  });
  assert.equal(result.outcome,'REUSED_CORPUS');
  assert.equal(reads,2);
  assert.equal(dispatches,0);
});

test('zero active refresh scopes fail closed without dispatch',async()=>{
  let activeReads=0,dispatches=0;
  const result=await adminRefresh(admin,baseEnv,{
    aggregateScopes:async()=>aggregate({active_profile_count:0,scope_count:0,scopes:[]}),
    readState:async()=>state({corpus_fresh:false}),
    isActive:async()=>{activeReads+=1;return false;},
    dispatch:async()=>{dispatches+=1;},
    buildIdentity:{},
  });
  assert.equal(result.outcome,'BLOCKED_BY_POLICY');
  assert.equal(result.reason,'NO_ACTIVE_REFRESH_SCOPES');
  assert.equal(activeReads,0);
  assert.equal(dispatches,0);
});

test('PROD ADMIN refresh fails closed without runtime interaction',async()=>{
  let activeReads=0,dispatches=0;
  const result=await adminRefresh(admin,{...baseEnv,APP_ENV:'prod',GCP_PROJECT_ID:'jscc-prod',SEARCH_MODE:'live'},{
    aggregateScopes:async()=>aggregate(),
    readState:async()=>state({corpus_fresh:false}),
    isActive:async()=>{activeReads+=1;return false;},
    dispatch:async()=>{dispatches+=1;},
    buildIdentity:{},
  });
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
  assert.equal(JSON.stringify(result).includes('tenant_id'),false);
  assert.equal(JSON.stringify(result).includes('search_profile_id'),false);
  assert.equal(JSON.stringify(result).includes('user_id'),false);
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
});

test('aggregator is a narrow ADR-008 allowlisted exception',async()=>{
  const guard=await readFile(new URL('../scripts/check-tenant-boundary.mjs',import.meta.url),'utf8');
  const aggregator=await readFile(new URL('../src/db/cross-tenant-refresh-scope-aggregator.js',import.meta.url),'utf8');
  assert.match(guard,/db\/cross-tenant-refresh-scope-aggregator\.js/);
  assert.doesNotMatch(aggregator,/structured_evidence|profile_job_evaluation|applications|email/);
  assert.match(aggregator,/active_profile_count/);
});

test('both runtime adapters accept admin-ui trigger',async()=>{
  for(const path of ['../src/runtime-gcp.js','../src/runtime-github.js']){
    const source=await readFile(new URL(path,import.meta.url),'utf8');
    assert.match(source,/admin-ui/);
  }
});
