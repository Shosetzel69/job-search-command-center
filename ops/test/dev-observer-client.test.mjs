import assert from 'node:assert/strict';
import test from 'node:test';
import {checkedObserverUrl,invokeDevObserver} from '../observation/dev-observer-client.mjs';
const base='https://jscc-dev-runtime-observer-828902654738.europe-west1.run.app';
const service='jscc-dev-workspace-manager';
const args={environment:'dev',task:'describe_dev_runtime',service};
test('observer URL is DEV-only, exact HTTPS, no query/path credentials',()=>{
 assert.equal(checkedObserverUrl(base),base);
 for(const url of ['http://'+base.slice(8),base+'/foo',base+'?a=1',
  'https://jscc-dev-runtime-observer-123.us-central1.run.app',
  'https://jscc-prod-runtime-observer-828902654738.europe-west1.run.app',
  'https://jscc-dev-runtime-observer-evil.europe-west1.run.app.evil.tld'])
 assert.throws(()=>checkedObserverUrl(url),/observer_url_invalid/);
});
test('OIDC-only transport: no Google credential in JSON returned to caller',async()=>{
 const calls=[];
 const fetchImpl=async(u,opts)=>{
  calls.push({u,opts});
  if(u.startsWith('http://metadata.google.internal'))return {ok:true,text:async()=> 'a'.repeat(32)};
  return {ok:true,status:200,text:async()=>JSON.stringify({
    environment:'dev',task:args.task,
    resource:'projects/jscc-dev/locations/europe-west1/services/'+service,
    source_sha:'UNKNOWN',observed_at:'2026-11-04T00:00:00Z',
    effective_revisions:[{revision:service+'-00002-42q',percent:100,image_digest:'UNKNOWN'}],
    service_account:'jscc-dev-workspace-manager@jscc-dev.iam.gserviceaccount.com',
    environment_variable_count:2,
    env:[{name:'SECRET',value:'redact-me'}],
  })};
 };
 const result=await invokeDevObserver(args,base,{fetchImpl});
 assert.equal(result.environment,'dev');
 assert.equal(result.service_account,'jscc-dev-workspace-manager@jscc-dev.iam.gserviceaccount.com');
 assert.equal(result.environment_variable_count,2);
 assert.equal(JSON.stringify(result).includes('redact-me'),false);
 assert.equal(calls.length,2);
 assert.equal(calls[1].opts.method,'POST');
 assert.equal(JSON.parse(calls[1].opts.body).service,service);
 assert.equal(JSON.stringify(result).includes('a'.repeat(32)),false);
});
test('reject unexpected caller fields before network calls',async()=>{
 let calls=0;
 const fetchImpl=async()=>{calls++;throw Error('network unexpected');};
 await assert.rejects(()=>invokeDevObserver({...args,project:'jscc-prod'},base,{fetchImpl}),/resource_denied/);
 await assert.rejects(()=>invokeDevObserver({...args,task:'run_gcloud'},base,{fetchImpl}),/task_denied/);
 assert.equal(calls,0);
});
test('permission denial, oversized responses and missing observer are fail-closed',async()=>{
 await assert.rejects(()=>invokeDevObserver(args,'',{identityToken:'a'.repeat(40)}),/observer_not_configured/);
 await assert.rejects(()=>invokeDevObserver(args,base,{identityToken:'a'.repeat(40),fetchImpl:async()=>({status:403})}),/PERMISSION_BLOCKED/);
 await assert.rejects(()=>invokeDevObserver(args,base,{identityToken:'a'.repeat(40),fetchImpl:async()=>({status:200,ok:true,text:async()=> 'x'.repeat(16385)})}),/observer_response_too_large/);
});
test('deny malformed or secret-bearing observer results',async()=>{
 for (const result of [{task:'describe_dev_build',environment:'dev',resource:'x'},
  {task:args.task,environment:'test',resource:'x'},
  {task:args.task,environment:'dev',resource:'x',access_token:'secret'}]){
   await assert.rejects(()=>invokeDevObserver(args,base,{identityToken:'a'.repeat(40),fetchImpl:async()=>({status:200,ok:true,text:async()=>JSON.stringify(result)})}),/observer_invalid_response/);
 }
});

test('reject wrong resource and unproven source sha',async()=>{
 for(const data of [
   {resource:'projects/jscc-prod/locations/europe-west1/services/'+service},
   {source_sha:'a'.repeat(40)},
 ]) {
   const result={environment:'dev',task:args.task,
     resource:'projects/jscc-dev/locations/europe-west1/services/'+service,
     source_sha:'UNKNOWN',observed_at:'2026-11-04T00:00:00Z',
     effective_revisions:[{revision:service+'-00002-42q',percent:100,image_digest:'UNKNOWN'}],
     ...data,
   };
   await assert.rejects(()=>invokeDevObserver(args,base,{identityToken:'a'.repeat(40),fetchImpl:async()=>({status:200,ok:true,text:async()=>JSON.stringify(result)})}),/observer_invalid_response/);
 }
});
