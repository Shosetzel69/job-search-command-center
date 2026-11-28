import test from 'node:test';
import assert from 'node:assert/strict';
import {executeDevGcpMetadata} from '../operator/dev_gcp_metadata.mjs';
import {projectOperatorResult,DEV_RUN_PERMISSION_PROBES} from '../src/dev_operator_contract.mjs';

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

test('service inventory distinguishes serving revisions from the desired template',async()=>{
 const name='jscc-ops-gateway-dev',root='projects/jscc-dev/locations/europe-west1/services/'+name;
 const rev=name+'-00001-abc',other=name+'-00002-def',digest='sha256:'+'a'.repeat(64);
 const desired='europe-west1-docker.pkg.dev/jscc-shared/jscc-ops/jscc-ops-gateway@sha256:'+'b'.repeat(64);
 const serving='europe-west1-docker.pkg.dev/jscc-shared/jscc-ops/jscc-ops-gateway@'+digest;
 const calls=[];
 const fetchImpl=async(url,init)=>{
  assert.equal(init.method,'GET');
  calls.push(url);
  const base='https://run.googleapis.com/v2/'+root;
  if(url===base)return Response.json({name:root,latestReadyRevision:other,
   template:{containers:[{image:desired,env:[{name:'PRIVATE',value:'not-returned'}]}]},
   trafficStatuses:[{revision:rev,percent:100},{revision:rev,percent:0,tag:'preview'}]});
  assert.equal(url,base+'/revisions/'+rev);
  return Response.json({name:root+'/revisions/'+rev,containers:[{name:'main',image:serving,
   env:[{name:'TOKEN',value:'also-not-returned'}]}]});
 };
 const out=await executeDevGcpMetadata({environment:'dev',kind:'run_service',name},{fetchImpl});
 const req={operation_id:'op',approval_hash:'hash',action:'gcp_metadata'};
 const wrap=metadata=>projectOperatorResult(req,{generation:'1',data:{...req,...out,metadata}});
 const projected=wrap(out.metadata);
 assert.equal(calls.length,2);
 assert.equal(projected.metadata.configuration_scope,'service_template');
 assert.equal(projected.metadata.containers[0].image,desired);
 assert.deepEqual(projected.metadata.effective_revisions,[{revision:rev,percent:100,image_digest:digest},
  {revision:rev,percent:0,image_digest:digest}]);
 assert.equal(projected.metadata.source_provenance,'UNVERIFIED');
 assert.equal(JSON.stringify(projected).includes('not-returned'),false);
 assert.throws(()=>wrap({...out.metadata,effective_revisions:[{revision:other,percent:100,image_digest:digest},
  {revision:rev,percent:0,image_digest:digest}]}),/operator_metadata_invalid/);
 assert.throws(()=>wrap({...out.metadata,effective_revisions:[]}),/operator_metadata_invalid/);
});

test('service inventory rejects revision identity mismatch instead of falling back to template',async()=>{
 const name='jscc-ops-gateway-dev',root='projects/jscc-dev/locations/europe-west1/services/'+name;
 const rev=name+'-00001-abc';
 let calls=0;
 await assert.rejects(()=>executeDevGcpMetadata({environment:'dev',kind:'run_service',name},{fetchImpl:async()=>{
  if(++calls===1)return Response.json({name:root,template:{containers:[{image:'tag'}]},
   trafficStatuses:[{revision:rev,percent:100}]});
  return Response.json({name:root+'/revisions/'+name+'-different',containers:[]});
 }}),/RESOURCE_MISMATCH/);
});


test('permission probe is read-only exact DEV resource, fixed caller permission list and no isolation claim',async()=>{
 const name='jscc-command-api-dev',kind='run_service_permissions';
 const root='projects/jscc-dev/locations/europe-west1/services/'+name;
 const calls=[];
 const out=await executeDevGcpMetadata({environment:'dev',kind,name},{fetchImpl:async(url,init)=>{
  calls.push([url,init.method]);
  if(init.method==='GET'){assert.equal(url,'https://run.googleapis.com/v2/'+root+'?fields=name');return Response.json({name:root});}
  assert.equal(url,'https://run.googleapis.com/v2/'+root+':testIamPermissions');
  assert.deepEqual(JSON.parse(init.body),{permissions:[...DEV_RUN_PERMISSION_PROBES[kind]]});
  return Response.json({permissions:['run.services.get','run.services.update'],private:'ignore'});
 }});
 const req={operation_id:'op',approval_hash:'hash',action:'gcp_metadata'};
 const result=projectOperatorResult(req,{generation:'1',data:{...req,...out}});
 assert.deepEqual(result.metadata.reported_permissions,['run.services.get','run.services.update']);
 assert.ok(result.metadata.not_reported_permissions.includes('run.services.delete'));
 assert.equal(result.metadata.policy_isolation,'UNVERIFIED');
 assert.equal(JSON.stringify(result).includes('private'),false);
 assert.deepEqual(calls.map(x=>x[1]),['GET','POST']);
});
test('permission probes deny caller-supplied permissions, foreign names and missing/mismatched resource',async()=>{
 const input={environment:'dev',kind:'run_job_permissions',name:'jscc-search-dev'};
 for(const bad of [{...input,name:'jscc-search-prod'},{...input,environment:'test'},{...input,permissions:['*']}])
  await assert.rejects(()=>executeDevGcpMetadata(bad,{fetchImpl:async()=>assert.fail('unexpected API')}));
 let calls=0;
 await assert.rejects(()=>executeDevGcpMetadata(input,{fetchImpl:async()=>{
  calls++;return Response.json({name:'projects/foreign/locations/europe-west1/jobs/jscc-search-dev'});
 }}),/resource_unverified/);
 assert.equal(calls,1);
});
