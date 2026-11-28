import test from 'node:test';
import assert from 'node:assert/strict';
import {submitApprovedNile013,observeApprovedNile013} from '../../scripts/gcp/remote_executor_dev_nile_013.mjs';
import {operatorHash} from '../src/dev_operator_contract.mjs';
const sha='a'.repeat(40),digest='sha256:'+'b'.repeat(64),id='254d3513-9c02-4f33-a974-e8e8f8935aa7';
const root='projects/jscc-dev/locations/europe-west1',path=root+'/jobs/jscc-db-migrate-dev';
const repo='projects/jscc-shared/locations/europe-west1/repositories/jscc';
const image='europe-west1-docker.pkg.dev/jscc-shared/jscc/jscc-service';
const bucket='jscc-dev-runtime-828902654738';
const now=()=>1760000000000;
const lock={owner:'Shosetzel69',purpose:'GOV85_RELEASE_665',source_sha:sha};
const secret=name=>({name,valueSource:{secretKeyRef:{secret:'NILE_DATABASE_URL',version:'1'}}});
const template={taskCount:1,parallelism:1,template:{serviceAccount:'jscc-dev-runtime@jscc-dev.iam.gserviceaccount.com',
 maxRetries:0,timeout:'600s',containers:[{image:image+'@'+digest,command:['/bin/bash'],args:['-ceu','exit 86'],
 env:[{name:'APP_ENV',value:'dev'},{name:'SOURCE_SHA',value:sha},{name:'DB_MIGRATION_MODE',value:'refuse'},
  secret('NILE_DATABASE_URL'),secret('NILE_MIGRATION_DATABASE_URL')]}]}};
const request={schema_version:'1.0',environment:'dev',work_item_ref:'#589',mode:'inspect',source_sha:sha,
 service_digest:digest,build_id:id,script_sha256:'c'.repeat(64),
 migration_checksum:'e30fdd8d16e9ec085c97d61011cf27d86ef91056329c8d5ebec3f030ee6aa38a',
 job_template_sha256:operatorHash(template),lock_generation:'12',lock_payload_sha256:operatorHash(lock),
 catalog_generation:'34',approval_ref:'#589/100',review_ref:'#589/101',cost_ref:'#589/102',access_ref:'#589/103',
 restore_ref:'#589/104',inspection_ref:null,inspection_execution:null,issued_at_ms:now()-1,expires_at_ms:now()+1000};
function fixture({drift=false,lost=false}={}){
 const records=new Map(),posts=[];
 const store={get:async p=>records.get(p)??null,create:async(p,data)=>{
  if(records.has(p))throw Error('generation_precondition_failed');
  records.set(p,{generation:'1',data:structuredClone(data)});
 }};
 const fetchImpl=async(url,init)=>{
  const u=new URL(url),p=u.pathname;
  if(init.method==='POST'){
   posts.push({url,body:JSON.parse(init.body)});
   if(lost)throw Error('lost');
   return Response.json({name:root+'/operations/op',metadata:{name:path+'/executions/jscc-db-migrate-dev-test'}});
  }
  assert.equal(init.method,'GET');
  if(p.endsWith('/'+repo))return Response.json({name:repo,dockerConfig:{immutableTags:true}});
  if(p.includes('/tags/'))return Response.json({name:repo+'/packages/jscc-service/tags/'+sha,
   version:repo+'/packages/jscc-service/versions/'+digest});
  if(p.endsWith('/builds/'+id))return Response.json({name:'projects/jscc-shared/locations/europe-west1/builds/'+id,id,
   serviceAccount:'projects/jscc-shared/serviceAccounts/jscc-build@jscc-shared.iam.gserviceaccount.com',
   status:'SUCCESS',substitutions:{_GIT_SHA:sha},results:{images:[{name:image+':'+sha,digest}]}});
  if(p.endsWith('/locks%2Fheavy-search.lock')){
   if(u.searchParams.get('alt')==='media')return Response.json(lock);
   return Response.json({bucket,name:'locks/heavy-search.lock',generation:drift?'99':'12'});
  }
  if(p.endsWith('/active.json'))return new Response(null,{status:404});
  if(p.endsWith('/seed%2Fsources.json'))return Response.json({bucket,name:'seed/sources.json',generation:'34'});
  if(p.endsWith('/executions'))return Response.json({executions:[]});
  if(p.endsWith('/'+path))return Response.json({name:path,etag:'fixed-etag',template});
  assert.fail(url);
 };
 return {posts,records,options:{store,fetchImpl,now,verifyAuthority:async()=>true,getToken:async()=> 'fixture'}};
}
test('dedicated release adapter runs one pinned inspect with exact script hash, refused default and no generic SQL',async()=>{
 const f=fixture(),run=x=>submitApprovedNile013(x,{...f.options,trustedRecordHash:operatorHash(x)});
 const result=await run(request);
 assert.equal(result.state,'SUBMITTED');assert.equal(result.execution,'jscc-db-migrate-dev-test');
 assert.equal(f.posts.length,1);
 const body=f.posts[0].body;
 assert.equal(body.etag,'fixed-etag');assert.equal(body.overrides.taskCount,1);
 assert.deepEqual(body.overrides.containerOverrides[0].env,[{name:'EVALUATION013_MODE',value:'inspect'}]);
 assert.ok(body.overrides.containerOverrides[0].args[1].includes(request.migration_checksum));
 assert.ok(body.overrides.containerOverrides[0].args[1].includes('command-api/migrations/013_profile_job_evaluation_listing.sql'));
 assert.match(body.overrides.containerOverrides[0].args[1],/sha256sum -c --status; exec node 'command-api\/scripts\/db-evaluation-migrate-013.mjs'/);
 assert.equal((await run(request)).state,'ALREADY_CLAIMED');assert.equal(f.posts.length,1);
});
test('managed migration denies foreign environment, missing inspect approval, lock drift and lost receipt replay',async()=>{
 const f=fixture(),run=x=>submitApprovedNile013(x,{...f.options,trustedRecordHash:operatorHash(x)});
 await assert.rejects(()=>run({...request,environment:'test'}));
 await assert.rejects(()=>run({...request,mode:'apply'}));
 await assert.rejects(()=>submitApprovedNile013(request,{...f.options,verifyAuthority:async()=>false,trustedRecordHash:operatorHash(request)}));
 assert.equal(f.posts.length,0);
 const d=fixture({drift:true});
 await assert.rejects(()=>submitApprovedNile013(request,{...d.options,trustedRecordHash:operatorHash(request)}),/lock_mismatch/);
 assert.equal(d.posts.length,0);
 const l=fixture({lost:true}),launch=()=>submitApprovedNile013(request,{...l.options,trustedRecordHash:operatorHash(request)});
 assert.equal((await launch()).state,'RECOVERY_REQUIRED');assert.equal((await launch()).state,'ALREADY_CLAIMED');
 assert.equal(l.posts.length,1);
});

test('read-only reconciliation uses exact receipt execution, not automatic retry or SQL success claim',async()=>{
 const f=fixture(),options={...f.options,trustedRecordHash:operatorHash(request)};
 const launched=await submitApprovedNile013(request,options);
 const override=f.posts[0].body.overrides.containerOverrides[0];
 const container={...template.template.containers[0],args:override.args,
  env:[...template.template.containers[0].env,...override.env]};
 const out=await observeApprovedNile013(request,{...options,now:()=>now()+100000,
  fetchImpl:async(url,init)=>{
   assert.equal(init.method,'GET');
   assert.equal(url,'https://run.googleapis.com/v2/'+path+'/executions/'+launched.execution);
   return Response.json({name:path+'/executions/'+launched.execution,job:path,taskCount:1,
    template:{...template.template,containers:[container]},completionTime:'2026-11-28T00:00:00Z',
    conditions:[{type:'Completed',state:'CONDITION_SUCCEEDED'}]});
  }});
 assert.equal(out.outcome,'SUCCEEDED');assert.equal(out.sql_outcome,'UNVERIFIED');
 assert.equal(out.template_restore_required,true);assert.equal(f.posts.length,1);
});
