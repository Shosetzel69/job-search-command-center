import test from 'node:test';
import assert from 'node:assert/strict';
import {observeDevNile} from '../src/dev-nile-client.mjs';
import {validateTaskRequest,authenticatedEvidence,publicEvidence} from '../src/lib.mjs';
const sha='a'.repeat(40);
const args={environment:'dev',operation:'fit_verify_plan',expected_source_sha:sha};
const cfg={project:'jscc-dev',devBaseUrl:'https://jscc-command-api-dev-example.run.app'};
test('admission rejects SQL, extra args and non-DEV',()=>{
  assert.equal(validateTaskRequest('observe_dev_nile',args).task_class,'OBSERVE');
  for(const a of [{...args,environment:'test'},{...args,operation:'SELECT 1'},{...args,tenant:'other'}])
    assert.throws(()=>validateTaskRequest('observe_dev_nile',a));
});
test('worker pins destination, metadata audience and source; strips raw plan fields',async()=>{
  let calls=0;
  const result=await observeDevNile(args,cfg,{fetchImpl:async(url,options)=>{
    calls++;
    if(calls===1){
      assert.equal(url.hostname,'metadata.google.internal');
      assert.equal(url.searchParams.get('audience'),'urn:jscc:dev:nile-diagnostic');
      return new Response('a.b.c');
    }
    assert.equal(url.origin,cfg.devBaseUrl);
    assert.equal(url.pathname,'/admin/dev/nile-diagnostic');
    assert.equal(url.searchParams.get('expected_source_sha'),sha);
    assert.equal(options.redirect,'error');
    return Response.json({source_sha:sha,operation:args.operation,status:'COLLECTED',elapsed_ms:2,
      plan:{'Plan Rows':3,Filter:'private',children:[{'Total Cost':4,'Relation Name':'private'}]}});
  }});
  assert.equal(result.nile_status,'COLLECTED');
  assert.deepEqual(JSON.parse(result.nile_evidence_json).plan,{'Plan Rows':3,children:[{'Total Cost':4}]});
});
test('unexpected target is rejected before obtaining token; wrong source fails closed',async()=>{
  const denied=await observeDevNile(args,{...cfg,devBaseUrl:'https://example.invalid'},{fetchImpl:async()=>assert.fail('network call')});
  assert.equal(denied.nile_stage,'target');
  let calls=0;
  const mismatch=await observeDevNile(args,cfg,{fetchImpl:async()=>++calls===1?new Response('a.b.c'):Response.json({source_sha:'b'.repeat(40),operation:args.operation,status:'COLLECTED'})});
  assert.equal(mismatch.nile_status,'ERROR');
  assert.equal(mismatch.nile_stage,'source_or_response');
});
test('Nile evidence is private to authenticated operation response',()=>{
  const e={assertions:{nile_status:'COLLECTED',nile_evidence_json:'{"elapsed_ms":2}'}};
  assert.equal(authenticatedEvidence(e).assertions.nile_status,'COLLECTED');
  assert.deepEqual(publicEvidence(e).assertions,{});
});

test('schema inventory binds the source and projects only bounded metadata',async()=>{
 const tables=['schema_migrations','tenants','app_user','user_identity','profile','user_session',
 'collection_policy','system_bootstrap','account_capacity_policy','account_deletion_audit',
 'canonical_jobs','source_postings','search_runs','source_run_results','scheduler_config',
 'scheduler_state','coverage_scope_state','candidate_profile','search_profile','search_profile_preferences',
 'profile_preferences','profile_job_state','profile_job_evaluation','applications','profile_notes',
 'profile_ui_preferences','refresh_requests','profile_job_count_snapshots'];
 const schema={database:'jobsearch_dev',read_only:true,migration_state:'MATCH',table_state:'PRESENT',
  migration_checksum:'a'.repeat(64),catalog_checksum:'b'.repeat(64),extra_versions:[],
  migrations:[{version:'001',expected_checksum:'a'.repeat(64),actual_checksum:'a'.repeat(64),state:'MATCH'}],
  tables:tables.map(table=>({table,present:true,indexes:[],constraints:[],rows:['PRIVATE']}))};
 const run=async(value)=>{
  let calls=0;
  return observeDevNile({...args,operation:'schema_inventory'},cfg,{fetchImpl:async()=>++calls===1?
   new Response('a.b.c'):Response.json({source_sha:sha,operation:'schema_inventory',status:'COLLECTED',elapsed_ms:1,schema:value})});
 };
 const out=await run(schema);
 assert.equal(out.nile_status,'COLLECTED');
 assert.equal(JSON.parse(out.nile_evidence_json).schema.table_state,'PRESENT');
 assert.equal(out.nile_evidence_json.includes('PRIVATE'),false);
 assert.equal((await run({...schema,database:'jobsearch_prod'})).nile_status,'ERROR');
 assert.equal((await run({...schema,tables:schema.tables.slice(1)})).nile_status,'ERROR');
});


test('runtime health allows only current backend/process evidence; never forwards raw metadata',async()=>{
 const health={database:'jobsearch_dev',read_only:true,statement_timeout_bound:true,lock_timeout_bound:true,
  backend_tls:'UNKNOWN',lock_scope:'current_backend_only',granted_locks:1,waiting_locks:0,
  pool_scope:'current_process_only',pool:{total:2,idle:1,waiting:0,private:'secret'},query:'secret'};
 const req={...args,operation:'runtime_health'};
 assert.equal(validateTaskRequest('observe_dev_nile',req).task_class,'OBSERVE');
 const run=async value=>{
  let calls=0;
  return observeDevNile(req,cfg,{fetchImpl:async()=>++calls===1?new Response('a.b.c'):
   Response.json({source_sha:sha,operation:req.operation,status:'COLLECTED',elapsed_ms:1,health:value})});
 };
 const result=await run(health);
 assert.equal(result.nile_status,'COLLECTED');
 assert.equal(JSON.parse(result.nile_evidence_json).health.backend_tls,'UNKNOWN');
 assert.equal(result.nile_evidence_json.includes('secret'),false);
 assert.equal((await run({...health,lock_scope:'all_tenants'})).nile_status,'ERROR');
 assert.equal((await run({...health,pool:{total:1,idle:2,waiting:0}})).nile_status,'ERROR');
});
