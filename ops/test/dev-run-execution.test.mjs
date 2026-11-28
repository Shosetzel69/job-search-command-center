import test from 'node:test';
import assert from 'node:assert/strict';
import {executeDevRunExecution} from '../operator/dev_run_execution.mjs';
import {operatorHash,validateOperatorApproval,projectOperatorResult} from '../src/dev_operator_contract.mjs';
const sha='a'.repeat(40),actor='b'.repeat(64),ref='#589/100';
const root='projects/jscc-dev/locations/europe-west1';
const job='jscc-diagnostics-dev',execution=job+'-abcde';
const path=root+'/jobs/'+job+'/executions/'+execution;
const input={environment:'dev',job,execution,expected_uid:'abcd-1234',expected_source_sha:sha,
 expected_image:'europe-west1-docker.pkg.dev/jscc-shared/jscc-ops/jscc-diagnostics@sha256:'+'c'.repeat(64)};
const fixture={name:path,job:root+'/jobs/'+job,uid:input.expected_uid,taskCount:1,etag:'fixed-etag',
 template:{containers:[{image:input.expected_image,env:[{name:'SOURCE_SHA',value:sha},{name:'PRIVATE',value:'never-return'}]}]}};
const now=1700000000000;
const approval=(action,bundle)=>({schema_version:'1.0',environment:'dev',work_item_ref:'#589',approval_ref:ref,
 action,actor_sub_hash:actor,operator_source_sha:sha,bundle,bundle_hash:operatorHash(bundle),
 cost_ref:'#589/101',review_ref:'#589/102',issued_at_ms:now-1,expires_at_ms:now+1000});
test('observe exact DEV execution and project no raw environment, arguments or logs',async()=>{
 const result=await executeDevRunExecution(input,{fetchImpl:async(url,opts)=>{
  assert.equal(url,'https://run.googleapis.com/v2/'+path);assert.equal(opts.method,'GET');
  return Response.json(fixture);
 }});
 assert.equal(result.execution_observation.status,'RUNNING_OR_PENDING');
 assert.equal(JSON.stringify(result).includes('never-return'),false);
 const a=validateOperatorApproval({generation:'1',data:approval('observe_run_execution',input)},{ref,actor,sourceSha:sha,now});
 const req={operation_id:a.paths.key,approval_hash:a.approvalHash,action:'observe_run_execution'};
 assert.deepEqual(projectOperatorResult(req,{generation:'1',data:{...req,...result}}).execution_observation,result.execution_observation);
});
test('cancel diagnostics once with exact execution etag, then observe actual state',async()=>{
 const calls=[];let fresh=0;
 const result=await executeDevRunExecution(input,{cancel:true,assertFresh:()=>fresh++,fetchImpl:async(url,opts)=>{
  calls.push([url,opts.method]);
  if(opts.method==='POST'){assert.equal(url,'https://run.googleapis.com/v2/'+path+':cancel');
   assert.deepEqual(JSON.parse(opts.body),{etag:'fixed-etag'});assert.equal(fresh,1);
   return Response.json({name:root+'/operations/cancel123'});}
  return Response.json(calls.length===1?fixture:{...fixture,completionTime:'2026-11-28T00:00:00Z',
   conditions:[{type:'Completed',state:'CONDITION_FAILED'}]});
 }});
 assert.equal(calls.length,3);assert.equal(result.execution_observation.status,'FAILED_OR_CANCELLED');
 assert.equal(result.execution_observation.cancellation_requested,true);
});
test('reject foreign targets, mismatched immutable bindings and product cancellation before mutation',async()=>{
 for(const bad of [{...input,environment:'prod'},{...input,job:'jscc-search-dev',execution:'jscc-search-dev-abcde'},
  {...input,execution:'../other'}])
  await assert.rejects(()=>executeDevRunExecution(bad,{cancel:true,assertFresh:()=>{},fetchImpl:async()=>assert.fail('network')}));
 for(const value of [{...fixture,uid:'dead-beef'},{...fixture,template:{containers:[{image:input.expected_image,env:[]}]}},
  {...fixture,etag:''}]){
  let calls=0;
  await assert.rejects(()=>executeDevRunExecution(input,{cancel:true,assertFresh:()=>{},fetchImpl:async(_url,opts)=>{
   calls++;assert.equal(opts.method,'GET');return Response.json(value);
  }}));assert.equal(calls,1);
 }
 const bad={...input,job:'jscc-db-migrate-dev',execution:'jscc-db-migrate-dev-abcde'};
 assert.throws(()=>validateOperatorApproval({generation:'1',data:approval('cancel_diagnostic_execution',bad)},
  {ref,actor,sourceSha:sha,now}));
});
test('terminal execution needs no cancellation and lost receipt is not retried',async()=>{
 let calls=0;
 const done=await executeDevRunExecution(input,{cancel:true,assertFresh:()=>assert.fail('fresh'),fetchImpl:async()=>{
  calls++;return Response.json({...fixture,completionTime:'2026-11-28T00:00:00Z',
   conditions:[{type:'Completed',state:'CONDITION_SUCCEEDED'}]});
 }});
 assert.equal(calls,1);assert.equal(done.execution_observation.cancellation_requested,false);
 calls=0;
 await assert.rejects(()=>executeDevRunExecution(input,{cancel:true,assertFresh:()=>{},fetchImpl:async()=>{
  if(++calls===1)return Response.json(fixture);throw Error('lost_receipt');
 }}));assert.equal(calls,2);
});
