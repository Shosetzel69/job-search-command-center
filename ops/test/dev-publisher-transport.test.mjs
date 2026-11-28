import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {publisherRuntimeConfig,authorizePublisher,createPublisherHandler} from '../publisher/server.mjs';
const sha='a'.repeat(40),actor='b'.repeat(64),sub='123456789012345678901',email='independent-authority-dev@jscc-dev.iam.gserviceaccount.com';
const config={email,sub,actor,operatorSourceSha:sha,publisherSourceSha:sha};
const record={approval_ref:'#589/1',review_ref:'#589/2',cost_ref:'#589/3',actor_sub_hash:actor,operator_source_sha:sha};
const body={record,trusted_record_hash:'c'.repeat(64)};
const req=(path='/v1/approval',value=body,headers={})=>new Request('https://fixture.invalid'+path,{
 method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer test.token.value',...headers},body:JSON.stringify(value)});
test('publisher is separate, default disabled and requires independent exact DEV identity',async()=>{
 assert.equal(await publisherRuntimeConfig({}),null);
 const env={K_SERVICE:'jscc-ops-publisher-dev',GCP_PROJECT:'jscc-dev',GCP_REGION:'europe-west1',SOURCE_SHA:sha,
  JSCC_DEV_PUBLISHER_ENABLED:'true',JSCC_DEV_PUBLISHER_CALLER_EMAIL:email,JSCC_DEV_PUBLISHER_CALLER_SUB:sub,
  JSCC_DEV_PUBLISHER_ACTOR_SUB_HASH:actor,JSCC_DEV_PUBLISHER_OPERATOR_SOURCE_SHA:sha};
 const opts={readSource:async()=>sha,fetchImpl:async()=>new Response('jscc-ops-publisher-dev@jscc-dev.iam.gserviceaccount.com')};
 assert.deepEqual(await publisherRuntimeConfig(env,opts),config);
 for(const change of [{GCP_PROJECT:'jscc-prod'},{JSCC_DEV_PUBLISHER_CALLER_EMAIL:'jscc-ops-gateway-dev@jscc-dev.iam.gserviceaccount.com'},
  {JSCC_DEV_PUBLISHER_CALLER_EMAIL:'jscc-ops-operator-dev@jscc-dev.iam.gserviceaccount.com'}])
  await assert.rejects(()=>publisherRuntimeConfig({...env,...change},opts));
 await assert.rejects(()=>publisherRuntimeConfig(env,{...opts,fetchImpl:async()=>new Response(email)}));
 assert.equal((await createPublisherHandler(null)(req())).status,404);
 for(const role of ['gateway','worker','operator'])
  assert.doesNotMatch(readFileSync(new URL('../Dockerfile.'+role,import.meta.url),'utf8'),/ops\/publisher|remote_executor_dev_publish_approval/);
});
test('Google token binds audience, independent service account subject and email; browser credentials denied',async()=>{
 const valid={aud:'urn:jscc:ops:dev:publisher',sub,email,email_verified:true};
 const verify=payload=>async(_token,_jwks,opts)=>{
  assert.equal(opts.audience,valid.aud);assert.deepEqual(opts.algorithms,['RS256']);return {payload};
 };
 assert.equal(await authorizePublisher(req(),config,verify(valid)),true);
 for(const payload of [{...valid,sub:'999999'},{...valid,email:'other@example.org'},{...valid,aud:'urn:jscc:ops:dev'},{...valid,email_verified:false}])
  assert.equal(await authorizePublisher(req(),config,verify(payload)),false);
 assert.equal(await authorizePublisher(req('/v1/approval',body,{Cookie:'a=b'}),config,verify(valid)),false);
});
test('only independent authenticated transport can deliver exact pinned approval or archive',async()=>{
 let published=0,staged=0;
 const handler=createPublisherHandler(config,{authorize:async()=>true,publish:async(value,opts)=>{
  published++;assert.deepEqual(value,record);assert.equal(opts.actor,actor);assert.equal(opts.sourceSha,sha);
  assert.equal(opts.trustedRecordHash,body.trusted_record_hash);return {approval_ref:value.approval_ref};
 },stage:async(value,opts)=>{
  staged++;assert.deepEqual(value,record);assert.deepEqual(await opts.materialize(),Buffer.from('archive'));
  return {generation:'1'};
 }});
 assert.equal((await handler(req())).status,200);
 assert.equal((await handler(req('/v1/source',{...body,archive_base64:Buffer.from('archive').toString('base64')}))).status,200);
 for(const invalid of [{...body,record:{...record,actor_sub_hash:'d'.repeat(64)}},
  {...body,record:{...record,review_ref:record.approval_ref}},{...body,extra:true}])
  assert.equal((await handler(req('/v1/approval',invalid))).status,400);
 assert.equal((await handler(req('/v1/source',{...body,archive_base64:'!!!'}))).status,503);
 assert.equal(published,1);assert.equal(staged,1);
 assert.equal((await createPublisherHandler(config,{authorize:async()=>false,publish:async()=>assert.fail('publish')})(req())).status,403);
});
test('uncertain publisher receipt is not replayed automatically',async()=>{
 let calls=0;
 const handler=createPublisherHandler(config,{authorize:async()=>true,publish:async()=>{calls++;throw Error('private provider detail');}});
 const response=await handler(req());
 assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:'publisher_outcome_unverified',automatic_retry:false});
 assert.equal(calls,1);
});


test('publisher status is independently authenticated and returns only exact configured source pins',async()=>{
 const request=new Request('https://fixture.invalid/v1/status',{headers:{Authorization:'Bearer test.token.value'}});
 const opts={authorize:async()=>true,publish:async()=>assert.fail('publish'),stage:async()=>assert.fail('stage')};
 const handler=createPublisherHandler(config,opts);
 const response=await handler(request);assert.equal(response.status,200);
 const value=await response.json();
 assert.deepEqual(value,{environment:'dev',service:'jscc-ops-publisher-dev',publisher_source_sha:sha,
  operator_source_sha:sha,identity_binding:'AUTHENTICATED',storage_permissions:'UNVERIFIED',publication_authorized:false});
 assert.equal(JSON.stringify(value).includes(email),false);
 assert.equal((await createPublisherHandler(config,{...opts,authorize:async()=>false})(request)).status,403);
 assert.equal((await createPublisherHandler(null,opts)(request)).status,404);
 assert.equal((await handler(req('/v1/status'))).status,405);
});
