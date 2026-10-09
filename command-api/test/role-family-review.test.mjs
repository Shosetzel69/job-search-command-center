import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { migrateRoleCriteria, backfillSearchProfilePreferences } from '../src/db/atc-489-02-backfill.js';
import { effectiveConfig, savePreferences, userRefreshScope } from '../src/multiuser-repository.js';
import { userRefresh } from '../src/user-refresh.js';
import { applyUserConfigPatch, validateEffectiveSearchConfig, validateUserConfigPatch } from '../src/index.js';
import { classifyCanonicalJob, classifyRoleTitle } from '../../shared/job-classification.mjs';
import { evaluateEligibility } from '../src/eligibility.js';
import { selectRoleFamily } from '../../frontend/src/role-family-selection.mjs';
import { ROLE_FAMILIES } from '../../shared/role-taxonomy-runtime.mjs';

const user={user_id:'11111111-1111-4111-8111-111111111111',
  profile_id:'22222222-2222-4222-8222-222222222222',role:'USER',status:'ACTIVE'};
const searchId='33333333-3333-4333-8333-333333333333';
const candidateId='44444444-4444-4444-8444-444444444444';
const env={APP_ENV:'dev',JSCC_RUNTIME_BACKEND:'gcp',GCP_PROJECT_ID:'jscc-dev',
  GCP_RUNTIME_BUCKET:'jscc-dev-runtime-test',GCP_SEARCH_JOB:'jscc-dev-search',
  GCP_REGION:'europe-west1',SOURCE_SHA:'1'.repeat(40),RUNTIME_DATA_SHA:'2'.repeat(40),
  SEARCH_MODE:'disabled',FRONTEND_ORIGIN:'https://dev.example.test'};
const nomenclatures=JSON.parse(await readFile(new URL('../../data/nomenclatures.json',import.meta.url),'utf8'));
const clone=x=>structuredClone(x);

// Isolated SQL-aware adapter: run actual migration/repository/refresh code, zero DB/network.
function dbFixture(legacy) {
  const state={persisted:null,updates:0,transactions:0};
  const rows=(data=[],rowCount=data.length)=>({rows:data,rowCount});
  const query=async(sql,params=[])=>{
    const s=String(sql).replace(/\s+/g,' ').trim();
    if(s==='BEGIN'){state.transactions++;return rows();}
    if(s==='COMMIT'||s==='ROLLBACK'||s.startsWith('SET LOCAL nile.tenant_id'))return rows();
    if(s.includes("current_setting('nile.tenant_id'"))return rows([{tenant_id:user.profile_id}]);
    if(s.startsWith('SELECT a.user_id'))return rows([user]);
    if(s.includes('FROM profile_preferences WHERE'))return rows([{preferences:clone(legacy)}]);
    if(s.startsWith('INSERT INTO search_profile_preferences')){
      if(s.includes('DO NOTHING')&&state.persisted)return rows([],0);
      state.persisted=JSON.parse(params[2]);return rows([{search_profile_id:searchId}],1);
    }
    if(s.startsWith('UPDATE search_profile_preferences')){
      const next=JSON.parse(params[2]);
      if(JSON.stringify(next)===JSON.stringify(state.persisted))return rows([],0);
      state.persisted=next;state.updates++;return rows([{search_profile_id:searchId}],1);
    }
    if(s.includes('FROM search_profile_preferences')){
      if(!state.persisted)return rows();
      const changed=s.includes('IS DISTINCT FROM $3::jsonb')
        && JSON.stringify(state.persisted)!==JSON.stringify(JSON.parse(params[2]));
      return rows([{preferences:clone(state.persisted),changed}]);
    }
    if(s.includes('FROM candidate_profile'))return rows([{candidate_profile_id:candidateId}]);
    if(s.includes('FROM search_profile'))return rows([{search_profile_id:searchId,
      candidate_profile_id:candidateId,status:'ACTIVE',profile_version:1,
      onboarding_state:'COMPLETE',created_at:'2026-10-09T00:00:00Z',updated_at:'2026-10-09T00:00:00Z'}]);
    if(s.includes('FROM collection_policy'))return rows([{policy:{}}]);
    if(s.startsWith('UPDATE search_profile SET'))return rows([],1);
    throw new Error('Unexpected regression SQL: '+s);
  };
  return {state,db:{query,connect:async()=>({query,release(){}})}};
}

test('D1: 3 distinct legacy families -> idempotent migration -> persisted load -> 409 -> UI resolution -> save/load -> 2-family Refresh',async()=>{
  const legacy={target_role_families:['PROJECT_MANAGEMENT','SERVICE_MANAGEMENT','SCRUM_AGILE'],
    target_country_codes:['RO'],remote_eligible_country_codes:['RO'],
    work_modes:{remote:true,hybrid:false,onsite:false},contract_types:['contract']};
  const migrated=migrateRoleCriteria(legacy);
  assert.deepEqual(migrated.target_role_families,
    ['PROJECT_DELIVERY_MANAGEMENT','SERVICE_OPERATIONS_MANAGEMENT','PRODUCT_AGILE']);
  assert.deepEqual(migrated.target_role_subfamilies,
    ['project_management','service_management','agile_scrum']);
  assert.deepEqual(migrateRoleCriteria(migrated),migrated);
  const {state,db}=dbFixture(legacy);
  const first=await backfillSearchProfilePreferences(env,{db});
  assert.equal(first.inserted,1);assert.equal(first.migrated,1);
  const second=await backfillSearchProfilePreferences(env,{db});
  assert.equal(second.migrated,0);
  const loaded=await effectiveConfig(user,env,{db});
  assert.deepEqual(loaded.target_role_families,migrated.target_role_families);
  assert.deepEqual(loaded.target_role_subfamilies,migrated.target_role_subfamilies);
  assert.deepEqual(state.persisted.target_role_families,migrated.target_role_families);
  let dispatchCount=0;const coverageScopes=[];
  const deps={
    buildIdentity:{},readScope:(ctx,e)=>userRefreshScope(ctx,e,{db}),
    readState:async()=>({user_refresh_enabled:true,collection_freshness_hours:24,
      corpus_age_hours:30,latest_usable_run:null}),
    readCoverage:async(scopes)=>{
      coverageScopes.push(scopes);
      return {scopes:scopes.map(scope=>({scope,state:'STALE',refresh_allowed:true})),
        refresh_scopes:scopes,all_sufficient:false,blocked_by_cooldown:false,
        state_counts:{SUFFICIENT:0,INSUFFICIENT:0,STALE:scopes.length}};
    },getActive:async()=>null,
    dispatch:async(_env,_runtime,_trigger,_checkActive,_mode,request)=>{
      dispatchCount++;
      assert.equal(request.retrieve_scope.scopes.length,2);
      assert.deepEqual(request.scope_summary.role_families.slice().sort(),
        ['PROJECT_DELIVERY_MANAGEMENT','PRODUCT_AGILE'].sort());
      return {name:'qa-mock-operation',run_id:'qa-mock-run'};
    }
  };
  await assert.rejects(userRefresh(user,env,deps),e=>e.status===409
    && e.code==='ROLE_FAMILY_SELECTION_NEEDS_REVIEW'&&/review and save/i.test(e.message));
  assert.equal(dispatchCount,0);assert.equal(coverageScopes.length,0);
  const draft={roleFamilies:[...loaded.target_role_families],
    roleSubfamilies:[...loaded.target_role_subfamilies],
    targetCountries:[...loaded.target_country_codes]};
  assert.equal(draft.roleFamilies.length,3);
  const service=ROLE_FAMILIES.find(x=>x.code==='SERVICE_OPERATIONS_MANAGEMENT');
  const resolved=selectRoleFamily(draft,service,false);
  assert.deepEqual(resolved.roleFamilies,['PROJECT_DELIVERY_MANAGEMENT','PRODUCT_AGILE']);
  assert.deepEqual(resolved.roleSubfamilies,['project_management','agile_scrum']);
  assert.equal(draft.roleFamilies.length,3);
  const patch=validateUserConfigPatch({
    roleFamilies:resolved.roleFamilies,roleSubfamilies:resolved.roleSubfamilies
  },nomenclatures);
  const next=validateEffectiveSearchConfig(applyUserConfigPatch(clone(loaded),patch),nomenclatures);
  await savePreferences(user,next,env,{db});
  const reloaded=await effectiveConfig(user,env,{db});
  assert.deepEqual(reloaded.target_role_families,resolved.roleFamilies);
  assert.deepEqual(reloaded.target_role_subfamilies,resolved.roleSubfamilies);
  const refreshed=await userRefresh(user,env,deps);
  assert.equal(refreshed.outcome,'STARTED_RUN');assert.equal(refreshed.run_id,'qa-mock-run');
  assert.equal(dispatchCount,1);
  assert.deepEqual(coverageScopes[0].map(scope=>scope.role_family).sort(),resolved.roleFamilies.slice().sort());
});

test('G1: Python↔JS conflict semantics, canonical UNKNOWN and Eligibility UNKNOWN; same-family multi-member stays eligible',()=>{
  const titles=['Business Analyst / Product Owner','Technical Lead Project Manager','Technical Customer Success Manager'];
  const py=[
    'import json,sys',
    'from pathlib import Path',
    'sys.path.insert(0,str(Path("scripts").resolve()))',
    'from role_taxonomy import validate_files,classify_title',
    'taxonomy,_=validate_files()',
    'print(json.dumps([classify_title(t,taxonomy) for t in json.loads(sys.stdin.read())]))'
  ].join('\n');
  const stdout=execFileSync('python3',['-c',py],{
    cwd:fileURLToPath(new URL('../../',import.meta.url)),input:JSON.stringify(titles),encoding:'utf8',timeout:30000});
  const pythonResults=JSON.parse(stdout);
  const preferences={target_role_families:['PROJECT_DELIVERY_MANAGEMENT','CUSTOMER_PROFESSIONAL_SERVICES'],
    target_role_subfamilies:['project_management','customer_success','technical_customer_management'],
    target_country_codes:['RO'],remote_eligible_country_codes:['RO'],
    work_modes:{remote:true,hybrid:false,onsite:false},contract_types:['contract']};
  titles.forEach((title,i)=>{
    const pyResult=pythonResults[i],js=classifyRoleTitle(title);
    assert.equal(js.classification_status,pyResult.classification_status,title);
    assert.equal(js.role_family,pyResult.role_family??'UNKNOWN',title);
    assert.deepEqual(js.role_subfamily,pyResult.role_member,title);
    const semanticFamilies=pyResult.family_candidates ?? (pyResult.role_family && pyResult.role_family!=='UNKNOWN' ? [pyResult.role_family] : []);
    assert.deepEqual(js.family_candidates,semanticFamilies,title);
    const classified=classifyCanonicalJob({title,country_codes:['RO'],location:'Bucharest',
      work_mode:'remote',payload:{contract_type:'contract',remote_scope:'Country'}});
    assert.equal(classified.classification_status,js.classification_status,title);
    assert.equal(classified.role_family,js.role_family,title);
    const eligibility=evaluateEligibility({
      title,role_family:classified.role_family,role_subfamily:classified.role_subfamily,
      country_codes:['RO'],work_mode:'remote',contract_type:'contract',remote_scope:'Country',
      payload:{description:'QA parity check'}},preferences,nomenclatures);
    if(i<2){
      assert.equal(js.classification_status,'conflict',title);
      assert.equal(js.role_family,'UNKNOWN',title);
      assert.equal(eligibility.state,'UNKNOWN',title);
      assert.equal(eligibility.reason_code,'ROLE_FAMILY_UNKNOWN',title);
    }else{
      assert.equal(js.classification_status,'matched',title);
      assert.equal(js.role_family,'CUSTOMER_PROFESSIONAL_SERVICES',title);
      assert.deepEqual(js.role_subfamily,['customer_success','technical_customer_management']);
      assert.equal(eligibility.state,'ELIGIBLE',title);
    }
  });
});
