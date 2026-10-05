import React, { useRef, useState } from 'react';
import { createSingleFireGuard } from './action-dialog-guard.mjs';

export default function ActionDialog({
  title,
  description = null,
  fields = [],
  values = {},
  onChange,
  onCancel,
  onConfirm,
  confirmLabel = 'Confirma',
  danger = false,
  busy = false,
  confirmDisabled = false,
}) {
  const confirmGuard = useRef(null);
  if (!confirmGuard.current) confirmGuard.current = createSingleFireGuard();
  const [confirming, setConfirming] = useState(false);
  const locked = busy || confirming;
  const handleConfirm = async () => {
    if (busy || confirmDisabled || !confirmGuard.current.tryStart()) return;
    setConfirming(true);
    try {
      await onConfirm();
    } finally {
      confirmGuard.current.finish();
      setConfirming(false);
    }
  };

  return <>
    <button type="button" aria-label="Inchide dialogul" className="fixed inset-0 z-[80] bg-slate-950/30" onClick={onCancel} disabled={locked}/>
    <section
      role="dialog"
      aria-modal="true"
      aria-labelledby="action-dialog-title"
      className="safe-top safe-bottom fixed inset-0 z-[90] overflow-y-auto bg-white p-4 shadow-2xl sm:left-1/2 sm:top-1/2 sm:inset-auto sm:w-[calc(100%-2rem)] sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border sm:border-slate-200 sm:p-5"
    >
      <h2 id="action-dialog-title" className="font-display text-lg font-bold text-slate-900">{title}</h2>
      {description && <p className="mt-2 text-sm text-slate-600">{description}</p>}
      {fields.length > 0 && <div className="mt-4 space-y-3">
        {fields.map(field => <label key={field.name} className="block text-sm text-slate-700">
          {field.label}
          <input
            autoFocus={field.autoFocus === true}
            type={field.type || 'text'}
            value={values[field.name] ?? ''}
            placeholder={field.placeholder || ''}
            onChange={event => onChange(field.name, event.target.value)}
            className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-200 px-3"
          />
        </label>)}
      </div>}
      <div className="mt-5 flex gap-2 sm:justify-end">
        <button type="button" onClick={onCancel} disabled={locked} className="min-h-11 flex-1 rounded-xl border border-slate-200 px-3 text-sm font-medium text-slate-600 disabled:opacity-50 sm:flex-none">Renunta</button>
        <button type="button" onClick={handleConfirm} disabled={locked || confirmDisabled} className={`min-h-11 flex-1 rounded-xl px-4 text-sm font-semibold text-white disabled:opacity-50 sm:flex-none ${danger ? 'bg-red-600' : 'bg-blue-600'}`}>{locked ? 'Se salveaza...' : confirmLabel}</button>
      </div>
    </section>
  </>;
}