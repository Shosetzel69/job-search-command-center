import test from 'node:test';
import assert from 'node:assert/strict';
import {observeDevNile} from '../src/dev-nile-client.mjs';
import {validateTaskRequest,authenticatedEvidence,publicEvidence} from '../src/lib.mjs';
const sha='a'.repeat(40);
const args={environment:'dev',operation:'fit_verify_plan',expected_source_sha:sha};
const cfg={project:'jscc-dev',devBaseUrl:'https://jscc-command-api-dev-example.run.app'};
test('admission rejects SQL, extra args and non-DEV',()=>{
  assert.equal(validateTaskRequest('observe_dev_nile',args).task_class,'OBSERVE');
  for(const a of [{...args,environment:'test'},{...args,operation:'SELECT 1'},{...args,tenant:'other'}])
    assert.throws(()=>validateTaskRequest('observe_dev_nile',a));
});
test('worker pins destination, metadata audience and source; strips raw plan fields',async()=>{
  let calls=0;
  const result=await observeDevNile(args,cfg,{fetchImpl:async(url,options)=>{
    calls++;
    if(calls===1){
      assert.equal(url.hostname,'metadata.google.internal');
      assert.equal(url.searchParams.get('audience'),'urn:jscc:dev:nile-diagnostic');
      return new Response('a.b.c');
    }
    assert.equal(url.origin,cfg.devBaseUrl);
    assert.equal(url.pathname,'/admin/dev/nile-diagnostic');
    assert.equal(url.searchParams.get('expected_source_sha'),sha);
    assert.equal(options.redirect,'error');
    return Response.json({source_sha:sha,operation:args.operation,status:'COLLECTED',elapsed_ms:2,
      plan:{'Plan Rows':3,Filter:'private',children:[{'Total Cost':4,'Relation Name':'private'}]}});
  }});
  assert.equal(result.nile_status,'COLLECTED');
  assert.deepEqual(JSON.parse(result.nile_evidence_json).plan,{'Plan Rows':3,children:[{'Total Cost':4}]});
});
test('unexpected target is rejected before obtaining token; wrong source fails closed',async()=>{
  const denied=await observeDevNile(args,{...cfg,devBaseUrl:'https://example.invalid'},{fetchImpl:async()=>assert.fail('network call')});
  assert.equal(denied.nile_stage,'target');
  let calls=0;
  const mismatch=await observeDevNile(args,cfg,{fetchImpl:async()=>++calls===1?new Response('a.b.c'):Response.json({source_sha:'b'.repeat(40),operation:args.operation,status:'COLLECTED'})});
  assert.equal(mismatch.nile_status,'ERROR');
  assert.equal(mismatch.nile_stage,'source_or_response');
});
test('Nile evidence is private to authenticated operation response',()=>{
  const e={assertions:{nile_status:'COLLECTED',nile_evidence_json:'{"elapsed_ms":2}'}};
  assert.equal(authenticatedEvidence(e).assertions.nile_status,'COLLECTED');
  assert.deepEqual(publicEvidence(e).assertions,{});
});
