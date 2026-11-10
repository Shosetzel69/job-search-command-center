import assert from 'node:assert/strict';
import test from 'node:test';
import { advanceProfileEvaluation } from '../src/evaluation-advance.js';
import { normalizeJobSearchQuery } from '../src/multiuser-repository.js';

const USER = Object.freeze({
  user_id:'11111111-1111-4111-8111-111111111111',
  profile_id:'22222222-2222-4222-8222-222222222222',
  role:'USER',status:'ACTIVE',
});
const SEARCH = '33333333-3333-4333-8333-333333333333';
const CANDIDATE = '44444444-4444-4444-8444-444444444444';

function fakeDatabase({lock=true,pending=0}={}) {
  const statements=[];
  let released=false;
  const query=async (sql,params=[])=>{
    statements.push({sql,params});
    if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK') return {rows:[]};
    if(sql.startsWith('SET LOCAL nile.tenant_id')) return {rows:[]};
    if(sql.includes("current_setting('nile.tenant_id'")) {
      return {rows:[{tenant_id:USER.profile_id}]};
    }
    if(sql.includes('FROM search_profile sp')) {
      return {rows:[{
        search_profile_id:SEARCH,candidate_profile_id:CANDIDATE,
        status:'ACTIVE',profile_version:4,onboarding_state:'COMPLETE',
        personal_preferences:{target_role_families:['PROJECT_DELIVERY_MANAGEMENT']},
        system_policy:{},
      }]};
    }
    if(sql.includes('FROM candidate_profile')) {
      return {rows:[{candidate_profile_id:CANDIDATE}]};
    }
    if(sql.includes('pg_try_advisory_xact_lock')) {
      return {rows:[{acquired:lock}]};
    }
    if(sql.includes('ORDER BY j.job_id ASC LIMIT')) return {rows:[]};
    if(sql.includes('COUNT(*)::integer AS pending')) return {rows:[{pending}]};
    throw Error('Unexpected Stage A SQL: '+sql.slice(0,160));
  };
  return {db:{connect:async()=>({query,release:()=>{released=true;}})},
    statements,released:()=>released};
}

test('Stage A: empty current-basis scope completes in a tenant transaction',async()=>{
  const run=fakeDatabase();
  const result=await advanceProfileEvaluation(USER,{}, {},{db:run.db});
  assert.deepEqual({status:result.status,processed:result.processed,remaining:result.remaining},
    {status:'COMPLETE',processed:0,remaining:0});
  assert.equal(result.completion_semantics,'PROCESSING_COVERAGE');
  assert.ok(run.statements.some(x=>x.sql==='COMMIT'));
  assert.ok(run.statements.some(x=>x.sql.includes('pg_try_advisory_xact_lock')));
  assert.ok(run.statements.some(x=>x.sql.includes('ORDER BY j.job_id ASC LIMIT')));
  assert.ok(run.released());
  assert.ok(!run.statements.some(x=>x.sql.includes('INSERT INTO profile_job_count_snapshots')));
});

test('Stage A: concurrent per-profile lock contention is 409 and rolls back',async()=>{
  const run=fakeDatabase({lock:false});
  await assert.rejects(()=>advanceProfileEvaluation(USER,{}, {},{db:run.db}),
    error=>error.status===409 && error.message==='IN_PROGRESS');
  assert.ok(run.statements.some(x=>x.sql==='ROLLBACK'));
  assert.ok(!run.statements.some(x=>x.sql.includes('ORDER BY j.job_id ASC LIMIT')));
  assert.ok(run.released());
});

test('Stage A: all legacy scan_step values fail closed',()=>{
  for(const scan_step of ['','0','1',false,0,1,true]){
    assert.throws(()=>normalizeJobSearchQuery({scan_step}),/SCAN_STEP_UNSUPPORTED/);
  }
  assert.equal(normalizeJobSearchQuery({eligibility:'unknown'}).eligibility,'UNKNOWN');
  assert.equal(normalizeJobSearchQuery({b2b:'false'}).b2b,false);
  assert.throws(()=>normalizeJobSearchQuery({b2b:'maybe'}),/Invalid b2b/);
});
