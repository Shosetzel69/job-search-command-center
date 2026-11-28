import test from 'node:test';
import assert from 'node:assert/strict';
import {executeDevGcsArtifact} from '../operator/dev_gcs_artifacts.mjs';
const bucket='jscc-shared-ops-cloudbuild-source',source='source/dev-'+'a'.repeat(40)+'-source123.tar.gz';
const destination='source/dev-'+'a'.repeat(40)+'-restore123.tar.gz';
const crc='AAAAAA==',md5='A'.repeat(22)+'==';
const input={environment:'dev',operation:'copy_generation',source,source_generation:'12',destination,
 expected_md5:md5,expected_crc32c:crc};
const meta=(name,generation)=>({bucket,name,generation,size:'10',crc32c:crc,md5Hash:md5,metadata:{private:'ignore'}});
test('exact-generation copy uses create-only destination and confirms checksum readback',async()=>{
 const calls=[];
 const result=await executeDevGcsArtifact(input,{fetchImpl:async(url,init)=>{
  calls.push([url,init.method]);
  const q=new URL(url).searchParams;
  if(init.method==='POST'){
   assert.equal(q.get('ifGenerationMatch'),'0');
   assert.equal(q.get('sourceGeneration'),'12');
   assert.equal(q.get('ifSourceGenerationMatch'),'12');
   return Response.json({done:true,resource:meta(destination,'13')});
  }
  return Response.json(q.get('generation')==='12'?meta(source,'12'):meta(destination,'13'));
 }});
 assert.equal(result.state,'SUCCEEDED');
 assert.equal(result.artifact_metadata.generation,'13');
 assert.equal(result.artifact_metadata.md5,md5);
 assert.equal(JSON.stringify(result).includes('private'),false);
 assert.deepEqual(calls.map(x=>x[1]),['GET','POST','GET']);
});
test('foreign target, source drift, rewrite continuation and overwrite attempts fail closed',async()=>{
 for(const bad of [{...input,environment:'test'},{...input,source:'control/v1/approvals/a.json'},
  {...input,destination:source},{...input,destination:'source/../../bad'},{...input,ifGenerationMatch:'1'}])
  await assert.rejects(()=>executeDevGcsArtifact(bad,{fetchImpl:async()=>assert.fail('unexpected API')}));
 let calls=0;
 await assert.rejects(()=>executeDevGcsArtifact(input,{fetchImpl:async()=>{calls++;return Response.json({...meta(source,'12'),md5Hash:'B'.repeat(22)+'=='});}}));
 assert.equal(calls,1);
 calls=0;
 await assert.rejects(()=>executeDevGcsArtifact(input,{fetchImpl:async()=>++calls===1?Response.json(meta(source,'12')):Response.json({done:false,rewriteToken:'token'})}),/outcome_unknown/);
 assert.equal(calls,2);
});
test('runtime snapshot is metadata-only with exact DEV bucket, never media or mutation',async()=>{
 const runtime='jscc-dev-runtime-828902654738',object='runs/run-test/jobs.json';
 const input={environment:'dev',operation:'metadata',bucket:runtime,object,generation:null};
 const result=await executeDevGcsArtifact(input,{fetchImpl:async(url,init)=>{
  assert.equal(init.method,'GET');assert.equal(new URL(url).searchParams.has('alt'),false);
  return Response.json({...meta(object,'15'),bucket:runtime});
 }});
 assert.equal(result.state,'OBSERVED');
 await assert.rejects(()=>executeDevGcsArtifact({...input,bucket:'jscc-test-runtime-1'},{fetchImpl:async()=>assert.fail('unexpected API')}));
});

const cleanup={environment:'dev',operation:'cleanup_generation',bucket,object:source,generation:'12',
 expected_md5:md5,expected_crc32c:crc};
test('cleanup binds exact transient generation and confirms normal readability is gone',async()=>{
 const calls=[];
 const result=await executeDevGcsArtifact(cleanup,{assertFresh:()=>{},fetchImpl:async(url,init)=>{
  calls.push(init.method);const q=new URL(url).searchParams;
  assert.equal(q.get('generation'),'12');
  if(init.method==='DELETE'){assert.equal(q.get('ifGenerationMatch'),'12');return new Response(null,{status:204});}
  return calls.length===1?Response.json(meta(source,'12')):new Response(null,{status:404});
 }});
 assert.deepEqual(calls,['GET','DELETE','GET']);
 assert.equal(result.generation_no_longer_live,true);
 assert.equal(result.artifact_metadata.generation,'12');
});
test('restore is create-only, exact soft-deleted generation and verified checksum readback',async()=>{
 const calls=[];
 const result=await executeDevGcsArtifact({...cleanup,operation:'restore_soft_deleted'},{
  assertFresh:()=>{},now:()=>Date.parse('2026-11-28T00:00:00Z'),fetchImpl:async(url,init)=>{
   calls.push(init.method);const q=new URL(url).searchParams;
   if(init.method==='POST'){
    assert.equal(q.get('generation'),'12');
    assert.equal(q.get('ifGenerationMatch'),'0');
    assert.equal(q.get('copySourceAcl'),'false');
    assert.equal(init.body,undefined);
    return Response.json(meta(source,'13'));
   }
   if(calls.length===1){
    assert.equal(q.get('softDeleted'),'true');
    return Response.json({...meta(source,'12'),softDeleteTime:'2026-11-27T00:00:00Z',hardDeleteTime:'2026-12-01T00:00:00Z'});
   }
   assert.equal(q.get('generation'),'13');return Response.json(meta(source,'13'));
  }});
 assert.deepEqual(calls,['GET','POST','GET']);
 assert.equal(result.prior_generation,'12');
 assert.equal(result.artifact_metadata.generation,'13');
});
test('cleanup/restore deny runtime objects, missing fresh admission and stale checksums',async()=>{
 for(const bad of [{...cleanup,bucket:'jscc-dev-runtime-828902654738'},
  {...cleanup,object:'control/v1/approvals/x.json'},{...cleanup,generation:'0'}])
  await assert.rejects(()=>executeDevGcsArtifact(bad,{assertFresh:()=>{},fetchImpl:async()=>assert.fail('unexpected API')}));
 await assert.rejects(()=>executeDevGcsArtifact(cleanup,{fetchImpl:async()=>assert.fail('unexpected API')}));
 let calls=0;
 await assert.rejects(()=>executeDevGcsArtifact(cleanup,{assertFresh:()=>{},fetchImpl:async()=>{
  calls++;return Response.json({...meta(source,'12'),md5Hash:'B'.repeat(22)+'=='});
 }}),/source_mismatch/);
 assert.equal(calls,1);
});
