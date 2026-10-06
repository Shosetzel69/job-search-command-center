import React from 'react';

const tone = status => status === 'FAIL'
  ? 'border-red-200 bg-red-50'
  : status === 'PASS'
    ? 'border-emerald-200 bg-emerald-50'
    : 'border-blue-200 bg-blue-50';

const symbol = state => state === 'PASS' ? '✓' : state === 'FAIL' ? '✕' : state === 'IN_PROGRESS' ? '●' : state === 'SKIPPED' || state === 'N/A' ? '–' : '□';

export function PromotionStatusPanel({ status, compactPass = false }) {
  if (!status) return null;
  const active = status.status === 'IN_PROGRESS' || status.status === 'QUEUED';
  if (compactPass && status.status === 'PASS') {
    return <section data-testid="promotion-status" data-compact="pass" className="flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs shadow-sm">
      <div className="flex items-center gap-2 font-semibold text-emerald-800"><span aria-hidden="true" className="h-2 w-2 rounded-full bg-emerald-500"/>Promovare PASS</div>
      <div className="hidden text-emerald-700 sm:block">{status.candidate_sha ? `Candidate ${status.candidate_sha.slice(0,12)}` : ''}</div>
    </section>;
  }
  return <section data-testid="promotion-status" className={`rounded-2xl border p-4 shadow-sm ${tone(status.status)}`}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Migrare / promovare {String(status.environment || '').toUpperCase()}</div>
        <div className="mt-1 font-display text-base font-bold text-slate-900">{active ? 'IN PROGRESS' : status.status}</div>
      </div>
      <div className="text-xs text-slate-500">{status.candidate_sha ? `Candidate ${status.candidate_sha.slice(0,12)}` : ''}</div>
    </div>
    <details open={active || status.status === 'FAIL'} className="mt-3">
      <summary className="cursor-pointer text-sm font-semibold text-slate-700">Checklist promovare</summary>
      <div className="mt-3 grid gap-1.5">
        {(status.steps || []).map(step => <div key={step.id} data-step={step.id} className="flex items-start gap-2 rounded-lg bg-white/70 px-3 py-2 text-sm">
          <span aria-hidden="true" className="w-4 font-bold">{symbol(step.state)}</span>
          <div className="min-w-0 flex-1">
            <div className="font-medium text-slate-800">{step.description}</div>
            <div className="text-xs text-slate-500">{step.component} · {step.state}</div>
            {step.error && <div className="mt-1 text-xs text-red-700">{step.error}</div>}
          </div>
        </div>)}
      </div>
    </details>
  </section>;
}
