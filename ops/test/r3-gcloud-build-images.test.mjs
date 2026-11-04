import test from 'node:test';
import assert from 'node:assert/strict';
import {createDevObserver} from '../observation/dev-runtime-observer.mjs';
import {publicEvidence,authenticatedEvidence} from '../src/lib.mjs';

const id='c5bbfb85-0aab-40c7-aa47-a5589aa9e295';
const digest='sha256:'+'d'.repeat(64);
const base='europe-west1-docker.pkg.dev/jscc-shared/jscc-ops/';
const request={environment:'dev',task:'describe_dev_build',buildId:id};
function observer(body) {
 return createDevObserver({now:()=> '2026-11-05T00:00:00Z',transport: async({api,path})=>{
   assert.equal(api,'cloudbuild.googleapis.com');
   assert.equal(path,'/v1/projects/jscc-shared/locations/europe-west1/builds/'+id);
   return {status:200,body};
 }});
}
test('R3 Cloud Build projection returns only immutable ops registry digests, not substitutions',async()=>{
 const d={
   id,status:'SUCCESS',substitutions:{_TOKEN:'clear-text-secret'},
   source:{repoSource:{commitSha:'a'.repeat(40)}},
   results:{images:[
    {name:base+'jscc-ops-gateway:'+ 'a'.repeat(40),digest},
    {name:'europe-west1-docker.pkg.dev/jscc-shared/jscc/private:tag',digest},
    {name:base+'jscc-ops-gateway:tag',digest:'mutable'},
   ]}
 };
 const got=await observer(d).describe(request);
 assert.deepEqual(got.immutable_images,[{image:base+'jscc-ops-gateway:'+'a'.repeat(40),image_digest:digest}]);
 assert.equal(got.source_sha,'UNKNOWN');
 assert.equal(JSON.stringify(got).includes('clear-text-secret'),false);
 assert.equal(JSON.stringify(got).includes('_TOKEN'),false);
});
test('R3 absent build results yield no invented images or source provenance',async()=>{
 const got=await observer({id,status:'WORKING'}).describe(request);
 assert.deepEqual(got.immutable_images,[]);
 assert.equal(got.source_sha,'UNKNOWN');
});
test('R3 overlarge result list fails closed',async()=>{
 const many=Array.from({length:21},(_,i)=>({name:base+'some:tag'+i,digest}));
 await assert.rejects(()=>observer({id,status:'SUCCESS',results:{images:many}}).describe(request),
 /INSUFFICIENT_EVIDENCE/);
});
test('R3 outputs remain authenticated-only',()=>{
 const x={operation_id:'op-test-1234567890',task:'describe_dev_build',
   assertions:{immutable_images_json:JSON.stringify([{image:base+'x:a',image_digest:digest}]),
   secret:'hidden'}};
 assert.equal(publicEvidence(x).assertions.immutable_images_json,undefined);
 assert.ok(authenticatedEvidence(x).assertions.immutable_images_json);
 assert.equal(authenticatedEvidence(x).assertions.secret,undefined);
});
