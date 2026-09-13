import { redact } from './contract.mjs';

export function printValidation(runtime) {
  console.log(JSON.stringify({
    status: 'PASS',
    environment: runtime.environment,
    source_sha: runtime.sourceSha,
    runtime_repo: runtime.runtimeRepository,
    runtime_ref: runtime.runtimeRef,
    workflow: runtime.workflow,
    search_mode: runtime.searchMode,
    cloudflare_account: redact(runtime.cloudflareAccountId),
    frontend_origin: runtime.frontendOrigin,
  }, null, 2));
}

export function printPlan(kind, runtime, plan) {
  console.log(JSON.stringify({
    status: 'DRY_RUN',
    action: kind,
    environment: runtime.environment,
    source_sha: runtime.sourceSha,
    runtime_repo: runtime.runtimeRepository,
    cloudflare_account: redact(runtime.cloudflareAccountId),
    steps: plan,
  }, null, 2));
}

export function statusRow(runtime, health = 'NOT_PROBED') {
  return {
    environment: runtime.environment.toUpperCase(),
    source_sha: runtime.sourceSha,
    runtime_data_sha: 'NOT_PROBED',
    runtime_repo: runtime.runtimeRepository,
    cloudflare_account: redact(runtime.cloudflareAccountId),
    health,
  };
}
