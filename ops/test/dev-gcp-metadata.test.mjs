import test from 'node:test';
import assert from 'node:assert/strict';
import {executeDevGcpMetadata} from '../operator/dev_gcp_metadata.mjs';
import {projectOperatorResult} from '../src/dev_operator_contract.mjs';

test('job inventory exposes configuration metadata, never secret or environment values',async()=>{
 const name='jscc-search-dev';
 const out=await executeDevGcpMetadata({environment:'dev',kind:'run_job',name},{fetchImpl:async(url,init)=>{
  assert.equal(init.method,'GET');
  assert.equal(init.redirect,'error');
  assert.equal(url,'https://run.googleapis.com/v2/projects/jscc-dev/locations/europe-west1/jobs/'+name);
  return Response.json({name:'projects/jscc-dev/locations/europe-west1/jobs/'+name,
   template:{taskCount:1,parallelism:1,template:{maxRetries:0,timeout:'60s',
    serviceAccount:'jscc-search-dev@jscc-dev.iam.gserviceaccount.com',
    containers:[{image:'europe-west1-docker.pkg.dev/jscc-shared/jscc/search@sha256:'+'a'.repeat(64),
     env:[{name:'PRIVATE',value:'not-returned'},{name:'DB',valueSource:{secretKeyRef:{secret:'NILE_DATABASE_URL',version:'1'}}}]}]}}});
 }});
 const req={operation_id:'op',approval_hash:'hash',action:'gcp_metadata'};
 const projected=projectOperatorResult(req,{generation:'1',data:{...req,...out}});
 assert.deepEqual(projected.metadata.containers[0].env,[{name:'PRIVATE',kind:'plain'},{name:'DB',kind:'secret_reference',secret:'NILE_DATABASE_URL',version:'1'}]);
 assert.equal(JSON.stringify(projected).includes('not-returned'),false);
});
test('non-DEV and arbitrary secrets denied before transport',async()=>{
 for(const input of [{environment:'test',kind:'run_job',name:'jscc-search-dev'},
  {environment:'dev',kind:'secret',name:'arbitrary-secret'},
  {environment:'dev',kind:'run_job',name:'unapproved-job'}])
  await assert.rejects(()=>executeDevGcpMetadata(input,{fetchImpl:async()=>assert.fail('network forbidden')}));
});
test('registry evidence remains unverified source provenance',async()=>{
 const source_sha='a'.repeat(40),digest='sha256:'+'b'.repeat(64),pkg='jscc-ops-gateway';
 const root='projects/jscc-shared/locations/europe-west1/repositories/jscc-ops';
 const parent=root+'/packages/'+pkg;
 let calls=0;
 const result=await executeDevGcpMetadata({environment:'dev',kind:'artifact_tag',package:pkg,source_sha},{fetchImpl:async()=>{
  calls++;
  if(calls===1)return Response.json({name:root,dockerConfig:{immutableTags:true}});
  if(calls===2)return Response.json({name:parent+'/tags/'+source_sha,version:parent+'/versions/'+digest});
  return Response.json({name:root+'/dockerImages/'+pkg+'@'+digest,uri:'europe-west1-docker.pkg.dev/jscc-shared/jscc-ops/'+pkg+'@'+digest});
 }});
 assert.equal(calls,3);
 assert.equal(result.metadata.digest,digest);
 assert.equal(result.metadata.source_provenance,'UNVERIFIED');
});
