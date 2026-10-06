import React, { useEffect, useMemo, useState } from 'react';
import {
  NOMENCLATURE_DOMAIN_ORDER,
  domainIsExtensible,
  domainLabel,
  domainNote,
  errorMessageWithReferences,
  sortedDomainValues,
} from './nomenclature-admin-model.mjs';
import ActionDialog from './action-dialog.jsx';

const cx = (...values) => values.filter(Boolean).join(' ');

async function api(path, token, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  const response = await fetch(path, { ...options, headers, cache:'no-store' });
  let payload = null;
  try { payload = await response.json(); } catch { payload = null; }
  if (!response.ok) {
    const error = new Error(payload?.error || `HTTP ${response.status}`);
    error.status = response.status;
    error.references = Array.isArray(payload?.references) ? payload.references : [];
    throw error;
  }
  return payload;
}

function KindBadge({ domain }) {
  const extensible = domainIsExtensible(domain);
  return <span className={cx('rounded-full px-2 py-1 text-[11px] font-semibold', extensible ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-600')}>{extensible ? 'Extensibil' : 'System'}</span>;
}

function StateBadge({ active }) {
  return <span className={cx('rounded-full px-2 py-1 text-[11px] font-semibold', active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500')}>{active ? 'Activa' : 'Inactiva'}</span>;
}

export default function NomenclaturesAdmin({ token, notify }) {
  const [catalog,setCatalog] = useState(null);
  const [selected,setSelected] = useState('regions');
  const [loading,setLoading] = useState(true);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState(null);
  const [dialog,setDialog] = useState(null);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const payload = await api('/nomenclatures', token);
      setCatalog(payload.catalog);
    } catch (loadError) {
      setError(loadError);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [token]);

  const domain = catalog?.domains?.[selected] || null;
  const rows = useMemo(() => sortedDomainValues(domain), [domain]);

  const apply = async (operation, successMessage) => {
    if (busy) return;
    setBusy(true);
    try {
      const payload = await operation();
      if (payload?.catalog) setCatalog(payload.catalog);
      notify(successMessage, 'success');
    } catch (operationError) {
      notify(errorMessageWithReferences(operationError), 'error');
    } finally {
      setBusy(false);
    }
  };

  const edit = item => setDialog({ type:'edit', item, label:item.label, sortOrder:String(item.sort_order ?? 0) });

  const toggle = item => apply(
    () => api(`/nomenclatures/${encodeURIComponent(selected)}/${encodeURIComponent(item.code)}`, token, {
      method:'PUT',
      body:JSON.stringify({ active:!item.active }),
    }),
    item.active ? 'Valoarea a fost dezactivata.' : 'Valoarea a fost activata.',
  );

  const add = () => {
    if (!domainIsExtensible(domain)) return;
    setDialog({ type:'add', code:'', label:'' });
  };

  const remove = item => {
    if (!domainIsExtensible(domain)) return;
    setDialog({ type:'delete', item });
  };

  const confirmDialog = async () => {
    const current = dialog;
    if (!current) return;
    if (current.type === 'edit') {
      const label = current.label.trim();
      const sortOrder = Number(current.sortOrder);
      if (!label || !Number.isFinite(sortOrder)) return;
      setDialog(null);
      await apply(
        () => api(`/nomenclatures/${encodeURIComponent(selected)}/${encodeURIComponent(current.item.code)}`, token, {
          method:'PUT',
          body:JSON.stringify({ label, sort_order:sortOrder }),
        }),
        'Valoarea nomenclatorului a fost actualizata.',
      );
      return;
    }
    if (current.type === 'add') {
      const code = current.code.trim();
      const label = current.label.trim();
      if (!code || !label) return;
      setDialog(null);
      await apply(
        () => api(`/nomenclatures/${encodeURIComponent(selected)}`, token, {
          method:'POST',
          body:JSON.stringify({ code, label }),
        }),
        'Valoarea a fost adaugata.',
      );
      return;
    }
    if (current.type === 'delete') {
      setDialog(null);
      await apply(
        () => api(`/nomenclatures/${encodeURIComponent(selected)}/${encodeURIComponent(current.item.code)}`, token, { method:'DELETE' }),
        'Valoarea a fost stearsa.',
      );
    }
  };

  if (loading) return <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">Se incarca nomenclatoarele canonice...</div>;
  if (error) return <div className="rounded-2xl border border-red-200 bg-white p-6 shadow-sm"><div className="text-sm font-semibold text-red-700">Nomenclatoarele nu au putut fi incarcate.</div><div className="mt-1 text-sm text-slate-600">{errorMessageWithReferences(error)}</div><button onClick={load} className="mt-4 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold">Reincearca</button></div>;
  if (!catalog) return null;

  return <div className="space-y-4">
    <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">Codurile tehnice system sunt stabile. Dezactivarea unei valori folosite este blocata cu 409 si referintele sunt afisate; configuratia nu este modificata automat.</div>
    <div className="flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
      {NOMENCLATURE_DOMAIN_ORDER.map(name => {
        const current = catalog.domains?.[name];
        if (!current) return null;
        return <button key={name} onClick={() => setSelected(name)} className={cx('rounded-xl px-3 py-2 text-sm font-semibold', selected === name ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100')}>{domainLabel(name)} <span className="ml-1 text-xs opacity-70">{current.values?.length ?? 0}</span></button>;
      })}
    </div>

    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div><div className="flex items-center gap-2"><h2 className="font-display text-base font-bold text-slate-900">{domainLabel(selected)}</h2><KindBadge domain={domain}/></div><p className="mt-1 text-xs text-slate-500">{domainNote(selected, domain)}</p></div>
        {domainIsExtensible(domain) && <button disabled={busy} onClick={add} className="h-9 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white disabled:opacity-50">Adauga valoare</button>}
      </div>

      <div className="hidden grid-cols-[130px_minmax(0,1fr)_90px_90px_230px] gap-3 border-b border-slate-100 bg-slate-50 px-5 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400 md:grid"><span>Cod</span><span>Eticheta</span><span>Ordine</span><span>Stare</span><span className="text-right">Actiuni</span></div>
      <div className="divide-y divide-slate-100">{rows.map(item => <div key={item.code} className="grid gap-3 px-5 py-3 text-sm md:grid-cols-[130px_minmax(0,1fr)_90px_90px_230px] md:items-center"><div className="font-mono text-xs font-semibold text-slate-600">{item.code}</div><div><div className="font-medium text-slate-800">{item.label}</div>{Array.isArray(item.aliases) && item.aliases.length > 0 && <div className="mt-0.5 text-xs text-slate-400">Aliases tehnice: {item.aliases.join(', ')}</div>}{Array.isArray(item.country_codes) && item.country_codes.length > 0 && <div className="mt-0.5 text-xs text-slate-400">{item.country_codes.length} tari membre</div>}</div><div className="text-xs text-slate-500">{item.sort_order}</div><div><StateBadge active={item.active}/></div><div className="flex flex-wrap justify-end gap-2"><button disabled={busy} onClick={() => edit(item)} className="min-h-11 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 disabled:opacity-50">Editeaza</button><button disabled={busy} onClick={() => toggle(item)} className="min-h-11 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 disabled:opacity-50">{item.active ? 'Dezactiveaza' : 'Activeaza'}</button>{domainIsExtensible(domain) && <button disabled={busy} onClick={() => remove(item)} className="min-h-11 rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-600 disabled:opacity-50">Sterge</button>}</div></div>)}</div>
      {!rows.length && <div className="px-5 py-10 text-center text-sm text-slate-500">Nu exista valori. {selected === 'seniority' ? 'Domeniul este pregatit doar ca infrastructura.' : ''}</div>}
    </section>
    {dialog?.type === 'edit' && <ActionDialog
      title="Editeaza valoarea"
      fields={[{name:'label',label:'Eticheta afisata',autoFocus:true},{name:'sortOrder',label:'Ordine afisare',type:'number'}]}
      values={{label:dialog.label,sortOrder:dialog.sortOrder}}
      onChange={(name,value) => setDialog(current => ({...current,[name]:value}))}
      onCancel={() => setDialog(null)}
      onConfirm={confirmDialog}
      confirmDisabled={!dialog.label.trim() || !Number.isFinite(Number(dialog.sortOrder))}
    />}
    {dialog?.type === 'add' && <ActionDialog
      title="Adauga valoare"
      fields={[{name:'code',label:'Cod tehnic stabil',placeholder:'ex. interview',autoFocus:true},{name:'label',label:'Eticheta afisata'}]}
      values={{code:dialog.code,label:dialog.label}}
      onChange={(name,value) => setDialog(current => ({...current,[name]:value}))}
      onCancel={() => setDialog(null)}
      onConfirm={confirmDialog}
      confirmDisabled={!dialog.code.trim() || !dialog.label.trim()}
    />}
    {dialog?.type === 'delete' && <ActionDialog
      title="Sterge valoarea"
      description={`Stergi valoarea "${dialog.item.label}" (${dialog.item.code})?`}
      confirmLabel="Sterge"
      danger
      onCancel={() => setDialog(null)}
      onConfirm={confirmDialog}
    />}
  </div>;
}