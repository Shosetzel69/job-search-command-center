export const TERMINAL_RUN_STATUSES = new Set(['completed', 'completed_with_errors', 'failed']);
export const ACTIVE_RUN_STATUSES = new Set(['queued', 'in_progress', 'running', 'pending']);

export function isTerminalRunStatus(status) {
  return TERMINAL_RUN_STATUSES.has(String(status || '').toLowerCase());
}

export function isActiveRunStatus(status) {
  return ACTIVE_RUN_STATUSES.has(String(status || '').toLowerCase());
}

export function duplicateRunResolution(status) {
  return isActiveRunStatus(status?.status)
    ? { trackExistingRun:true, state:'active' }
    : { trackExistingRun:false, state:'idle' };
}

export function runChanged(status, baseline = {}) {
  if (!status) return false;
  return status.run_id !== (baseline.runId ?? null) || status.completed_at !== (baseline.completedAt ?? null);
}

export function terminalForBaseline(status, baseline = {}) {
  return runChanged(status, baseline) && isTerminalRunStatus(status.status);
}

export function pollingDelayMs(attempt) {
  if (attempt < 24) return 5000;
  if (attempt < 60) return 10000;
  return 15000;
}

export function completionNotice(status) {
  const published = status?.jobs_published ?? 0;
  const sources = status?.sources_processed ?? status?.sources_attempted ?? 0;
  if (status?.status === 'failed') {
    return { type: 'error', message: 'Verificarea s-a terminat cu eroare.' };
  }
  if (status?.status === 'completed_with_errors') {
    return { type: 'info', message: `Verificare finalizata cu erori partiale: ${published} joburi publicate din ${sources} surse procesate.` };
  }
  return { type: 'success', message: `Verificare finalizata: ${published} joburi publicate din ${sources} surse.` };
}

// Correlate every accepted refresh with its exact backend run identity.
export function statusForTrackedRun(status,runId) {
  if(!runId || status?.run_id!==runId) return null;
  return status;
}
export function initialTrackedRun(runId) {
  if(!runId) return null;
  return {run_id:runId,status:'queued',completed_at:null,progress:{sources_total:0,sources_processed:0,percent:0}};
}
