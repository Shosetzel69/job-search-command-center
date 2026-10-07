import * as github from './runtime-github.js';

function backend(env) {
  return String(env.JSCC_RUNTIME_BACKEND || 'github').trim().toLowerCase();
}

async function impl(env) {
  if (backend(env) === 'github') return github;
  if (backend(env) === 'gcp') return import('./runtime-gcp.js');
  throw Object.assign(new Error('JSCC_RUNTIME_BACKEND must be github or gcp'), { status:503 });
}

export async function canAccessRuntimeRepository(env, runtime) { return (await impl(env)).canAccessRuntimeRepository(env, runtime); }
export async function readRuntimeJson(env, runtime, path) { return (await impl(env)).readRuntimeJson(env, runtime, path); }
export async function writeRuntimeJson(env, runtime, path, sha, payload, message) { return (await impl(env)).writeRuntimeJson(env, runtime, path, sha, payload, message); }
export async function activeWorkflowRun(env, runtime) { return (await impl(env)).activeWorkflowRun(env, runtime); }
export async function hasActiveWorkflowRun(env, runtime) { return Boolean(await activeWorkflowRun(env, runtime)); }
export async function dispatchWorkflow(env, runtime, runTrigger = 'manual-ui', checkActive = true, executionMode = 'policy', retrieveRequest = null) {
  return (await impl(env)).dispatchWorkflow(env, runtime, runTrigger, checkActive, executionMode, retrieveRequest);
}
