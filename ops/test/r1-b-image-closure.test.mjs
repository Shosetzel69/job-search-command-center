import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';

test('gateway and worker images both include typed catalog dependency',()=>{
 const gateway=readFileSync(new URL('../Dockerfile.gateway',import.meta.url),'utf8');
 const worker=readFileSync(new URL('../Dockerfile.worker',import.meta.url),'utf8');
 const required='COPY ops/observation/dev-runtime-observer.mjs ./ops/observation/dev-runtime-observer.mjs';
 assert.ok(gateway.includes(required),'gateway imports lib which imports observer');
 assert.ok(worker.includes(required),'worker imports observer');
 for(const docker of [gateway,worker]){
  assert.ok(docker.includes('COPY ops/src ./ops/src'));
  assert.ok(docker.includes('USER node'));
  assert.ok(!/CMD .*server\.mjs/.test(docker));
 }
});
