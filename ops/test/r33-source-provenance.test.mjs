import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
const base=new URL('../r33-baseline/src/',import.meta.url);
const sha={
 'gateway.mjs':'30f67b013e22d358cfdfe5081f07f4625d01ac5638f0342ba760d57994f30813',
 'dev_workspace.mjs':'26fa91c6400b8955d441abc28cc8b3bc76baec0ac2cf559d2c15459b0cd541c3',
};
for(const [name,expected] of Object.entries(sha)){
 test('immutable R33 gateway reference SHA256: '+name,()=>{
  const content=readFileSync(new URL(name,base));
  assert.equal(createHash('sha256').update(content).digest('hex'),expected);
 });
}
test('gateway remains byte-for-byte R33 and adds no new MCP endpoints',()=>{
 const candidate=readFileSync(new URL('../src/gateway.mjs',import.meta.url));
 const baseline=readFileSync(new URL('gateway.mjs',base));
 assert.deepEqual(candidate,baseline);
});
test('new tasks are dispatched using existing #537 catalog and worker',()=>{
 const lib=readFileSync(new URL('../src/lib.mjs',import.meta.url),'utf8');
 const worker=readFileSync(new URL('../src/worker.mjs',import.meta.url),'utf8');
 for(const name of ['describe_dev_runtime','inspect_dev_rollout']){
  assert.match(lib,new RegExp(name));
  assert.match(worker,new RegExp(name));
 }
 assert.match(worker,/describeDevObservation/);
 assert.doesNotMatch(lib,/  describe_dev_build: Object.freeze/);
 assert.doesNotMatch(lib,/  run_dev_gcloud_script: Object.freeze/);
});
