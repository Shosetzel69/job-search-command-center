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
test('gateway candidate preserves existing tools and adds only two R1 names',()=>{
 const source=readFileSync(new URL('../src/gateway.mjs',import.meta.url),'utf8');
 for(const name of ['auth_check','run_operation','get_operation',
  'describe_dev_runtime','describe_dev_build'])
  assert.equal(source.includes("name: '"+name+"'"),true,name);
 assert.match(source,/workspaceTools\.map/);
 assert.match(source,/hasDevWriteScope\(auth\.record\.scope\)/);
 assert.match(source,/invokeDevObserver/);
 assert.match(source,/JSCC_DEV_OBSERVER_URL/);
});
