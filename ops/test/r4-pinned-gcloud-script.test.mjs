import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { TASK_CATALOG, validateTaskRequest, DEV_DIAGNOSTIC_SCRIPT_SHA256 } from '../src/lib.mjs';

// Preserve immutable R4 evidence for later Delivery 2 without exposing its
// Build-dependent operation through the active DEV operation catalog.
const manifest=readFileSync(new URL('../diagnostics/dev-runtime-build-inventory-v1.json',import.meta.url));

test('Delivery 1 excludes both Cloud Build dependent dispatch operations',()=>{
  assert.equal(TASK_CATALOG.describe_dev_build,undefined);
  assert.equal(TASK_CATALOG.run_dev_gcloud_script,undefined);
  assert.throws(()=>validateTaskRequest('describe_dev_build',{environment:'dev'}),/unknown_task/);
  assert.throws(()=>validateTaskRequest('run_dev_gcloud_script',{environment:'dev'}),/unknown_task/);
  for(const task of ['describe_execution','read_execution_logs','inspect_runtime_snapshot',
    'run_test_suite','describe_dev_runtime','inspect_dev_rollout','plan_dev_deployment']){
    assert.ok(TASK_CATALOG[task]);
  }
});

test('Deferred pinned R4 artifact remains byte-identical for separate Delivery 2 review',()=>{
  assert.equal(createHash('sha256').update(manifest).digest('hex'),DEV_DIAGNOSTIC_SCRIPT_SHA256);
  const parsed=JSON.parse(manifest.toString('utf8'));
  assert.equal(parsed.effects,'none');
  assert.deepEqual(parsed.steps.map(x=>x.method),['GET','GET']);
});

test('Delivery 1 worker cannot dispatch deferred Build operations',()=>{
  const worker=readFileSync(new URL('../src/worker.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(worker,/taskReq\.task==='run_dev_gcloud_script'/);
  assert.doesNotMatch(worker,/\['describe_dev_runtime','describe_dev_build'/);
});
