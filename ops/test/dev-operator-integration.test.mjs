import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {operatorActor,operatorHash,operatorPaths,operatorDispatchPath,operatorExecution,operatorLro,validateOperatorApproval}
 from '../src/dev_operator_contract.mjs';
import {invokeDevOperator,operatorGatewayConfig} from '../src/dev_operator_gateway.mjs';
import {runOperatorJob,runtimeConfig} from '../operator/dev_operator_job.mjs';

const SHA='a'.repeat(40),DIGEST='sha256:'+'b'.repeat(64);
const sub='123456789',actor=operatorActor(sub),ref='#589/1234';
const now=()=>1700000000000,execution='jscc-ops-operator-dev-abcde';
const root='projects/jscc-dev/locations/europe-west1';
const sa='jscc-ops-operator-dev@jscc-dev.iam.gserviceaccount.com';
const config={sourceSha:SHA,imageDigest:DIGEST},paths=operatorPaths(ref);
const bundle={environment:'dev',script_id:'dev_runtime_build_inventory_v1',
 script_sha256:'60f9c0f87abd9da979e1dc66c5a5e2580faa5a4483aacb7f3b8bdd2478bea73b',
 service:'jscc-command-api-dev',buildId:'c5bbfb85-0aab-40c7-aa47-a5589aa9e295'};
function approval(){
 return {schema_version:'1.0',environment:'dev',work_item_ref:'#589',approval_ref:ref,
  action:'gcloud_inventory',actor_sub_hash:actor,operator_source_sha:SHA,
  bundle:structuredClone(bundle),bundle_hash:operatorHash(bundle),cost_ref:'#589/1235',review_ref:'#589/1236',
  issued_at_ms:now()-1000,expires_at_ms:now()+10000};
}
function fixture({record=approval(),jobImage=DIGEST,lifecycleOK=true,loseDispatch=false}={}){
 const map=new Map([[paths.approval,{generation:'1',data:record}]]),calls=[];
 const get=async p=>map.has(p)?structuredClone(map.get(p)):null;
 const put=async(p,data)=>{
  if(loseDispatch&&p===operatorDispatchPath(execution))throw Error('network_loss');
  if(map.has(p))throw Error('generation_precondition_failed');
  map.set(p,{generation:'1',data:structuredClone(data)});
 };
 const call=async(method,path)=>{
  calls.push([method,path]);
  if(method==='GET'&&path===root+'/jobs/jscc-ops-operator-dev')return {
   name:path,reconciling:false,template:{taskCount:1,parallelism:1,template:{
    maxRetries:0,serviceAccount:sa,timeout:'1800s',containers:[{
     resources:{limits:{cpu:'1',memory:'1Gi'}},
     image:'europe-west1-docker.pkg.dev/jscc-shared/jscc-ops/jscc-ops-operator@'+jobImage,
     env:Object.entries({SOURCE_SHA:SHA,GCP_PROJECT:'jscc-dev',GCP_REGION:'europe-west1',OPS_BUCKET:'jscc-dev-ops-state'}).map(([name,value])=>({name,value})),
    }],
   }},
  };
  if(method==='POST'&&path===root+'/jobs/jscc-ops-operator-dev:run')
   return {metadata:{name:root+'/jobs/jscc-ops-operator-dev/executions/'+execution}};
  throw Error('unexpected_call');
 };
 const verifyLifecycle=async()=>{if(!lifecycleOK)throw Error('operator_lifecycle_not_settled');};
 const opts={read:get,create:put,call,now,sleep:async()=>{},verifyLifecycle};
 const jobOpts={get,put,now,wait:async()=>{},verifyLifecycle,maxPolls:1};
 return {map,calls,opts,jobOpts};
}
const start=f=>invokeDevOperator('operator_start',{approval_ref:ref},sub,config,f.opts);
const status=f=>invokeDevOperator('operator_status',{approval_ref:ref},sub,config,f.opts);
const run=(f,handler)=>runOperatorJob({sourceSha:SHA,execution},{...f.jobOpts,handlers:{gcloud_inventory:handler}});

test('operator default-disabled; enabled configuration is exact DEV-only and immutable',()=>{
 assert.equal(operatorGatewayConfig({}),null);
 assert.deepEqual(operatorGatewayConfig({JSCC_DEV_OPERATOR_ENABLED:'true',GCP_PROJECT:'jscc-dev',GCP_REGION:'europe-west1',
  OPS_BUCKET:'jscc-dev-ops-state',JSCC_DEV_OPERATOR_SOURCE_SHA:SHA,JSCC_DEV_OPERATOR_IMAGE_DIGEST:DIGEST}),config);
 assert.throws(()=>operatorGatewayConfig({JSCC_DEV_OPERATOR_ENABLED:'true',GCP_PROJECT:'jscc-prod'}));
 assert.equal(operatorExecution(root+'/jobs/jscc-ops-operator-dev/executions/'+execution),execution);
 assert.equal(operatorExecution('projects/other/locations/europe-west1/jobs/jscc-ops-operator-dev/executions/'+execution),null);
 assert.equal(operatorLro('projects/other/locations/europe-west1/operations/abc'),null);
});

test('authenticated start through fixed Job, independent claim, bounded result, no re-execution',async()=>{
 const f=fixture();let executions=0;
 const launched=await start(f);
 assert.equal(launched.state,'DISPATCH_PENDING_OR_UNKNOWN');
 assert.equal((await start(f)).duplicate,true);
 const handler=async a=>{
  executions++;
  assert.equal(a.approval_ref,ref);
  assert.ok(f.map.has('control/v1/operator-claims/'+paths.key+'.json'));
  return {state:'OBSERVED',script_verdict:'BUILD_DIGEST_UNKNOWN',private_output:'never_return',token:'secret'};
 };
 const done=await run(f,handler);
 assert.equal(done.state,'OBSERVED');
 assert.equal(done.script_verdict,'BUILD_DIGEST_UNKNOWN');
 assert.equal(JSON.stringify(done).includes('secret'),false);
 assert.equal(JSON.stringify(done).includes('never_return'),false);
 assert.equal((await status(f)).state,'OBSERVED');
 assert.equal((await run(f,handler)).duplicate,true);
 assert.equal(executions,1);
 assert.equal(f.calls.filter(c=>c[0]==='POST').length,1);
});

test('wrong subject, foreign environment, stale approval, wrong image or unsettled lifecycle never starts Job',async()=>{
 for(const record of [
  {...approval(),actor_sub_hash:operatorActor('123')},
  {...approval(),environment:'test'},
  {...approval(),bundle_hash:'0'.repeat(64)},
  {...approval(),expires_at_ms:now()-1},
 ]){
  const f=fixture({record});
  await assert.rejects(()=>start(f));
  assert.equal(f.calls.length,0);
 }
 for(const args of [{jobImage:'sha256:'+'c'.repeat(64)},{lifecycleOK:false}]){
  const f=fixture(args);
  await assert.rejects(()=>start(f));
  assert.equal(f.calls.filter(c=>c[0]==='POST').length,0);
 }
 const f=fixture();
 await assert.rejects(()=>invokeDevOperator('operator_start',{approval_ref:ref,bundle},sub,config,f.opts));
 assert.equal(f.calls.length,0);
});

test('uncertain dispatch is never retried; independent Job rejects forged/missing record',async()=>{
 const f=fixture({loseDispatch:true});
 await start(f);
 assert.equal((await start(f)).duplicate,true);
 let n=0;
 await assert.rejects(()=>run(f,async()=>{n++;return {state:'OBSERVED'};}),/dispatch_missing/);
 assert.equal(n,0);
 assert.equal(f.calls.filter(c=>c[0]==='POST').length,1);
 const g=fixture();await start(g);
 g.map.get(paths.approval).data.bundle.buildId='unknown';
 await assert.rejects(()=>run(g,async()=>{n++;return {state:'OBSERVED'};}));
 assert.equal(n,0);
});

test('lost action receipt is recovery-required and not re-dispatched',async()=>{
 const f=fixture();await start(f);
 let n=0;
 const fail=async()=>{n++;throw Error('possible_side_effect');};
 assert.equal((await run(f,fail)).state,'RECOVERY_REQUIRED');
 assert.equal((await run(f,fail)).duplicate,true);
 assert.equal(n,1);
});

test('runtime identity and embedded source binding require exact Job task and service account',async()=>{
 const env={CLOUD_RUN_JOB:'jscc-ops-operator-dev',CLOUD_RUN_TASK_INDEX:'0',CLOUD_RUN_TASK_COUNT:'1',
  CLOUD_RUN_TASK_ATTEMPT:'0',CLOUD_RUN_EXECUTION:execution,GCP_PROJECT:'jscc-dev',GCP_REGION:'europe-west1',
  OPS_BUCKET:'jscc-dev-ops-state',SOURCE_SHA:SHA};
 const opts={readSource:async()=>SHA+'\n',fetchImpl:async(url,init)=>{
  assert.match(url,/metadata\.google\.internal\/.*\/email$/);
  assert.equal(init.redirect,'error');
  return new Response(sa);
 }};
 assert.deepEqual(await runtimeConfig(env,opts),{sourceSha:SHA,execution});
 for(const delta of [{CLOUD_RUN_TASK_ATTEMPT:'1'},{CLOUD_RUN_TASK_COUNT:'2'},{GCP_PROJECT:'jscc-prod'}])
  await assert.rejects(()=>runtimeConfig({...env,...delta},opts));
 await assert.rejects(()=>runtimeConfig(env,{...opts,readSource:async()=>DIGEST}));
 await assert.rejects(()=>runtimeConfig(env,{...opts,fetchImpl:async()=>new Response('other-sa')}));
});

test('operator artifact is separate and existing images do not package privileged entrypoint',()=>{
 const docker=role=>readFileSync(new URL('../Dockerfile.'+role,import.meta.url),'utf8');
 assert.match(docker('operator'),/USER 65532:65532/);
 assert.match(docker('operator'),/ops\/operator\/dev_operator_job\.mjs/);
 for(const role of ['gateway','worker']){
  assert.doesNotMatch(docker(role),/COPY ops\/operator|COPY scripts\/gcp\/remote_executor_dev_pair/);
 }
 assert.match(docker('gateway'),/remote_executor_dev_lifecycle\.json/);
});

test('cancel action requires new approval and exact original build reference, not arbitrary target',()=>{
 const cancelBundle={original_approval_ref:'#589/1230',build_id:'254d3513-9c02-4f33-a974-e8e8f8935aa7'};
 const make=b=>({...approval(),action:'cancel_build',bundle:b,bundle_hash:operatorHash(b)});
 const validate=b=>validateOperatorApproval({generation:'1',data:make(b)},{ref,actor,sourceSha:SHA,now:now()});
 assert.equal(validate(cancelBundle).approval.action,'cancel_build');
 for(const bad of [{...cancelBundle,original_approval_ref:ref},{...cancelBundle,build_id:'any-build'},
  {...cancelBundle,project:'jscc-prod'}])assert.throws(()=>validate(bad),/operator_cancel_approval_mismatch/);
});

test('pending status reconciles immutable receipt and mapping; no relaunch on absent result',async()=>{
 const f=fixture(),call=f.opts.call;
 f.opts.call=async(method,path)=>{
  if(method==='GET'&&path.endsWith('/executions/'+execution)){
   return {name:path,completionTime:'2026-11-28T00:00:00Z',template:{serviceAccount:sa,containers:[{
    image:'europe-west1-docker.pkg.dev/jscc-shared/jscc-ops/jscc-ops-operator@'+DIGEST,
    env:[{name:'SOURCE_SHA',value:SHA},{name:'SECRET',value:'never-return'}]}]}};
  }
  return call(method,path);
 };
 await start(f);
 const observed=await status(f);
 assert.equal(observed.dispatch_evidence,'MAPPING_CONFIRMED');
 assert.equal(observed.execution_state,'TERMINAL_WITHOUT_RESULT');
 assert.equal(observed.automatic_retry,false);
 assert.equal(observed.recovery_authorization_required,true);
 assert.equal(JSON.stringify(observed).includes('never-return'),false);
 assert.equal((await start(f)).duplicate,true);
 assert.equal(f.calls.filter(x=>x[0]==='POST').length,1);
 const receipt='control/v1/operator-requests/'+paths.key+'.receipt.json';
 f.map.get(receipt).data.request_hash='bad';
 assert.equal((await status(f)).dispatch_evidence,'UNVERIFIED');
 assert.equal(f.calls.filter(x=>x[0]==='POST').length,1);
});
test('lost dispatch mapping still returns known receipt without authorizing a retry',async()=>{
 const f=fixture({loseDispatch:true});
 await start(f);
 const out=await status(f);
 assert.equal(out.dispatch_evidence,'RECEIPT_ONLY');
 assert.equal(out.execution_name,execution);
 assert.equal(out.execution_state,'UNVERIFIED');
 assert.equal((await start(f)).duplicate,true);
 assert.equal(f.calls.filter(x=>x[0]==='POST').length,1);
});

test('operator audit binds protected approval and claim to the actual outcome and time without inventing exit code',async()=>{
 const f=fixture();
 await start(f);
 const done=await run(f,async()=>({state:'OBSERVED',script_verdict:'BUILD_DIGEST_UNKNOWN',private_output:'never-return'}));
 const audit=done.audit;
 assert.equal(audit.approval_ref,ref);
 assert.equal(audit.actor_sub_hash,actor);
 assert.equal(audit.operator_source_sha,SHA);
 assert.equal(audit.approved_bundle_sha256,operatorHash(bundle));
 assert.equal(audit.execution_name,execution);
 assert.equal(audit.script_sha256,bundle.script_sha256);
 assert.equal(audit.exit_code,null);
 assert.equal(audit.outcome,'OBSERVED');
 assert.equal(audit.started_at_ms,now());
 assert.equal(audit.finished_at_ms,now());
 assert.deepEqual((await status(f)).audit,audit);
 assert.equal(JSON.stringify(audit).includes('never-return'),false);
 f.map.get(paths.result).data.audit.actor_sub_hash='f'.repeat(64);
 await assert.rejects(()=>status(f),/operator_audit_binding_invalid/);
});
