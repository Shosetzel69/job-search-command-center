import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {prepareDevSourceArchive,stageIndependentDevSource,stageDevSourceRemotely,publishApprovalRemotely,inspectDevPublisher,DEV_PUBLISHER_ORIGIN,DEV_PUBLISHER_AUDIENCE} from '../../scripts/gcp/remote_executor_dev_publish_approval.mjs';
import {operatorHash} from '../src/dev_operator_contract.mjs';

const now=()=>1760000000000;
const bytes=Buffer.from('synthetic reviewed archive');
const sha='a'.repeat(40),digest='sha256:'+createHash('sha256').update(bytes).digest('hex');
const bucket='jscc-shared-ops-cloudbuild-source';
const request={environment:'dev',work_item_ref:'#589',source_sha:sha,trusted_ref:'refs/heads/main'};
const record=()=>({schema_version:'1.0',request,approval_ref:'#589/11',review_ref:'#589/12',
 cost_ref:'#589/13',archive_sha256:digest,issued_at_ms:now()-1,expires_at_ms:now()+1000});
function setup({badReadback=false,collision=false}={}){
 const calls=[];
 const options={now,materialize:async plan=>{
  assert.equal(plan.source_sha,sha);
  assert.equal(plan.trusted_ref,request.trusted_ref);
  return bytes;
 },getToken:async()=>'fixture-token',fetchImpl:async(url,init)=>{
  calls.push({url,init});
  assert.equal(init.redirect,'error');
  const u=new URL(url);
  if(init.method==='POST'){
   assert.equal(u.pathname,'/upload/storage/v1/b/'+bucket+'/o');
   assert.equal(u.searchParams.get('ifGenerationMatch'),'0');
   assert.match(u.searchParams.get('name'),/^source\/dev-[a-f0-9]{40}-[a-f0-9]{64}\.tar\.gz$/);
   assert.deepEqual(init.body,bytes);
   if(collision)return new Response(null,{status:412});
   return Response.json({bucket,name:u.searchParams.get('name'),generation:'123',size:String(bytes.length)});
  }
  assert.equal(u.searchParams.get('generation'),'123');
  assert.equal(u.searchParams.get('alt'),'media');
  return new Response(badReadback?'bad':bytes,{headers:{'x-goog-generation':'123'}});
 }};
 return {calls,options};
}
const run=(a,s)=>stageIndependentDevSource(a,{...s.options,trustedRecordHash:operatorHash(a)});
test('prepare is read-only; independently pinned staging returns exact generation and hash',async()=>{
 const s=setup(),a=record();
 assert.deepEqual(await prepareDevSourceArchive(request,s.options),{bytes,sha256:digest,size:bytes.length});
 assert.equal(s.calls.length,0);
 const receipt=await run(a,s);
 assert.equal(receipt.bucket,bucket);
 assert.equal(receipt.generation,'123');
 assert.equal(receipt.sha256,digest);
 assert.equal(s.calls.length,2);
});
test('source staging rejects invalid scope, digest, expired or unauthenticated pin before upload',async()=>{
 const s=setup(),a=record();
 await assert.rejects(()=>stageIndependentDevSource(a,{...s.options,trustedRecordHash:'0'.repeat(64)}),/stage_approval_denied/);
 for(const bad of [{...a,request:{...request,environment:'prod'}},
  {...a,request:{...request,trusted_ref:'refs/heads/feature'}},
  {...a,archive_sha256:'sha256:'+'0'.repeat(64)},{...a,expires_at_ms:now()}])
  await assert.rejects(()=>run(bad,s));
 assert.equal(s.calls.length,0);
});
test('collision and mismatched readback fail without automatic overwrite or retry',async()=>{
 const a=record(),c=setup({collision:true}),b=setup({badReadback:true});
 await assert.rejects(()=>run(a,c),/stage_upload_uncertain/);
 assert.equal(c.calls.length,1);
 await assert.rejects(()=>run(a,b),/stage_readback_mismatch/);
 assert.equal(b.calls.length,2);
});

test('independent remote source client binds exact endpoint, token audience, archive and receipt',async()=>{
 const a=record(),pin=operatorHash(a),object='source/dev-'+sha+'-'+createHash('sha256').update(a.approval_ref).digest('hex')+'.tar.gz';
 let calls=0;
 const opts={now,trustedRecordHash:pin,materialize:async()=>bytes,getIdentityToken:async audience=>{
  assert.equal(audience,DEV_PUBLISHER_AUDIENCE);return 'a.b.c';
 },fetchImpl:async(url,init)=>{
  calls++;assert.equal(url,DEV_PUBLISHER_ORIGIN+'/v1/source');assert.equal(init.method,'POST');
  assert.equal(init.redirect,'error');assert.equal(init.headers.Authorization,'Bearer a.b.c');
  assert.deepEqual(JSON.parse(init.body),{record:a,trusted_record_hash:pin,archive_base64:bytes.toString('base64')});
  return Response.json({bucket,object,generation:'123',sha256:digest});
 }};
 assert.equal((await stageDevSourceRemotely(a,opts)).generation,'123');assert.equal(calls,1);
 await assert.rejects(()=>stageDevSourceRemotely(a,{...opts,trustedRecordHash:'0'.repeat(64)}),/admission_denied/);
 assert.equal(calls,1);
 let failures=0;
 await assert.rejects(()=>stageDevSourceRemotely(a,{...opts,fetchImpl:async()=>{
  failures++;return new Response(null,{status:503});
 }}),/outcome_unverified/);
 assert.equal(failures,1);
});
test('remote approval client verifies independent record pin and exact protected operation receipt',async()=>{
 const {operatorPaths}=await import('../src/dev_operator_contract.mjs');
 const actor='b'.repeat(64),bundle={environment:'dev',kind:'billing_status',name:'jscc-dev'};
 const a={schema_version:'1.0',environment:'dev',work_item_ref:'#589',approval_ref:'#589/21',
  action:'gcp_metadata',actor_sub_hash:actor,operator_source_sha:sha,bundle,bundle_hash:operatorHash(bundle),
  cost_ref:'#589/22',review_ref:'#589/23',issued_at_ms:now()-1,expires_at_ms:now()+1000};
 const pin=operatorHash(a),receipt={approval_ref:a.approval_ref,operation_id:operatorPaths(a.approval_ref).key,
  generation:'123',record_hash:pin};
 let calls=0;
 const opts={now,actor,sourceSha:sha,trustedRecordHash:pin,getIdentityToken:async()=> 'a.b.c',
  fetchImpl:async(url,init)=>{
   calls++;assert.equal(url,DEV_PUBLISHER_ORIGIN+'/v1/approval');
   assert.deepEqual(JSON.parse(init.body),{record:a,trusted_record_hash:pin});
   return Response.json(receipt);
  }};
 assert.deepEqual(await publishApprovalRemotely(a,opts),receipt);
 await assert.rejects(()=>publishApprovalRemotely(a,{...opts,actor:'c'.repeat(64)}));
 assert.equal(calls,1);
 await assert.rejects(()=>publishApprovalRemotely(a,{...opts,fetchImpl:async()=>Response.json({...receipt,generation:'0'})}),
  /receipt_mismatch/);
});


test('independent client checks exact publisher and operator source pins via read-only status',async()=>{
 const value={environment:'dev',service:'jscc-ops-publisher-dev',publisher_source_sha:sha,operator_source_sha:sha,
  identity_binding:'AUTHENTICATED',storage_permissions:'UNVERIFIED',publication_authorized:false};
 const options={publisherSourceSha:sha,operatorSourceSha:sha,getIdentityToken:async audience=>{
  assert.equal(audience,DEV_PUBLISHER_AUDIENCE);return 'a.b.c';
 },fetchImpl:async(url,init)=>{
  assert.equal(url,DEV_PUBLISHER_ORIGIN+'/v1/status');assert.equal(init.method,'GET');assert.equal(init.body,undefined);
  return Response.json(value);
 }};
 assert.deepEqual(await inspectDevPublisher(options),value);
 await assert.rejects(()=>inspectDevPublisher({...options,operatorSourceSha:'f'.repeat(40)}),/status_mismatch/);
});
