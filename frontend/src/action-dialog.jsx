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
      className="fixed left-1/2 top-1/2 z-[90] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl"
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
            className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 px-3"
          />
        </label>)}
      </div>}
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={locked} className="h-9 rounded-xl border border-slate-200 px-3 text-sm font-medium text-slate-600 disabled:opacity-50">Renunta</button>
        <button type="button" onClick={handleConfirm} disabled={locked || confirmDisabled} className={`h-9 rounded-xl px-4 text-sm font-semibold text-white disabled:opacity-50 ${danger ? 'bg-red-600' : 'bg-blue-600'}`}>{locked ? 'Se salveaza...' : confirmLabel}</button>
      </div>
    </section>
  </>;
}
