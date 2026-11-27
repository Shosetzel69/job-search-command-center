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
