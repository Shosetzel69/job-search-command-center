import assert from 'node:assert/strict';
import test from 'node:test';
import {adminDbPurge} from '../src/admin-db-purge.js';
import {handleAuthenticatedRoute} from '../src/multiuser-api.js';
const env={APP_ENV:'dev',GCP_PROJECT_ID:'jscc-dev',JSCC_RUNTIME_BACKEND:'gcp',NILE_DATABASE_URL:'postgresql://fixture:fixture@localhost/jobsearch_dev',FRONTEND_ORIGIN:'https://example.test'};
const admin={role:'ADMIN',status:'ACTIVE',user_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'};
const request={confirmation:'PURGE DEV'};
function fixture({idle=true,fail=false}={}){
  const calls=[];
  const lock={
    assertIdle:async()=>{calls.push('idle');if(!idle)throw Object.assign(Error('active'),{status:409});},
    assertHeld:async()=>{calls.push('held');},
    clearLatest:async()=>{calls.push('latest');},
    release:async()=>{calls.push('release');}
  };
  const opts={
    database:{},
    acquire:async()=>{calls.push('acquire');return lock;},
    transaction:async fn=>{calls.push('preflight');return fn({query:async sql=>({rows:[sql.includes('current_database')?{database:'jobsearch_dev'}:sql.includes('scheduler_config')?{enabled:false}:{count:0}]})});},
    purgeProjections:async(_,__,{assertHeld})=>{calls.push('tenant');await assertHeld();if(fail)throw Error('private internal failure');return {profile_job_evaluation:3};},
    clearShared:async()=>{calls.push('shared');return {canonical_jobs:5};}
  };
  return {opts,calls};
}
test('ADMIN purge is DEV-only, active, typed and fixed scope before acquisition',async()=>{
  const {opts,calls}=fixture();
  for(const [ctx,e,input,code] of [
    [{...admin,role:'USER'},env,request,403],
    [{...admin,status:'DEACTIVATED'},env,request,403],
    [admin,{...env,APP_ENV:'test'},request,403],
    [admin,{...env,GCP_PROJECT_ID:'jscc-prod'},request,403],
    [admin,env,{confirmation:'PURGE'},400],
    [admin,env,{...request,table:'app_user'},400],
  ])await assert.rejects(adminDbPurge(ctx,e,input,opts),x=>x.status===code);
  assert.deepEqual(calls,[]);
});
test('ADMIN route denies USER and cross-origin before DB access',async()=>{
  const make=origin=>new Request('https://example.test/admin/db-purge',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(request)});
  await assert.rejects(handleAuthenticatedRoute(make(env.FRONTEND_ORIGIN),env,{...admin,role:'USER'}),e=>e.status===403);
  await assert.rejects(handleAuthenticatedRoute(make('https://foreign.test'),env,admin),e=>e.status===403);
});
test('maintenance guard releases on preflight refusal, retains after uncertain deletion',async()=>{
  const pre=fixture({idle:false});
  await assert.rejects(adminDbPurge(admin,env,request,pre.opts),e=>e.status===409);
  assert.deepEqual(pre.calls,['acquire','idle','release']);
  const partial=fixture({fail:true});
  await assert.rejects(adminDbPurge(admin,env,request,partial.opts),e=>e.status===503&&!e.message.includes('private internal'));
  assert.deepEqual(partial.calls,['acquire','idle','preflight','tenant','held']);
});
test('successful purge orders tenant then shared and releases after pointer cleanup',async()=>{
  const {opts,calls}=fixture();
  const result=await adminDbPurge(admin,env,request,opts);
  assert.deepEqual(result,{status:'completed',deleted:{profile_job_evaluation:3,canonical_jobs:5},lock_released:true});
  assert.deepEqual(calls,['acquire','idle','preflight','tenant','held','shared','latest','release']);
});
