export function runProgressModel(status) {
  if (!status || typeof status !== 'object') {
    return { total:0, processed:0, good:0, failed:0, skipped:0, partial:0, percent:0, active:false, terminal:false, jobsPublished:0 };
  }
  const progress = status.progress && typeof status.progress === 'object' ? status.progress : {};
  const total = Math.max(0, Number(progress.sources_total ?? status.sources_active ?? status.sources_configured ?? 0) || 0);
  const processed = Math.max(0, Number(progress.sources_processed ?? status.sources_processed ?? status.sources_attempted ?? 0) || 0);
  const good = Math.max(0, Number(progress.sources_good ?? status.sources_succeeded ?? 0) || 0);
  const failed = Math.max(0, Number(progress.sources_failed ?? status.sources_failed ?? 0) || 0);
  const skipped = Math.max(0, Number(progress.sources_skipped ?? status.sources_skipped ?? 0) || 0);
  const partial = Math.max(0, Number(progress.sources_partial ?? status.sources_partial ?? 0) || 0);
  const derived = total > 0 ? Math.floor(Math.min(total, processed) * 100 / total) : (processed > 0 ? 100 : 0);
  const percent = Math.max(0, Math.min(100, Number(progress.percent ?? derived) || 0));
  const normalizedStatus = String(status.status || '').toLowerCase();
  const active = ['queued','in_progress','running','pending'].includes(normalizedStatus);
  const terminal = ['completed','completed_with_errors','failed'].includes(normalizedStatus);
  return {
    total,
    processed,
    good,
    failed,
    skipped,
    partial,
    percent: terminal && total > 0 ? 100 : percent,
    active,
    terminal,
    jobsPublished: Math.max(0, Number(status.jobs_published ?? 0) || 0),
  };
}
