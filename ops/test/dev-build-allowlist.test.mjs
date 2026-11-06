import test from 'node:test';
import assert from 'node:assert/strict';
import { TASK_CATALOG,validateTaskRequest } from '../src/lib.mjs';

test('Delivery 1 defers all Cloud Build observation capability',()=>{
  assert.equal(TASK_CATALOG.describe_dev_build,undefined);
  assert.equal(TASK_CATALOG.run_dev_gcloud_script,undefined);
  for(const task of ['describe_dev_build','run_dev_gcloud_script']) {
    assert.throws(()=>validateTaskRequest(task,{}),/unknown_task/);
  }
});
