import test from 'node:test';
import assert from 'node:assert/strict';
import {validateTaskRequest,selectOperationWorker,normalizeExecutionId,authenticatedEvidence,publicEvidence,NILE_JOB} from '../src/lib.mjs';
const digest='sha256:'+'a'.repeat(64);
test('Nile catalog admits only fixed read-only operations in DEV',()=>{
  for(const operation of ['schema_probe','evaluation_count_plan'])
    assert.equal(validateTaskRequest('observe_dev_nile',{environment:'dev',operation}).task_class,'OBSERVE');
  for(const args of [{environment:'test',operation:'schema_probe'},{environment:'prod',operation:'schema_probe'},{environment:'dev',operation:'SELECT 1'},{environment:'dev',operation:'schema_probe',tenant:'arbitrary'}])
    assert.throws(()=>validateTaskRequest('observe_dev_nile',args));
});
test('only the dedicated job and digest can execute a Nile observation',()=>{
  const cfg={diagnosticsJob:'jscc-diagnostics-dev',workerDigest:digest};
  assert.throws(()=>selectOperationWorker(cfg,'observe_dev_nile'),/nile_operator_not_configured/);
  assert.deepEqual(selectOperationWorker({...cfg,nileWorkerDigest:digest},'observe_dev_nile'),{job:NILE_JOB,digest});
  assert.deepEqual(selectOperationWorker(cfg,'describe_dev_runtime'),{job:cfg.diagnosticsJob,digest});
  assert.throws(()=>normalizeExecutionId(NILE_JOB+'-abcde'));
  assert.equal(normalizeExecutionId(NILE_JOB+'-abcde',true),NILE_JOB+'-abcde');
});
test('Nile evidence is authenticated-only',()=>{
  const input={assertions:{nile_status:'COLLECTED',nile_evidence_json:'{"table_count":3}'}};
  assert.equal(authenticatedEvidence(input).assertions.nile_status,'COLLECTED');
  assert.deepEqual(publicEvidence(input).assertions,{});
});
