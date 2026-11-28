import test from 'node:test';
import assert from 'node:assert/strict';
import {executeApprovedProductJobStep,observeApprovedProductJobStep,cancelApprovedSearchExecution} from '../../scripts/gcp/remote_executor_dev_job_release.mjs';
import {operatorHash} from '../src/dev_operator_contract.mjs';
const sha='a'.repeat(40),old='b'.repeat(40),digest='sha256:'+'c'.repeat(64),oldDigest='sha256:'+'d'.repeat(64),id='254d3513-9c02-4f33-a974-e8e8f8935aa7';
const root='projects/jscc-dev/locations/europe-west1',repo='projects/jscc-shared/locations/europe-west1/repositories/jscc';
const image='europe-west1-docker.pkg.dev/jscc-shared/jscc/jscc-service@',bucket='jscc-dev-runtime-828902654738';
const now=()=>1760000000000,lock={owner:'Shosetzel69',purpose:'GOV85_RELEASE_665',source_sha:sha};
const secret=name=>({name,valueSource:{secretKeyRef:{secret:'NILE_DATABASE_URL',version:'1'}}});
const template=(s,d)=>({taskCount:1,parallelism:1,template:{serviceAccount:'jscc-dev-runtime@jscc-dev.iam.gserviceaccount.com',
 maxRetries:0,timeout:'600s',containers:[{image:image+d,command:['/bin/bash'],args:['-ceu','exit 86'],
 env:[{name:'APP_ENV',value:'dev'},{name:'SOURCE_SHA',value:s},{name:'DB_MIGRATION_MODE',value:'refuse'},
  secret('NILE_DATABASE_URL'),secret('NILE_MIGRATION_DATABASE_URL')]}]}});
const previous={source_sha:old,digest:oldDigest,template_sha256:operatorHash(template(old,oldDigest)),build_id:id};
const candidate={source_sha:sha,digest,template_sha256:operatorHash(template(sha,digest)),build_id:id};
const request={schema_version:'1.0',environment:'dev',work_item_ref:'#589',role:'migration',phase:'stage',source_sha:sha,
 lock_generation:'12',lock_payload_sha256:operatorHash(lock),catalog_generation:'34',previous,candidate,service_revision:null,service_digest:null,
 approval_ref:'#589/100',review_ref:'#589/101',cost_ref:'#589/102',access_ref:'#589/103',compatibility_ref:'#589/104',
 issued_at_ms:now()-1,expires_at_ms:now()+1000};
function fixture({lost=false,role='migration',serviceStaged=true}={}){
 const search=role==='search',pkg=search?'jscc':'jscc-service',baseImage='europe-west1-docker.pkg.dev/jscc-shared/jscc/'+pkg+'@';
 const tpl=(s,d)=>{
  const t=template(s,d);
  if(search){
   const c=t.template.containers[0];c.image=baseImage+d;c.args=['-ceu','fixed search runner'];
   c.env=c.env.filter(e=>!['DB_MIGRATION_MODE','NILE_MIGRATION_DATABASE_URL'].includes(e.name));
   c.env.push({name:'GCP_RUNTIME_BUCKET',value:bucket});
  }
  return t;
 };
 const path=root+'/jobs/'+(search?'jscc-search-dev':'jscc-db-migrate-dev'),records=new Map(),patches=[];
 let current={name:path,etag:'e1',generation:'1',observedGeneration:'1',terminalCondition:{state:'CONDITION_SUCCEEDED'},template:tpl(old,oldDigest)};
 const servicePath=root+'/services/jscc-command-api-dev',rev='jscc-command-api-dev-candidate',oldRev='jscc-command-api-dev-previous';
 const serviceDigest='sha256:'+'e'.repeat(64);
 const store={get:async p=>records.get(p)??null,create:async(p,data)=>{
  if(records.has(p))throw Error('generation_precondition_failed');records.set(p,{generation:'1',data:structuredClone(data)});
 }};
 const fetchImpl=async(url,init)=>{
  const u=new URL(url),p=u.pathname;
  if(init.method==='PATCH'){
   assert.equal(p,'/v2/'+path);assert.equal(u.searchParams.get('updateMask'),'template');
   const body=JSON.parse(init.body);assert.equal(body.etag,current.etag);patches.push({body,validate:u.searchParams.get('validateOnly')});
   if(u.searchParams.get('validateOnly')==='false'){
    current={...current,template:body.template,etag:'e2'};
    if(lost)throw Error('lost');
   }
   return Response.json({name:root+'/operations/op',done:true});
  }
  assert.equal(init.method,'GET');
  if(p.endsWith('/'+repo))return Response.json({name:repo,dockerConfig:{immutableTags:true}});
  if(p.includes('/tags/')){const s=p.split('/').at(-1),d=s===sha?digest:oldDigest,name=repo+'/packages/'+pkg+'/tags/'+s;
   return Response.json({name,version:repo+'/packages/'+pkg+'/versions/'+d});}
  if(p.endsWith('/builds/'+id)){
   // Determine target from current template (stage vs restore).
   const target=current.template.template.containers[0].image===baseImage+digest?old:sha,d=target===sha?digest:oldDigest;
   return Response.json({name:'projects/jscc-shared/locations/europe-west1/builds/'+id,id,
    serviceAccount:'projects/jscc-shared/serviceAccounts/jscc-build@jscc-shared.iam.gserviceaccount.com',status:'SUCCESS',
    substitutions:{_GIT_SHA:target},results:{images:[{name:baseImage.slice(0,-1)+':'+target,digest:d}]}});
  }
  if(p.endsWith('/locks%2Fheavy-search.lock'))return Response.json(u.searchParams.get('alt')==='media'?lock:{bucket,name:'locks/heavy-search.lock',generation:'12'});
  if(p.endsWith('/active.json'))return new Response(null,{status:404});
  if(p.endsWith('/seed%2Fsources.json'))return Response.json({bucket,name:'seed/sources.json',generation:'34'});
  if(p.endsWith('/executions'))return Response.json({executions:[]});
  if(p.endsWith('/'+servicePath))return Response.json({name:servicePath,generation:'1',observedGeneration:'1',
   terminalCondition:{state:'CONDITION_SUCCEEDED'},trafficStatuses:serviceStaged?
    [{revision:oldRev,percent:100},{revision:rev,percent:0,tag:'candidate'}]:[{revision:rev,percent:100}]});
  if(p.endsWith('/'+servicePath+'/revisions/'+rev))return Response.json({name:servicePath+'/revisions/'+rev,
   serviceAccount:'jscc-dev-runtime@jscc-dev.iam.gserviceaccount.com',conditions:[{type:'Ready',state:'CONDITION_SUCCEEDED'}],
   containers:[{image:image+serviceDigest,env:[{name:'SOURCE_SHA',value:sha},{name:'RUNTIME_DATA_SHA',value:sha}]}]});
  if(p.endsWith('/'+path))return Response.json(current);
  assert.fail(url);
 };
 return {patches,tpl,rev,serviceDigest,options:{store,fetchImpl,now,verifyAuthority:async()=>true,getToken:async()=> 'fixture',wait:async()=>{}}};
}
test('migration stage and independently approved restore change only digest and source SHA, preserve refuse',async()=>{
 const f=fixture(),run=x=>executeApprovedProductJobStep(x,{...f.options,trustedRecordHash:operatorHash(x)});
 const staged=await run(request);assert.equal(staged.state,'OBSERVED');assert.equal(staged.template_sha256,candidate.template_sha256);
 assert.deepEqual(f.patches[1].body.template,template(sha,digest));
 assert.equal((await run(request)).state,'ALREADY_CLAIMED');assert.equal(f.patches.length,2);
 const restored=await run({...request,phase:'restore',approval_ref:'#589/200'});
 assert.equal(restored.state,'OBSERVED');assert.deepEqual(f.patches[3].body.template,template(old,oldDigest));
 assert.equal(restored.lock_release_authorized,false);
});
test('foreign environment, unauthorized authority, wrong target hash and lost receipt cannot dispatch a second mutation',async()=>{
 const f=fixture(),run=x=>executeApprovedProductJobStep(x,{...f.options,trustedRecordHash:operatorHash(x)});
 await assert.rejects(()=>run({...request,environment:'prod'}));
 await assert.rejects(()=>run({...request,candidate:{...candidate,template_sha256:'0'.repeat(64)}}));
 await assert.rejects(()=>executeApprovedProductJobStep(request,{...f.options,verifyAuthority:async()=>false,trustedRecordHash:operatorHash(request)}));
 assert.equal(f.patches.length,0);
 const l=fixture({lost:true}),again=()=>executeApprovedProductJobStep(request,{...l.options,trustedRecordHash:operatorHash(request)});
 assert.equal((await again()).state,'RECOVERY_REQUIRED');assert.equal((await again()).state,'ALREADY_CLAIMED');
 assert.equal(l.patches.length,2);
});

test('Search Job image-only update requires independently admitted zero-traffic Service stage',async()=>{
 const f=fixture({role:'search'}),x={...request,role:'search',service_revision:f.rev,service_digest:f.serviceDigest,
  previous:{...previous,template_sha256:operatorHash(f.tpl(old,oldDigest))},
  candidate:{...candidate,template_sha256:operatorHash(f.tpl(sha,digest))}};
 const out=await executeApprovedProductJobStep(x,{...f.options,trustedRecordHash:operatorHash(x)});
 assert.equal(out.state,'OBSERVED');assert.deepEqual(f.patches[1].body.template,f.tpl(sha,digest));
 const g=fixture({role:'search',serviceStaged:false});
 await assert.rejects(()=>executeApprovedProductJobStep(x,{...g.options,trustedRecordHash:operatorHash(x)}),/service_not_staged/);
 assert.equal(g.patches.length,0);
});
test('lost update receipt can be reconciled without replay or release authorization',async()=>{
 const f=fixture({lost:true}),options={...f.options,trustedRecordHash:operatorHash(request)};
 assert.equal((await executeApprovedProductJobStep(request,options)).state,'RECOVERY_REQUIRED');
 const observed=await observeApprovedProductJobStep(request,{...options,now:()=>now()+10000});
 assert.equal(observed.template_state,'TARGET');assert.equal(observed.receipt_available,false);
 assert.equal(observed.lock_release_authorized,false);assert.equal(f.patches.length,2);
});


test('signed Search cancellation binds exact execution and both marker generations; never releases markers',async()=>{
 const runId='run-254d3513-9c02-4f33-a974-e8e8f8935aa7',execution='jscc-search-dev-fixture',
  signature='1'.repeat(64),scope={source_catalog_generation:'34',scopes:['fixture'],effective_source_ids:['fixture']};
 const descriptor={schema_version:'1.0',run_id:runId,source_sha:sha,request_signature:signature,run_trigger:'manual-ui',
  retrieve_scope:scope,started_at:'2026-11-28T00:00:00Z'};
 const x={schema_version:'1.0',environment:'dev',work_item_ref:'#589',source_sha:sha,digest,
  execution,uid:id,run_id:runId,request_signature:signature,scope_sha256:operatorHash(scope),catalog_generation:'34',
  lock_generation:'12',active_generation:'13',descriptor_sha256:operatorHash(descriptor),
  approval_ref:'#589/300',review_ref:'#589/301',cost_ref:'#589/302',access_ref:'#589/303',recovery_ref:'#589/304',
  issued_at_ms:now()-1,expires_at_ms:now()+1000};
 const path=root+'/jobs/jscc-search-dev/executions/'+execution,records=new Map(),calls=[];
 const store={get:async p=>records.get(p)??null,create:async(p,data)=>{
  if(records.has(p))throw Error('generation_precondition_failed');records.set(p,{generation:'1',data});
 }};
 const fetchImpl=async(url,init)=>{
  const u=new URL(url);calls.push({url,method:init.method});
  if(init.method==='POST'){
   assert.equal(u.pathname,'/v2/'+path+':cancel');assert.deepEqual(JSON.parse(init.body),{etag:'exact'});
   return Response.json({name:root+'/operations/cancel',done:false});
  }
  assert.equal(init.method,'GET');
  if(u.pathname==='/v2/'+path)return Response.json({name:path,job:'jscc-search-dev',uid:id,etag:'exact',taskCount:1,
   template:{serviceAccount:'jscc-dev-runtime@jscc-dev.iam.gserviceaccount.com',containers:[{
    image:'europe-west1-docker.pkg.dev/jscc-shared/jscc/jscc@'+digest,
    env:Object.entries({APP_ENV:'dev',SOURCE_SHA:sha,GCP_RUNTIME_BUCKET:bucket,JSCC_RUN_ID:runId,
     JSCC_REQUEST_SIGNATURE:signature,JSCC_SOURCE_CATALOG_GENERATION:'34',RUN_TRIGGER:'manual-ui',
     JSCC_RETRIEVE_SCOPE_JSON:JSON.stringify(scope)}).map(([name,value])=>({name,value}))}]}});
  const object=decodeURIComponent(u.pathname.split('/o/').at(-1));
  assert.ok(['locks/heavy-search.lock','active.json'].includes(object));
  return Response.json(u.searchParams.get('alt')==='media'?descriptor:{name:object,bucket,generation:object==='active.json'?'13':'12'});
 };
 const options={store,fetchImpl,now,verifyAuthority:async()=>true,getToken:async()=> 'fixture'};
 const run=y=>cancelApprovedSearchExecution(y,{...options,trustedRecordHash:operatorHash(y)});
 await assert.rejects(()=>run({...x,active_generation:'99'}),/marker_mismatch/);
 assert.equal(calls.filter(c=>c.method==='POST').length,0);
 const result=await run(x);assert.equal(result.cancellation_requested,true);
 assert.equal(result.execution_state,'RUNNING_OR_PENDING');assert.equal(result.lock_release_authorized,false);
 assert.equal(result.db_outcome,'UNVERIFIED');
 assert.equal((await run(x)).state,'ALREADY_CLAIMED');
 assert.equal(calls.filter(c=>c.method==='POST').length,1);
 assert.equal(calls.filter(c=>c.method==='DELETE').length,0);
});
