import {
  CATALOG_VERSION, TEST_SUITES, envConfig, executionJobName, gcpFetch, gcsReadJson, gcsReplaceJson,
  gcsWriteJson, isoNow, normalizeExecutionId, publicEvidence, releaseLease, sanitizeText, validateTaskRequest
} from './lib.mjs';

const cfg = envConfig();
const ownExecution = normalizeExecutionId(process.env.CLOUD_RUN_EXECUTION || '');
const workerStartedAt = isoNow();

async function updateOperation(operationId, patch) {
  const name = `operations/${operationId}.json`;
  for (let i=0;i<4;i++) {
    const cur = await gcsReadJson(cfg.bucket, name); if (!cur) throw new Error('operation_not_found');
    try { await gcsReplaceJson(cfg.bucket, name, { ...cur.data, ...patch, updated_at: isoNow() }, cur.generation); return; }
    catch (e) { if (e.message !== 'generation_precondition_failed') throw e; }
  }
  throw new Error('operation_update_contention');
}
async function waitDispatch() {
  for (let i=0;i<240;i++) {
    const rec = await gcsReadJson(cfg.bucket, `dispatch/${ownExecution}.json`);
    if (rec) return rec.data;
    await new Promise(r=>setTimeout(r,500));
  }
  throw new Error('dispatch_not_found');
}
async function describeExecution(args) {
  const id = normalizeExecutionId(args.execution_id); const job = executionJobName(id);
  const url = `https://run.googleapis.com/v2/projects/${cfg.project}/locations/${cfg.region}/jobs/${job}/executions/${id}`;
  const r = await gcpFetch(url); if (!r.ok) throw new Error(`execution_read_${r.status}`); const j=await r.json();
  return { target_alias:id, state:j.conditions || [], start_time:j.startTime || null, completion_time:j.completionTime || null, cancelled_count:j.cancelledCount || 0, failed_count:j.failedCount || 0, succeeded_count:j.succeededCount || 0 };
}
async function readExecutionLogs(args) {
  const id = normalizeExecutionId(args.execution_id); const job = executionJobName(id);
  const filter = `resource.type="cloud_run_job" AND resource.labels.job_name="${job}" AND labels."run.googleapis.com/execution_name"="${id}"`;
  if (!cfg.logViewResource) throw new Error('log_view_not_configured');
  const r = await gcpFetch('https://logging.googleapis.com/v2/entries:list',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({resourceNames:[cfg.logViewResource],filter,orderBy:'timestamp asc',pageSize:Math.min(args.limit,200)})});
  if (!r.ok) throw new Error(`logging_read_${r.status}`); const j=await r.json();
  const lines=(j.entries||[]).slice(0,args.limit).map(e=>sanitizeText(typeof (e.textPayload ?? e.jsonPayload ?? e.protoPayload ?? '')==='string'?(e.textPayload ?? ''):JSON.stringify(e.jsonPayload ?? e.protoPayload ?? {}))).filter(Boolean);
  return { target_alias:id, line_count:lines.length, logs:lines };
}
async function inspectRuntimeSnapshot(args) {
  if (!cfg.runtimeBucket) throw new Error('runtime_bucket_not_configured');
  const runId = args.run_id;
  const status = await gcsReadJson(cfg.runtimeBucket, `runs/${runId}/run-status.json`);
  if (!status) throw new Error('runtime_snapshot_not_found');
  const published = Number(status.data.jobs_published ?? status.data.results ?? 0);
  return {
    target_alias: runId,
    run_status: status.data.status || status.data.state || null,
    published_jobs: Number.isFinite(published) ? published : 0,
    status_present: true
  };
}
async function runTestSuite(args) {
  if (!cfg.devBaseUrl) throw new Error('dev_base_url_not_configured');
  if (args.suite !== 'dev-health') throw new Error('unknown_suite');
  let r;
  try {
    r = await fetch(`${cfg.devBaseUrl}/health`, { headers: { accept:'application/json' }, signal: AbortSignal.timeout(30_000) });
  } catch {
    return { target_alias:args.suite, target_source_sha:null, exit_code:1, test_verdict:'BLOCKED', coarse_error:'dev_health_unreachable' };
  }
  if (!r.ok) return { target_alias:args.suite, target_source_sha:null, exit_code:r.status, test_verdict:'BLOCKED', coarse_error:'dev_health_http_error' };
  let health;
  try { health = await r.json(); } catch { return { target_alias:args.suite, target_source_sha:null, exit_code:1, test_verdict:'FAIL', coarse_error:'dev_health_invalid_json' }; }
  const targetSourceSha = String(health.source_sha || health.sourceSha || health.SOURCE_SHA || '').trim();
  const environment = String(health.environment || health.app_env || health.APP_ENV || '').trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(targetSourceSha)) return { target_alias:args.suite, target_source_sha:targetSourceSha || null, exit_code:1, test_verdict:'FAIL', coarse_error:'dev_health_missing_source_sha' };
  if (environment && environment !== 'dev') return { target_alias:args.suite, target_source_sha:targetSourceSha, exit_code:1, test_verdict:'FAIL', coarse_error:'target_not_dev' };
  if (targetSourceSha !== args.expected_source_sha) return { target_alias:args.suite, target_source_sha:targetSourceSha, exit_code:0, test_verdict:'BLOCKED', coarse_error:'source_sha_mismatch' };
  return { target_alias:args.suite, target_source_sha:targetSourceSha, exit_code:0, test_verdict:'PASS', coarse_error:null };
}
function publicAssertions(task, value) {
  if (task === 'describe_execution') return { target_alias:value.target_alias, failed_count:value.failed_count, succeeded_count:value.succeeded_count, cancelled_count:value.cancelled_count, completed:Boolean(value.completion_time) };
  if (task === 'read_execution_logs') return { target_alias:value.target_alias, line_count:value.line_count };
  if (task === 'inspect_runtime_snapshot') return { target_alias:value.target_alias, run_status:value.run_status, published_jobs:value.published_jobs, status_present:value.status_present, jobs_present:value.jobs_present };
  if (task === 'run_test_suite') return { target_alias:value.target_alias, target_source_sha:value.target_source_sha, exit_code:value.exit_code, test_verdict:value.test_verdict, coarse_error:value.coarse_error || null };
  return {};
}

async function main(){
  let dispatch,opId;
  try {
    dispatch=await waitDispatch(); opId=dispatch.operation_id;
    if (dispatch.execution_name!==ownExecution) throw new Error('execution_binding_mismatch');
    if (dispatch.catalog_version!==CATALOG_VERSION) throw new Error('catalog_version_mismatch');
    if (dispatch.ops_source_sha!==cfg.opsSourceSha) throw new Error('ops_source_sha_mismatch');
    if (dispatch.worker_image_digest!==cfg.workerDigest) throw new Error('worker_digest_mismatch');
    if (Number(dispatch.expires_at_ms)<=Date.now()) throw new Error('dispatch_expired');
    const taskReq=validateTaskRequest(dispatch.task,dispatch.args);
    await updateOperation(opId,{operation_state:'RUNNING',worker_started_at:isoNow()});
    let value;
    if(taskReq.task==='describe_execution') value=await describeExecution(taskReq.args);
    else if(taskReq.task==='read_execution_logs') value=await readExecutionLogs(taskReq.args);
    else if(taskReq.task==='inspect_runtime_snapshot') value=await inspectRuntimeSnapshot(taskReq.args);
    else if(taskReq.task==='run_test_suite') value=await runTestSuite(taskReq.args);
    else throw new Error('unknown_task');
    const text=sanitizeText(typeof value.output==='string'?value.output:'');
    const result={schema_version:'1.0',operation_id:opId,work_item_ref:dispatch.work_item_ref,task:taskReq.task,task_class:taskReq.task_class,operation_state:'SUCCEEDED',test_verdict:value.test_verdict??null,target_alias:value.target_alias??null,ops_source_sha:cfg.opsSourceSha,target_source_sha:value.target_source_sha??null,gateway_image_digest:process.env.GATEWAY_IMAGE_DIGEST,worker_image_digest:cfg.workerDigest,started_at:workerStartedAt,finished_at:isoNow(),exit_code:value.exit_code??0,sanitizer_version:'1',line_count:text?text.split(/\r?\n/).length:0,byte_count:Buffer.byteLength(text),assertions:publicAssertions(taskReq.task,value),private_details:value,private_output:text};
    await gcsWriteJson(cfg.bucket,`results/${opId}.json`,result,0);
    await gcsWriteJson(cfg.bucket,`public/${opId}.json`,publicEvidence(result),0);
    await updateOperation(opId,{operation_state:'SUCCEEDED',test_verdict:result.test_verdict,finished_at:result.finished_at});
    await releaseLease(cfg.bucket,opId);
    console.log(JSON.stringify(publicEvidence(result)));
  } catch(e) {
    console.error(JSON.stringify({event:'worker_error',error:String(e?.message||'unknown')}));
    if(opId){try{await updateOperation(opId,{operation_state:'FAILED',coarse_error:String(e?.message||'worker_failed'),finished_at:isoNow()});}catch{}try{await releaseLease(cfg.bucket,opId);}catch{}}
    process.exitCode=1;
  }
}
await main();
