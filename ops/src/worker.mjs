import {
  CATALOG_VERSION, TEST_SUITES, envConfig, executionJobName, gcpFetch, gcsReadJson, gcsReplaceJson,
  gcsWriteJson, isoNow, normalizeExecutionId, publicEvidence, releaseLease, sanitizeExternal, sanitizeText, validateDispatchBinding, validateTaskRequest
} from './lib.mjs';
import { createDevObserver } from '../observation/dev-runtime-observer.mjs';
import { assessDevRollout, planDevDeployment } from '../observation/dev-rollout-evaluator.mjs';

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

  const tr = await gcpFetch(`${url}/tasks?pageSize=1000`);
  let taskMetadataAvailable = false;
  let taskMetadataError = null;
  let tasks = [];
  if (tr.ok) {
    const tj = await tr.json();
    tasks = tj.tasks || [];
    taskMetadataAvailable = true;
  } else if (tr.status === 403 || tr.status === 404) {
    taskMetadataError = `task_read_${tr.status}`;
  } else {
    throw new Error(`task_read_${tr.status}`);
  }

  let targetExitCode = null;
  let targetTermSignal = null;
  let rootCause = null;
  for (const task of tasks) {
    const attempt = task.lastAttemptResult || {};
    const status = attempt.status || {};
    const taskCondition = (task.conditions || []).find(c => c && c.message);
    const message = status.message || taskCondition?.message || null;
    const exitCode = Number.isInteger(attempt.exitCode) ? attempt.exitCode : null;
    const termSignal = Number.isInteger(attempt.termSignal) ? attempt.termSignal : null;

    if (targetExitCode === null && exitCode !== null) targetExitCode = exitCode;
    if (targetTermSignal === null && termSignal !== null) targetTermSignal = termSignal;
    if (!rootCause && message) rootCause = sanitizeText(message).slice(0, 2048);

    if ((exitCode !== null && exitCode !== 0) || (termSignal !== null && termSignal !== 0) || (status.code && Number(status.code) !== 0)) {
      targetExitCode = exitCode;
      targetTermSignal = termSignal;
      if (message) rootCause = sanitizeText(message).slice(0, 2048);
      break;
    }
  }

  if (!rootCause) {
    const executionCondition = (j.conditions || []).find(c => c && c.message);
    if (executionCondition?.message) rootCause = sanitizeText(executionCondition.message).slice(0, 2048);
  }

  return {
    target_alias:id,
    state:j.conditions || [],
    start_time:j.startTime || null,
    completion_time:j.completionTime || null,
    cancelled_count:j.cancelledCount || 0,
    failed_count:j.failedCount || 0,
    succeeded_count:j.succeededCount || 0,
    task_count:Number(j.taskCount || 0),
    target_exit_code:targetExitCode,
    target_term_signal:targetTermSignal,
    root_cause:rootCause,
    task_metadata_available:taskMetadataAvailable,
    task_metadata_error:taskMetadataError
  };
}
async function readExecutionLogs(args) {
  const id = normalizeExecutionId(args.execution_id); const job = executionJobName(id);
  const filter = `resource.type="cloud_run_job" AND resource.labels.job_name="${job}" AND (labels.execution_name="${id}" OR labels."run.googleapis.com/execution_name"="${id}")`;
  if (!cfg.logViewResource) throw new Error('log_view_not_configured');
  const r = await gcpFetch('https://logging.googleapis.com/v2/entries:list',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({resourceNames:[cfg.logViewResource],filter,orderBy:'timestamp asc',pageSize:Math.min(args.limit,200)})});
  if (!r.ok) throw new Error(`logging_read_${r.status}`); const j=await r.json();
  const lines=(j.entries||[]).slice(0,args.limit).map(e=>sanitizeText(typeof (e.textPayload ?? e.jsonPayload ?? e.protoPayload ?? '')==='string'?(e.textPayload ?? ''):JSON.stringify(e.jsonPayload ?? e.protoPayload ?? {}))).filter(Boolean);
  const logExcerpt = sanitizeText(lines.join('\n'));
  return { target_alias:id, line_count:lines.length, log_excerpt:logExcerpt, logs:lines };
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
// Reuse the existing typed diagnostics job, dispatch, worker identity and
// evidence pipeline. GCP permissions are *not* elevated here: missing
// run.services.get/run.revisions.get/builds.get must fail closed.
async function devObservationTransport({api,path}) {
  if ((api!=='run.googleapis.com' && api!=='cloudbuild.googleapis.com') ||
      typeof path!=='string' || path.length>350 ||
      !/^\/v[12]\/projects\//.test(path)) throw new Error('transport_request_denied');
  const r=await gcpFetch('https://'+api+path,{signal:AbortSignal.timeout(9000)});
  if(!r.ok) return {status:r.status,body:null};
  const bound=Number(r.headers.get('content-length')||0);
  if(bound>131072) throw new Error('upstream_response_too_large');
  const raw=await r.text();
  if(Buffer.byteLength(raw,'utf8')>131072) throw new Error('upstream_response_too_large');
  try{return {status:r.status,body:JSON.parse(raw)};}
  catch{throw new Error('upstream_invalid_json');}
}
async function describeDevObservation(task,args){
  const observer=createDevObserver({transport:devObservationTransport});
  if(task==='inspect_dev_rollout') {
    const observed=await observer.describe({environment:'dev',task:'describe_dev_runtime',service:args.service});
    const review=assessDevRollout(observed,args.expected_image_digest);
    return {...review,resource:observed.resource,target_source_sha:'UNKNOWN'};
  }
  if(task==='plan_dev_deployment') {
    const observed=await observer.describe({environment:'dev',task:'describe_dev_runtime',service:args.service});
    const plan=planDevDeployment(observed,args);
    return {...plan,resource:observed.resource,target_source_sha:'UNKNOWN'};
  }
  const result=await observer.describe({...args,task});
  const summary=task==='describe_dev_runtime'
    ? JSON.stringify(result.effective_revisions) : null;
  const buildImages=task==='describe_dev_build'
    ? JSON.stringify(result.immutable_images) : null;
  if(summary && Buffer.byteLength(summary)>4096) throw new Error('observation_too_large');
  if(buildImages && Buffer.byteLength(buildImages)>4096) throw new Error('observation_too_large');
  return {
    target_alias:task==='describe_dev_runtime'?args.service:args.buildId,
    resource:result.resource,
    target_source_sha:result.source_sha,
    observed_at:result.observed_at,
    ...(task==='describe_dev_runtime'?{
      service_account:result.service_account,
      environment_variable_count:result.environment_variable_count,
      effective_revisions_json:summary,
    }:{
      build_id:result.build_id,build_status:result.build_status,
      immutable_images_json:buildImages,
    }),
  };
}
function publicAssertions(task, value) {
  if (task === 'describe_execution') return { target_alias:value.target_alias, failed_count:value.failed_count, succeeded_count:value.succeeded_count, cancelled_count:value.cancelled_count, completed:Boolean(value.completion_time), task_count:value.task_count, target_exit_code:value.target_exit_code, target_term_signal:value.target_term_signal, root_cause:value.root_cause, task_metadata_available:value.task_metadata_available, task_metadata_error:value.task_metadata_error };
  if (task === 'read_execution_logs') return { target_alias:value.target_alias, line_count:value.line_count, log_excerpt:value.log_excerpt };
  if (task === 'inspect_runtime_snapshot') return { target_alias:value.target_alias, run_status:value.run_status, published_jobs:value.published_jobs, status_present:value.status_present, jobs_present:value.jobs_present };
  if (task === 'run_test_suite') return { target_alias:value.target_alias, target_source_sha:value.target_source_sha, exit_code:value.exit_code, test_verdict:value.test_verdict, coarse_error:value.coarse_error || null };
  if (task === 'describe_dev_runtime') return {
    target_alias:value.target_alias, resource:value.resource,observed_at:value.observed_at,
    service_account:value.service_account,environment_variable_count:value.environment_variable_count,
    effective_revisions_json:value.effective_revisions_json,
  };
  if (task === 'describe_dev_build') return {
    target_alias:value.target_alias,resource:value.resource,observed_at:value.observed_at,
    build_id:value.build_id,build_status:value.build_status,
    immutable_images_json:value.immutable_images_json,
  };
  if (task === 'inspect_dev_rollout') return {
    target_alias:value.target_alias,resource:value.resource,observed_at:value.observed_at,
    expected_image_digest:value.expected_image_digest,
    matched_percent:value.matched_percent,other_percent:value.other_percent,
    unknown_percent:value.unknown_percent,active_revision_count:value.active_revision_count,
    rollout_verdict:value.rollout_verdict,source_provenance:value.source_provenance,
    traffic_cutover_authorized:false,
  };
  if (task === 'plan_dev_deployment') return {
    target_alias:value.target_alias,resource:value.resource,observed_at:value.observed_at,
    expected_current_digest:value.expected_current_digest,
    proposed_image_digest:value.proposed_image_digest,
    expected_source_sha:value.expected_source_sha,
    source_image_link:value.source_image_link,change_required:value.change_required,
    deployment_authorized:false,approval_required:value.approval_required,
    preflight_verdict:value.preflight_verdict,
  };
  return {};
}

async function main(){
  let dispatch,opId;
  try {
    dispatch=await waitDispatch(); opId=dispatch.operation_id;
    validateDispatchBinding(dispatch, ownExecution, {
      catalog_version:CATALOG_VERSION,
      ops_source_sha:cfg.opsSourceSha,
      worker_image_digest:cfg.workerDigest
    });
    const taskReq=validateTaskRequest(dispatch.task,dispatch.args);
    await updateOperation(opId,{operation_state:'RUNNING',worker_started_at:isoNow()});
    let value;
    if(taskReq.task==='describe_execution') value=await describeExecution(taskReq.args);
    else if(taskReq.task==='read_execution_logs') value=await readExecutionLogs(taskReq.args);
    else if(taskReq.task==='inspect_runtime_snapshot') value=await inspectRuntimeSnapshot(taskReq.args);
    else if(taskReq.task==='run_test_suite') value=await runTestSuite(taskReq.args);
    else if(['describe_dev_runtime','describe_dev_build','inspect_dev_rollout','plan_dev_deployment'].includes(taskReq.task))
      value=await describeDevObservation(taskReq.task,taskReq.args);
    else throw new Error('unknown_task');
    const external=sanitizeExternal(typeof value.output==='string'?value.output:'');
    if (!external.ok) throw new Error(external.coarse_error);
    const text=external.text;
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
