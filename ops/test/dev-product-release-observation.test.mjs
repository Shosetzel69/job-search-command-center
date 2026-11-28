import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {observeProductRelease,observeProductIncident} from '../operator/dev_product_release_observation.mjs';
import {projectOperatorResult} from '../src/dev_operator_contract.mjs';
const sha='a'.repeat(40),actor='b'.repeat(64),digest='sha256:'+'c'.repeat(64);
const id='254d3513-9c02-4f33-a974-e8e8f8935aa7',op='op-test-1234567890';
const root='projects/jscc-dev/locations/europe-west1',sa='jscc-dev-runtime@jscc-dev.iam.gserviceaccount.com';
const name='jscc-command-api-dev',rev=name+'-00001-test',repo='europe-west1-docker.pkg.dev/jscc-shared/jscc/';
const registry='projects/jscc-shared/locations/europe-west1/repositories/jscc';
const request={environment:'dev',source_sha:sha,service_build_id:id,search_build_id:null,nile_operation_id:op};
const secret=k=>({name:k,valueSource:{secretKeyRef:{secret:'NILE_DATABASE_URL',version:'1'}}});
const task=role=>({serviceAccount:sa,containers:[{image:repo+(role==='search'?'jscc':'jscc-service')+'@'+digest,
 env:[{name:'APP_ENV',value:'dev'},{name:'SOURCE_SHA',value:sha},{name:'RUNTIME_DATA_SHA',value:sha},
  {name:'JSCC_RUNTIME_BACKEND',value:'gcp'},{name:'SEARCH_MODE',value:'disabled'},{name:'PRIVATE',value:'never-return'},
  secret('NILE_DATABASE_URL'),...(role==='migration'?[secret('NILE_MIGRATION_DATABASE_URL')]:[])]}]});
function fixture({drift=false,nileRevision=rev}={}){
 let reads=0;
 const fetchImpl=async(url,init)=>{
  assert.equal(init.method,'GET');const u=new URL(url),p=u.pathname;
  if(p.endsWith('/services/'+name))return Response.json({name:root+'/services/'+name,template:task('service'),
   etag:drift?'etag-'+ ++reads:'same',trafficStatuses:[{revision:rev,percent:100}]});
  if(p.endsWith('/revisions/'+rev))return Response.json({name:root+'/services/'+name+'/revisions/'+rev,
   ...task('service'),conditions:[{type:'Ready',state:'CONDITION_SUCCEEDED'}]});
  for(const [role,job] of [['search','jscc-search-dev'],['migration','jscc-db-migrate-dev']])
   if(p.endsWith('/jobs/'+job))return Response.json({name:root+'/jobs/'+job,etag:'same',
    template:{taskCount:1,parallelism:1,template:task(role)}});
  if(p.endsWith('/'+registry))return Response.json({name:registry,dockerConfig:{immutableTags:true}});
  if(p.includes('/tags/')){
   const tag=p.slice(4);return Response.json({name:tag,version:tag.replace('/tags/'+sha,'/versions/'+digest)});
  }
  if(p.endsWith('/builds/'+id))return Response.json({id,name:'projects/jscc-shared/locations/europe-west1/builds/'+id,
   serviceAccount:'projects/jscc-shared/serviceAccounts/jscc-build@jscc-shared.iam.gserviceaccount.com',
   status:'SUCCESS',substitutions:{_GIT_SHA:sha},results:{images:[{name:repo+'jscc-service:'+sha,digest}]}});
  if(p.includes('/o/locks%2Fheavy-search.lock'))return new Response(null,{status:404});
  assert.fail(url);
 };
 const base={operation_id:op,work_item_ref:'#589',task:'observe_dev_nile',operation_state:'SUCCEEDED',
  ops_source_sha:sha,worker_image_digest:digest,gateway_image_digest:digest};
 const readEvidence=async path=>({generation:'1',data:path.startsWith('operations/')?{...base,actor_sub_hash:actor,
  args:{environment:'dev',operation:'schema_inventory',expected_source_sha:sha}}:{...base,exit_code:0,target_source_sha:sha,
  finished_at:'2026-11-28T00:00:00Z',assertions:{nile_status:'COLLECTED',nile_evidence_json:JSON.stringify({
   operation:'schema_inventory',runtime_revision:nileRevision,schema:{database:'jobsearch_dev',read_only:true,
    migration_state:'MATCH',table_state:'PRESENT',migration_checksum:'d'.repeat(64)}})}}});
 return {actor,fetchImpl,readEvidence,now:()=>Date.parse('2026-11-28T00:01:00Z')};
}
test('product observation binds serving revision, jobs, exact tags, provider build and fresh Nile revision evidence',async()=>{
 const out=await observeProductRelease(request,fixture());
 assert.equal(out.product_release.resources.service.build_binding,'PROVIDER_RESULT_MATCH');
 assert.equal(out.product_release.resources.search.build_binding,'UNVERIFIED');
 assert.equal(out.product_release.resources.migration.registry_binding,'MATCH');
 assert.equal(out.product_release.nile_status,'MATCH');
 assert.equal(out.product_release.retrieve_lock,'ABSENT');
 assert.equal(out.product_release.release_authorized,false);
 const req={action:'observe_product_release',operation_id:'op',approval_hash:'hash'};
 assert.deepEqual(projectOperatorResult(req,{generation:'1',data:{...out,...req}}).product_release,out.product_release);
 assert.equal(JSON.stringify(out).includes('never-return'),false);
});
test('revision mismatch and stale Nile results cannot establish readiness; config drift rejects observation',async()=>{
 assert.equal((await observeProductRelease(request,fixture({nileRevision:name+'-old'}))).product_release.nile_status,'UNVERIFIED');
 assert.equal((await observeProductRelease(request,{...fixture(),now:()=>Date.parse('2026-11-28T01:00:00Z')})).product_release.nile_status,'UNVERIFIED');
 await assert.rejects(()=>observeProductRelease(request,fixture({drift:true})),/baseline_drift/);
 await assert.rejects(()=>observeProductRelease({...request,environment:'test'},fixture()));
});


test('incident correlates fresh same-revision account state and Origin but never claims a specific 403 cause',async()=>{
 const f=fixture(),origin='https://dev.example.invalid',hash=createHash('sha256').update(origin).digest('hex');
 const fetchImpl=async(url,init)=>{
  const response=await f.fetchImpl(url,init);
  if(new URL(url).pathname.endsWith('/revisions/'+rev)){
   const data=await response.json();data.containers[0].env.push({name:'FRONTEND_ORIGIN',value:origin});return Response.json(data);
  }return response;
 };
 const readEvidence=async path=>{
  const record=await f.readEvidence(path);
  if(path.startsWith('operations/'))record.data.args.operation='account_readiness';
  else record.data.assertions.nile_evidence_json=JSON.stringify({operation:'account_readiness',runtime_revision:rev,
   account:{database:'jobsearch_dev',read_only:true,scope:'configured_diagnostic_account',state:'NOT_ACTIVE',
    tenant_mapping:'NOT_CHECKED',user_session_verified:false,root_cause:'INSUFFICIENT_EVIDENCE',user_id:'private'},
   origin_config:{state:'HTTPS_ORIGIN',sha256:hash}});
  return record;
 };
 const metrics=async()=>({state:'OBSERVED',metadata:{kind:'service_request_metrics',name,
  start_time:'2026-11-27T23:45:00Z',end_time:'2026-11-28T00:00:00Z',counts:{'4xx':4,'5xx':1},
  pagination_complete:true,request_coverage:'UNVERIFIED'}});
 const x={environment:'dev',source_sha:sha,expected_origin_sha256:hash,account_operation_id:op};
 const run=(v=x,extra={})=>observeProductIncident(v,{...f,fetchImpl,readEvidence,metrics,...extra});
 const out=await run(),m=out.product_incident;
 assert.equal(m.account_state,'NOT_ACTIVE');assert.equal(m.expected_origin_binding,'MATCH');
 assert.equal(m.account_origin_binding,'MATCH');assert.equal(m.http.observed_4xx,4);
 assert.equal(m.root_cause,'INSUFFICIENT_EVIDENCE');assert.equal(m.request_403_correlated,false);
 assert.equal(JSON.stringify(m).includes('private'),false);assert.equal(JSON.stringify(m).includes(origin),false);
 const req={action:'observe_product_incident',operation_id:'op',approval_hash:'hash'};
 assert.deepEqual(projectOperatorResult(req,{generation:'1',data:{...req,...out}}).product_incident,m);
 assert.equal((await run({...x,expected_origin_sha256:'0'.repeat(64)})).product_incident.expected_origin_binding,'MISMATCH');
 const unavailable=await run(x,{readEvidence:async()=>null,metrics:async()=>{throw Error('denied');}});
 assert.equal(unavailable.product_incident.account_state,'UNVERIFIED');assert.equal(unavailable.product_incident.http,null);
 await assert.rejects(()=>run({...x,environment:'prod'}));
});
