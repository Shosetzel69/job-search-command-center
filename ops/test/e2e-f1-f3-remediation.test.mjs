import test from 'node:test';
import assert from 'node:assert/strict';
import {listExecutionTaskEvidence,readBoundedExecutionLogs,inspectDevRunSnapshot} from '../src/dev-e2e-diagnostics.mjs';
import {sanitizeText,validateTaskRequest,authenticatedEvidence,publicEvidence} from '../src/lib.mjs';

const id='jscc-diagnostics-dev-5lf4k';
const view='projects/jscc-dev/locations/global/buckets/_Default/views/jscc-ops-dev';
const http=(status,json)=>({ok:status>=200&&status<300,status,json:async()=>json});
const log=(payload,execution=id)=>({
 resource:{type:'cloud_run_job',labels:{project_id:'jscc-dev',location:'europe-west1',job_name:'jscc-diagnostics-dev'}},
 labels:{execution_name:execution},textPayload:payload,
});

test('F1 task details: narrow correct Cloud Run v2 API, permission 403 is explicit, never fabricated',async()=>{
 let calls=[];
 const result=await listExecutionTaskEvidence(id,{request:async url=>{
   calls.push(url);return http(403,{message:'permission denied'});
 }});
 assert.equal(calls.length,1);
 assert.match(calls[0],/\/jobs\/jscc-diagnostics-dev\/executions\/jscc-diagnostics-dev-5lf4k\/tasks/);
 assert.equal(result.task_metadata_available,false);
 assert.equal(result.task_metadata_error,'task_read_403');
 assert.deepEqual(result.tasks,[]);
});
test('F1 task details: true 200 with empty task array is not an error',async()=>{
 const r=await listExecutionTaskEvidence(id,{request:async()=>http(200,{})});
 assert.equal(r.task_metadata_available,true);
 assert.deepEqual(r.tasks,[]);
});
test('F1 task details: page through nextPageToken with bound, deny spoofed name',async()=>{
 let n=0;
 const r=await listExecutionTaskEvidence(id,{request:async url=>{
   n++;
   if(n===1)return http(200,{tasks:[{name:'task-0',lastAttemptResult:{exitCode:0}}],nextPageToken:'second'});
   assert.match(url,/pageToken=second/);
   return http(200,{tasks:[{name:'task-1',lastAttemptResult:{exitCode:2}}]});
 }});
 assert.equal(r.task_metadata_available,true);
 assert.equal(r.tasks.length,2);
 assert.equal(n,2);
 await assert.rejects(()=>listExecutionTaskEvidence('prod-job-abc123',{request:async()=>http(200,{})}),/invalid_execution_id/);
});
test('F1 cyclic pagination fails closed',async()=>{
 await assert.rejects(()=>listExecutionTaskEvidence(id,{
  request:async()=>http(200,{tasks:[],nextPageToken:'cycle'})
 }),/task_page_token_invalid/);
});

test('F2 Cloud Logging: empty first page with nextPageToken is followed; immutable filter and descending timestamp',async()=>{
 let calls=0;
 const result=await readBoundedExecutionLogs({execution_id:id,limit:10,view,sanitize:sanitizeText,
  request:async(url,options)=>{
   calls++;
   assert.equal(url,'https://logging.googleapis.com/v2/entries:list');
   const body=JSON.parse(options.body);
   assert.deepEqual(body.resourceNames,[view]);
   assert.equal(body.orderBy,'timestamp desc');
   assert.match(body.filter,/labels.execution_name="jscc-diagnostics-dev-5lf4k"/);
   assert.match(body.filter,/resource.labels.job_name="jscc-diagnostics-dev"/);
   assert.match(body.filter,/resource.labels.project_id="jscc-dev"/);
   if(calls===1)return http(200,{entries:[],nextPageToken:'second'});
   assert.equal(body.pageToken,'second');
   return http(200,{entries:[log('worker completed')]});
  }});
 assert.equal(result.line_count,1);
 assert.equal(result.log_excerpt,'worker completed');
 assert.equal(result.log_evidence_verified,true);
 assert.equal(result.log_lookup_status,'FOUND');
 assert.equal(result.log_search_complete,true);
 assert.equal(calls,2);
});
test('F2 no entries is not a false PASS; incomplete paginated searches do not claim absence',async()=>{
 const complete=await readBoundedExecutionLogs({execution_id:id,limit:5,view,sanitize:sanitizeText,
  request:async()=>http(200,{})});
 assert.equal(complete.log_evidence_verified,false);
 assert.equal(complete.log_lookup_status,'NO_MATCHING_ENTRIES');
 let calls=0;
 const incomplete=await readBoundedExecutionLogs({execution_id:id,limit:5,view,sanitize:sanitizeText,
  request:async()=>{calls++;return http(200,{entries:[],nextPageToken:'page'+calls});}});
 assert.equal(calls,8);
 assert.equal(incomplete.log_evidence_verified,false);
 assert.equal(incomplete.log_search_complete,false);
 assert.equal(incomplete.log_lookup_status,'INCOMPLETE');
});
test('F2 log transport 403 and duplicate page tokens fail, no fabricated evidence',async()=>{
 await assert.rejects(()=>readBoundedExecutionLogs({execution_id:id,limit:4,view,sanitize:sanitizeText,
  request:async()=>http(403,{})}),/logging_read_403/);
 await assert.rejects(()=>readBoundedExecutionLogs({execution_id:id,limit:4,view,sanitize:sanitizeText,
  request:async()=>http(200,{entries:[],nextPageToken:'repeat'})}),/log_page_token_invalid/);
});
test('F2 cross execution, job and environment log entries are rejected regardless of upstream filter',async()=>{
 for(const entry of [
  log('data','jscc-diagnostics-dev-other'),
  {...log('data'),resource:{type:'cloud_run_job',labels:{project_id:'jscc-prod',location:'europe-west1',job_name:'jscc-diagnostics-dev'}}},
  {...log('data'),resource:{type:'cloud_run_job',labels:{project_id:'jscc-dev',location:'europe-west1',job_name:'jscc-search-dev'}}},
 ]) await assert.rejects(()=>readBoundedExecutionLogs({execution_id:id,limit:5,view,sanitize:sanitizeText,
  request:async()=>http(200,{entries:[entry]})}),/logging_execution_binding_mismatch/);
});
test('F2 token and credential-like text is redacted; raw output absent from public projection',async()=>{
 const result=await readBoundedExecutionLogs({execution_id:id,limit:5,view,sanitize:sanitizeText,
   request:async()=>http(200,{entries:[log('Bearer abcd1234 access_token=private')]})});
 assert.equal(result.log_excerpt.includes('private'),false);
 assert.equal(result.log_excerpt.includes('abcd1234'),false);
 const evidence={operation_id:'op-sanitized-1234567',assertions:{
   line_count:result.line_count,log_excerpt:result.log_excerpt,
   log_evidence_verified:result.log_evidence_verified,
   log_lookup_status:result.log_lookup_status,log_search_complete:result.log_search_complete,
 }};
 assert.equal('log_excerpt' in publicEvidence(evidence).assertions,false);
 assert.equal(authenticatedEvidence(evidence).assertions.log_excerpt,result.log_excerpt);
});
test('F2 cross-project log view and unsafe limit rejected locally',async()=>{
 const base={execution_id:id,limit:5,view,sanitize:sanitizeText,
  request:async()=>http(200,{})};
 await assert.rejects(()=>readBoundedExecutionLogs({...base,view:view.replace('jscc-dev','jscc-prod')}),/invalid_log_view/);
 await assert.rejects(()=>readBoundedExecutionLogs({...base,limit:500}),/invalid_log_limit/);
});

test('F3 snapshot: GCS jobs metadata exists with no content inspection',async()=>{
 const requests=[];
 const result=await inspectDevRunSnapshot({
  run_id:'run-20261105',runtimeBucket:'jscc-dev-runtime-data',
  readStatus:async(bucket,name)=>{
    requests.push([bucket,name]);return {data:{run_id:'run-20261105',status:'completed',jobs_published:5}};
  },
  readMetadata:async(bucket,name)=>{
    requests.push([bucket,name]);return {status:200,contentType:'application/json'};
  },
 });
 assert.deepEqual(requests,[
  ['jscc-dev-runtime-data','runs/run-20261105/run-status.json'],
  ['jscc-dev-runtime-data','runs/run-20261105/jobs.json']]);
 assert.equal(result.jobs_present,true);
 assert.equal(result.jobs_evidence,'METADATA_FOUND');
 assert.equal(result.published_jobs,5);
});
test('F3 snapshot: absent jobs object distinct from published count; 403 remains UNVERIFIED',async()=>{
 const base={run_id:'run-20261105',runtimeBucket:'jscc-dev-runtime-data',
  readStatus:async()=>({data:{run_id:'run-20261105',jobs_published:0}})};
 const missing=await inspectDevRunSnapshot({...base,readMetadata:async()=>({status:404})});
 assert.equal(missing.jobs_present,false);
 assert.equal(missing.jobs_evidence,'METADATA_NOT_FOUND');
 const denied=await inspectDevRunSnapshot({...base,readMetadata:async()=>({status:403})});
 assert.equal(denied.jobs_present,null);
 assert.equal(denied.jobs_evidence,'METADATA_DENIED');
});
test('F3 snapshot: unknown status, invalid paths, crossenv metadata and mismatched IDs fail closed',async()=>{
 const base={run_id:'run-20261105',runtimeBucket:'jscc-dev-runtime-data',
  readStatus:async()=>({data:{run_id:'run-20261105'}}),
  readMetadata:async()=>({status:200})};
 await assert.rejects(()=>inspectDevRunSnapshot({...base,run_id:'../secret'}),/invalid_run_id/);
 await assert.rejects(()=>inspectDevRunSnapshot({...base,runtimeBucket:'jscc-prod-runtime-data'}),/runtime_bucket_not_configured/);
 await assert.rejects(()=>inspectDevRunSnapshot({...base,
   readStatus:async()=>({data:{run_id:'other-run'}})}),/runtime_snapshot_id_mismatch/);
 await assert.rejects(()=>inspectDevRunSnapshot({...base,
   readMetadata:async()=>({status:500})}),/jobs_metadata_read_failed/);
 await assert.rejects(()=>inspectDevRunSnapshot({...base,readStatus:async()=>null}),/runtime_snapshot_not_found/);
});
test('F3 DEV-only catalog rejects extra TEST/PROD and malicious task inputs',()=>{
 assert.throws(()=>validateTaskRequest('inspect_runtime_snapshot',{run_id:'abc',environment:'test'}),/unrecognized_parameter/);
 assert.throws(()=>validateTaskRequest('inspect_runtime_snapshot',{run_id:'abc',environment:'prod'}),/unrecognized_parameter/);
 assert.throws(()=>validateTaskRequest('describe_execution',{execution_id:'jscc-prod-job-abc123'}),/execution_not_allowlisted/);
 assert.throws(()=>validateTaskRequest('run_test_suite',{suite:'arbitrary-shell',expected_source_sha:'a'.repeat(40)}),/unknown_suite/);
});
