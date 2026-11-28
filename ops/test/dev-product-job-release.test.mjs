import test from 'node:test';
import assert from 'node:assert/strict';
import {executeApprovedProductJobStep} from '../../scripts/gcp/remote_executor_dev_job_release.mjs';
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
function fixture({lost=false}={}){
 const path=root+'/jobs/jscc-db-migrate-dev',records=new Map(),patches=[];
 let current={name:path,etag:'e1',generation:'1',observedGeneration:'1',terminalCondition:{state:'CONDITION_SUCCEEDED'},template:template(old,oldDigest)};
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
  if(p.includes('/tags/')){const s=p.split('/').at(-1),d=s===sha?digest:oldDigest,name=repo+'/packages/jscc-service/tags/'+s;
   return Response.json({name,version:repo+'/packages/jscc-service/versions/'+d});}
  if(p.endsWith('/builds/'+id)){
   // Determine target from current template (stage vs restore).
   const target=current.template.template.containers[0].image===image+digest?old:sha,d=target===sha?digest:oldDigest;
   return Response.json({name:'projects/jscc-shared/locations/europe-west1/builds/'+id,id,
    serviceAccount:'projects/jscc-shared/serviceAccounts/jscc-build@jscc-shared.iam.gserviceaccount.com',status:'SUCCESS',
    substitutions:{_GIT_SHA:target},results:{images:[{name:image.slice(0,-1)+':'+target,digest:d}]}});
  }
  if(p.endsWith('/locks%2Fheavy-search.lock'))return Response.json(u.searchParams.get('alt')==='media'?lock:{bucket,name:'locks/heavy-search.lock',generation:'12'});
  if(p.endsWith('/active.json'))return new Response(null,{status:404});
  if(p.endsWith('/seed%2Fsources.json'))return Response.json({bucket,name:'seed/sources.json',generation:'34'});
  if(p.endsWith('/executions'))return Response.json({executions:[]});
  if(p.endsWith('/'+path))return Response.json(current);
  assert.fail(url);
 };
 return {patches,options:{store,fetchImpl,now,verifyAuthority:async()=>true,getToken:async()=> 'fixture',wait:async()=>{}}};
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
