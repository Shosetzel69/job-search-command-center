import React, { useEffect, useMemo, useRef, useState } from 'react';
import { sourceCollectionMethod } from '../../shared/source-connectors.mjs';
import NomenclaturesAdmin from './nomenclatures-admin.jsx';
import ActionDialog from './action-dialog.jsx';
import { createSingleFireGuard } from './action-dialog-guard.mjs';
import { exclusionGroupRows, failureGroupRows, runSummaryLabel, sourceResultDetail, sourceResultRows, sortSourceResultRows, sourceSummaryRows } from './admin-log-model.mjs';
import {
  ADMIN_SECTIONS,
  SOURCE_SECTIONS,
  adminSourceSummary,
  approvalSourceRows,
  categoryDuplicate,
  sortCategories,
  sortSources,
  sourceQuickFilterRows,
  sourceApprovalLabel,
  sourceGovernanceActions,
  sourcePolicyExcluded,
  sourceValidationLabel,
} from './admin-model.mjs';

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
    throw error;
  }
  return payload;
}

function normalizeSource(source) {
  const method = source.collection_method || source.collectionMethod || sourceCollectionMethod(source.url) || null;
  const policyExcluded = sourcePolicyExcluded(source);
  return {
    id: source.id,
    category: source.category || 'Altele',
    name: source.name || 'Sursa',
    url: source.url || '#',
    active: policyExcluded ? false : source.active === true,
    collectionMethod: method,
    connectorAvailable: source.connector_available ?? source.connectorAvailable ?? Boolean(method),
    validationStatus: source.validation_status || source.validationStatus || (source.active ? 'validated' : 'pending'),
    approvalStatus: source.approval_status || source.approvalStatus || (source.active ? 'approved' : 'pending'),
    lastValidatedAt: source.last_validated_at || source.lastValidatedAt || null,
    validationReason: policyExcluded ? 'Exclus operational conform politicii curente.' : (source.validation_reason || source.validationReason || null),
    policyExcluded,
  };
}

function formatTime(value) {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat('ro-RO', {
      day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit', timeZone:'Europe/Bucharest',
    }).format(new Date(value));
  } catch { return value; }
}

function Pill({ children, tone='slate' }) {
  const tones = {
    slate:'bg-slate-100 text-slate-600',
    green:'bg-emerald-50 text-emerald-700',
    blue:'bg-blue-50 text-blue-700',
    amber:'bg-amber-50 text-amber-700',
    red:'bg-red-50 text-red-700',
  };
  return <span className={cx('inline-flex rounded-full px-2 py-1 text-[11px] font-semibold', tones[tone])}>{children}</span>;
}

function Panel({ title, note, children, className='' }) {
  return <section className={cx('rounded-2xl border border-slate-200 bg-white p-5 shadow-sm', className)}>
    <h2 className="font-display text-base font-bold text-slate-900">{title}</h2>
    {note && <p className="mt-1 text-sm text-slate-500">{note}</p>}
    <div className="mt-4">{children}</div>
  </section>;
}

function Tabs({ value, onChange, items }) {
  return <div className="flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
    {items.map(([key,label]) => <button key={key} onClick={() => onChange(key)} className={cx(
      'rounded-xl px-3 py-2 text-sm font-semibold transition',
      value === key ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100',
    )}>{label}</button>)}
  </div>;
}

function Overview({ sources, runStatus, onNavigate }) {
  const summary = adminSourceSummary(sources);
  const activeRun = ['queued','pending','running','in_progress'].includes(runStatus?.status);
  const cards = [
    ['Automatizare','OFF','Configurarea schedulerului intra in 2B'],
    ['Rulare curenta',activeRun ? 'IN CURS' : (runStatus?.status || '—'),activeRun ? 'Urmarire activa' : `Ultima: ${formatTime(runStatus?.completed_at || runStatus?.started_at)}`],
    ['Surse active',String(summary.active),`${sources.length} in registru`],
    ['In validare',String(summary.validating),`${summary.problems} cu probleme`],
  ];
  return <div className="space-y-5">
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{cards.map(([label,value,note]) => <div key={label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</div><div className="mt-2 text-2xl font-bold text-slate-950">{value}</div><div className="mt-1 text-xs text-slate-500">{note}</div></div>)}</div>
    <Panel title="Acces rapid" note="Administrarea ramane separata de executia cautarii.">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[['update','Actualizare date'],['sources','Surse'],['nomenclatures','Nomenclatoare'],['coverage','Coverage'],['users','Utilizatori'],['logs','Loguri']].map(([key,label]) => <button key={key} onClick={() => onNavigate(key)} className="rounded-xl border border-slate-200 p-4 text-left text-sm font-semibold text-slate-700 hover:border-slate-300 hover:bg-slate-50">{label}<div className="mt-1 text-xs font-normal text-slate-400">Deschide sectiunea</div></button>)}
      </div>
    </Panel>
  </div>;
}

function UpdateData({ runStatus, running, onRun }) {
  return <div className="grid gap-5 lg:grid-cols-2">
    <Panel title="Rulare manuala" note="Comanda explicita este singura actiune din aceasta pagina care porneste full search.">
      <div className="space-y-3 text-sm text-slate-600">
        <div><span className="text-slate-400">Status:</span> {runStatus?.status || '—'}</div>
        <div><span className="text-slate-400">Ultima rulare:</span> {formatTime(runStatus?.completed_at || runStatus?.started_at)}</div>
        <div><span className="text-slate-400">Surse procesate:</span> {runStatus?.sources_processed ?? 0}</div>
        <button disabled={running} onClick={onRun} className="mt-2 h-10 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">{running ? 'Rulare in curs...' : 'Ruleaza acum'}</button>
      </div>
    </Panel>
    <Panel title="Automatizare" note="Schedulerul configurabil este Release 2B; starea initiala ramane OFF.">
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-xl bg-slate-50 p-3"><div className="text-xs text-slate-400">Automatizare</div><div className="mt-1 font-bold text-slate-800">OFF</div></div>
        <div className="rounded-xl bg-slate-50 p-3"><div className="text-xs text-slate-400">Urmatoarea rulare</div><div className="mt-1 font-bold text-slate-800">—</div></div>
      </div>
      <p className="mt-3 text-xs text-slate-500">Modificarile administrative nu pornesc full search.</p>
    </Panel>
  </div>;
}

function SourceDialog({ source, categories, saving, onClose, onSave, onCreateCategory }) {
  const ordered = sortCategories(categories).filter(category => category.active || category.label === source?.category);
  const [form,setForm] = useState(() => ({
    name:source?.name || '',
    url:source?.url || '',
    category:source?.category || '',
  }));
  const [newCategory,setNewCategory] = useState('');
  const [creatingCategory,setCreatingCategory] = useState(false);
  const [submitted,setSubmitted] = useState(false);
  const [submitting,setSubmitting] = useState(false);
  const submitGuard = useRef(null);
  if (!submitGuard.current) submitGuard.current = createSingleFireGuard();
  const categoryMissing = !creatingCategory && !form.category;
  const newCategoryInvalid = creatingCategory && (!newCategory.trim() || categoryDuplicate(categories,newCategory));
  const locked = saving || submitting;

  const submit = async () => {
    setSubmitted(true);
    if (!form.name.trim() || !form.url.trim() || categoryMissing || newCategoryInvalid || !submitGuard.current.tryStart()) return;
    setSubmitting(true);
    try {
      let category = form.category;
      if (creatingCategory) {
        const label = newCategory.trim().replace(/\s+/g,' ');
        const created = await onCreateCategory(label);
        if (!created) return;
        category = created.label;
      }
      await onSave({ ...form, category });
    } finally {
      submitGuard.current.finish();
      setSubmitting(false);
    }
  };

  return <>
    <button type="button" aria-label="Inchide dialogul" className="fixed inset-0 z-50 bg-slate-950/30" onClick={onClose} disabled={locked}/>
    <section role="dialog" aria-modal="true" aria-labelledby="source-dialog-title" className="safe-top safe-bottom fixed inset-0 z-[70] overflow-y-auto bg-white p-4 shadow-2xl md:left-1/2 md:top-1/2 md:inset-auto md:w-[calc(100%-2rem)] md:max-w-lg md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-2xl md:border md:border-slate-200 md:p-5">
      <div className="flex items-center justify-between"><h2 id="source-dialog-title" className="font-display text-lg font-bold text-slate-900">{source ? 'Editeaza sursa' : 'Adauga sursa'}</h2><button type="button" onClick={onClose} disabled={locked} className="grid min-h-11 min-w-11 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-50">×</button></div>
      <div className="mt-4 space-y-4">
        <label className="block text-sm text-slate-700">Nume<input value={form.name} onChange={event => setForm(value => ({...value,name:event.target.value}))} className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-200 px-3" disabled={locked}/></label>
        <label className="block text-sm text-slate-700">URL<input value={form.url} onChange={event => setForm(value => ({...value,url:event.target.value}))} className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-200 px-3" disabled={locked}/></label>
        <label className="block text-sm text-slate-700">Categorie
          <select
            value={creatingCategory ? '__new__' : form.category}
            aria-invalid={submitted && categoryMissing ? 'true' : undefined}
            aria-describedby={submitted && categoryMissing ? 'source-category-error' : undefined}
            onChange={event => {
              if (event.target.value === '__new__') { setCreatingCategory(true); setForm(value => ({...value,category:''})); }
              else { setCreatingCategory(false); setForm(value => ({...value,category:event.target.value})); }
            }}
            className={cx('mt-1.5 min-h-11 w-full rounded-xl border bg-white px-3',submitted&&categoryMissing?'border-red-400':'border-slate-200')}
            disabled={locked}
          >
            <option value="">Selecteaza categoria</option>
            {ordered.map(category => <option key={category.id} value={category.label}>{category.label}</option>)}
            <option value="__new__">+ Categorie noua</option>
          </select>
        </label>
        {submitted && categoryMissing && <div id="source-category-error" role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">Categoria este obligatorie inainte de salvarea sursei.</div>}
        {creatingCategory && <label className="block text-sm text-slate-700">Categorie noua<input value={newCategory} onChange={event => setNewCategory(event.target.value)} className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-200 px-3" disabled={locked}/>{newCategory && categoryDuplicate(categories,newCategory) && <span role="alert" className="mt-1 block text-xs text-red-600">Categoria exista deja.</span>}</label>}
        {!source && <div className="rounded-xl bg-blue-50 px-3 py-2 text-xs text-blue-700">Sursele noi sunt create pending si inactive. Validarea, aprobarea si activarea sunt pasi separati.</div>}
      </div>
      <div className="mt-6 flex gap-2 md:justify-end"><button type="button" onClick={onClose} disabled={locked} className="min-h-11 flex-1 rounded-xl border border-slate-200 px-3 text-sm font-medium text-slate-600 disabled:opacity-50 md:flex-none">Renunta</button><button type="button" disabled={locked || !form.name.trim() || !form.url.trim() || newCategoryInvalid} onClick={submit} className="min-h-11 flex-1 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white disabled:opacity-50 md:flex-none">{locked ? 'Se salveaza...' : 'Salveaza'}</button></div>
    </section>
  </>;
}

function Registry({ sources, categories, token, notify, setSources, setCategories, quickFilter='total' }) {
  const [query,setQuery] = useState('');
  const [editing,setEditing] = useState(null);
  const [open,setOpen] = useState(false);
  const [saving,setSaving] = useState(false);
  const [deleteTarget,setDeleteTarget] = useState(null);
  const rows = useMemo(() => sourceQuickFilterRows(sources,{filter:quickFilter,query}), [sources,quickFilter,query]);
  const applyCatalog = payload => setSources((payload?.catalog?.sources || []).map(normalizeSource));
  const createCategory = async label => {
    try {
      const payload = await api('/source-categories', token, { method:'POST', body:JSON.stringify({ label }) });
      const categoriesNext = payload.catalog?.categories || [];
      setCategories(categoriesNext);
      notify('Categoria a fost creata.','success');
      return categoriesNext.find(category => category.label === label) || { label };
    } catch (error) {
      notify(`Categoria nu a putut fi creata: ${error.message}`,'error');
      return null;
    }
  };
  const save = async form => {
    setSaving(true);
    try {
      const payload = await api(editing ? `/sources/${encodeURIComponent(editing.id)}` : '/sources', token, { method:editing ? 'PUT' : 'POST', body:JSON.stringify(form) });
      applyCatalog(payload);
      notify(editing ? 'Sursa a fost actualizata.' : 'Sursa a fost adaugata in fluxul de aprobare.','success');
      setOpen(false); setEditing(null);
    } catch (error) { notify(`Sursa nu a putut fi salvata: ${error.message}`,'error'); }
    finally { setSaving(false); }
  };
  const remove = async source => {
    try {
      const payload = await api(`/sources/${encodeURIComponent(source.id)}`, token, { method:'DELETE' });
      applyCatalog(payload); notify('Sursa a fost eliminata.','success');
    } catch (error) { notify(`Sursa nu a putut fi eliminata: ${error.message}`,'error'); }
    finally { setDeleteTarget(null); }
  };
  return <div className="space-y-4">
    <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row"><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Cauta sursa" className="h-10 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm"/><button onClick={() => { setEditing(null); setOpen(true); }} className="h-10 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white">Adauga sursa</button></div>
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="hidden grid-cols-[minmax(0,1fr)_170px_120px_120px_105px] gap-3 border-b border-slate-100 bg-slate-50 px-5 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400 md:grid"><span>Sursa</span><span>Categorie</span><span>Validare</span><span>Aprobare</span><span>Actiuni</span></div><div className="divide-y divide-slate-100">{rows.map(source => <div key={source.id} className="grid gap-3 px-5 py-3 text-sm md:grid-cols-[minmax(0,1fr)_170px_120px_120px_105px] md:items-center"><div className="min-w-0"><a href={source.url} target="_blank" rel="noreferrer" className="truncate font-semibold text-slate-800 hover:text-blue-700">{source.name}</a><div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-400"><span>{source.collectionMethod || 'fara metoda'}</span>{source.policyExcluded ? <Pill tone="red">Exclus operational</Pill> : source.active ? <Pill tone="green">Activa</Pill> : <Pill>Inactiva</Pill>}</div></div><div className="text-xs text-slate-600">{source.category}</div><div><Pill tone={source.validationStatus === 'validated' ? 'green' : source.validationStatus === 'requires_connector' ? 'amber' : source.validationStatus === 'rejected' ? 'red' : 'blue'}>{sourceValidationLabel(source.validationStatus)}</Pill></div><div><Pill tone={source.approvalStatus === 'approved' ? 'green' : source.approvalStatus === 'rejected' ? 'red' : 'slate'}>{sourceApprovalLabel(source.approvalStatus)}</Pill></div><div className="flex gap-2"><button onClick={() => { setEditing(source); setOpen(true); }} className="text-xs font-semibold text-slate-600 hover:text-slate-900">Editeaza</button><button onClick={() => setDeleteTarget(source)} className="text-xs font-semibold text-red-600">Elimina</button></div></div>)}</div></div>
    {!rows.length && <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">Nicio sursa.</div>}
    {open && <SourceDialog source={editing} categories={categories} saving={saving} onClose={() => { setOpen(false); setEditing(null); }} onSave={save} onCreateCategory={createCategory}/>}
    {deleteTarget && <ActionDialog title="Elimina sursa" description={`Elimini definitiv sursa "${deleteTarget.name}"?`} confirmLabel="Elimina" danger onCancel={() => setDeleteTarget(null)} onConfirm={() => remove(deleteTarget)}/>}
  </div>;
}

function Approval({ sources, token, notify, setSources }) {
  const [mode,setMode] = useState('attention');
  const [query,setQuery] = useState('');
  const rows = useMemo(() => approvalSourceRows(sources,{mode,query}), [sources,mode,query]);
  const attentionCount = useMemo(() => approvalSourceRows(sources).length, [sources]);
  const [reasonDialog,setReasonDialog] = useState(null);
  const apply = payload => setSources((payload?.catalog?.sources || []).map(normalizeSource));
  const action = async (source, actionName, reason = null) => {
    try {
      const body = reason ? { action:actionName, reason } : { action:actionName };
      const payload = await api(`/sources/${encodeURIComponent(source.id)}/actions`, token, { method:'POST', body:JSON.stringify(body) });
      apply(payload); notify(`Actiune aplicata: ${actionName}.`,'success');
    } catch (error) { notify(`Actiunea nu a putut fi aplicata: ${error.message}`,'error'); }
  };
  const requestReason = (source, actionName, title) => setReasonDialog({ source, actionName, title, reason:'' });
  return <div className="space-y-3">
    <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">Validarea, aprobarea si activarea sunt stari distincte. Implicit sunt afisate sursele care necesita atentie; "Toate" pastreaza inspectabilitatea intregului registru.</div>
    <div className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:flex-row sm:items-center">
      <div className="flex gap-2">
        <button onClick={() => setMode('attention')} className={cx('rounded-xl px-3 py-2 text-xs font-semibold',mode==='attention'?'bg-slate-900 text-white':'bg-slate-100 text-slate-600')}>Necesita atentie ({attentionCount})</button>
        <button onClick={() => setMode('all')} className={cx('rounded-xl px-3 py-2 text-xs font-semibold',mode==='all'?'bg-slate-900 text-white':'bg-slate-100 text-slate-600')}>Toate ({sources.length})</button>
      </div>
      <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Cauta sursa" className="h-9 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm sm:ml-auto sm:max-w-xs"/>
    </div>
    {rows.map(source => {
      const actions = sourceGovernanceActions(source);
      return <section key={source.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex flex-col gap-3 lg:flex-row lg:items-center"><div className="min-w-0 flex-1"><div className="font-semibold text-slate-900">{source.name}</div><div className="mt-1 text-xs text-slate-500">{source.category} · {source.url}</div><div className="mt-2 flex flex-wrap gap-2"><Pill tone={source.validationStatus === 'validated' ? 'green' : source.validationStatus === 'requires_connector' ? 'amber' : source.validationStatus === 'rejected' ? 'red' : 'blue'}>{sourceValidationLabel(source.validationStatus)}</Pill><Pill tone={source.approvalStatus === 'approved' ? 'green' : source.approvalStatus === 'rejected' ? 'red' : 'slate'}>{sourceApprovalLabel(source.approvalStatus)}</Pill>{source.policyExcluded ? <Pill tone="red">Exclus operational</Pill> : source.active ? <Pill tone="green">Activa</Pill> : <Pill>Inactiva</Pill>}{source.validationReason && <span className="text-xs text-amber-700">{source.validationReason}</span>}</div></div><div className="flex flex-wrap gap-2">{actions.includes('submit_validation') && <button onClick={() => action(source,'submit_validation')} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold">Trimite la validare</button>}{actions.includes('mark_validated') && <button onClick={() => action(source,'mark_validated')} className="rounded-xl bg-blue-600 px-3 py-2 text-xs font-semibold text-white">Marcheaza validata</button>}{actions.includes('mark_requires_connector') && <button onClick={() => requestReason(source,'mark_requires_connector','Necesita connector')} className="rounded-xl border border-amber-200 px-3 py-2 text-xs font-semibold text-amber-700">Necesita connector</button>}{actions.includes('revalidate') && <button onClick={() => action(source,'revalidate')} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold">Retrimite la validare</button>}{actions.includes('approve') && <button onClick={() => action(source,'approve')} className="rounded-xl bg-blue-600 px-3 py-2 text-xs font-semibold text-white">Aproba</button>}{actions.includes('activate') && <button onClick={() => action(source,'activate')} className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-semibold text-white">Activeaza</button>}{actions.includes('disable') && <button onClick={() => action(source,'disable')} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold">Dezactiveaza</button>}{actions.includes('reject') && <button onClick={() => requestReason(source,'reject','Respinge sursa')} className="rounded-xl border border-red-200 px-3 py-2 text-xs font-semibold text-red-700">Respinge</button>}</div></div></section>;
    })}
    {!rows.length && <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">Nu exista surse in registru.</div>}
    {reasonDialog && <ActionDialog
      title={reasonDialog.title}
      description="Motivul este optional."
      fields={[{name:'reason',label:'Motiv (optional)',autoFocus:true}]}
      values={{reason:reasonDialog.reason}}
      onChange={(_,value) => setReasonDialog(current => ({...current,reason:value}))}
      onCancel={() => setReasonDialog(null)}
      onConfirm={async () => { const current=reasonDialog; setReasonDialog(null); await action(current.source,current.actionName,current.reason.trim() || null); }}
    />}
  </div>;
}

function Categories({ categories, sources, token, notify, setCategories, setSources }) {
  const [newLabel,setNewLabel] = useState('');
  const [renameTarget,setRenameTarget] = useState(null);
  const [renameValue,setRenameValue] = useState('');
  const [deleteTarget,setDeleteTarget] = useState(null);
  const ordered = sortCategories(categories);
  const apply = payload => setCategories(payload?.catalog?.categories || []);
  const create = async () => {
    const label = newLabel.trim().replace(/\s+/g,' ');
    if (!label || categoryDuplicate(categories,label)) return;
    try { const payload = await api('/source-categories', token, { method:'POST', body:JSON.stringify({ label }) }); apply(payload); setNewLabel(''); notify('Categoria a fost creata.','success'); }
    catch (error) { notify(`Categoria nu a putut fi creata: ${error.message}`,'error'); }
  };
  const rename = async category => {
    const label = renameValue.trim().replace(/\s+/g,' ');
    if (!label || label === category.label || categoryDuplicate(categories,label,category.id)) return;
    try { const payload = await api(`/source-categories/${encodeURIComponent(category.id)}`, token, { method:'PUT', body:JSON.stringify({ label }) }); apply(payload); setSources(current => current.map(source => source.category === category.label ? {...source,category:label} : source)); notify('Categoria a fost redenumita.','success'); }
    catch (error) { notify(`Categoria nu a putut fi redenumita: ${error.message}`,'error'); }
    finally { setRenameTarget(null); setRenameValue(''); }
  };
  const toggle = async category => {
    try { const payload = await api(`/source-categories/${encodeURIComponent(category.id)}`, token, { method:'PUT', body:JSON.stringify({ active:!category.active }) }); apply(payload); notify('Starea categoriei a fost actualizata.','success'); }
    catch (error) { notify(`Categoria nu a putut fi actualizata: ${error.message}`,'error'); }
  };
  const remove = async category => {
    try { const payload = await api(`/source-categories/${encodeURIComponent(category.id)}`, token, { method:'DELETE' }); apply(payload); notify('Categoria a fost stearsa.','success'); }
    catch (error) { notify(`Categoria nu a putut fi stearsa: ${error.message}`,'error'); }
    finally { setDeleteTarget(null); }
  };
  const requestDelete = category => {
    if (sources.some(source => source.category === category.label)) { notify('Muta mai intai sursele din aceasta categorie.','error'); return; }
    setDeleteTarget(category);
  };
  return <div className="space-y-4">
    <div className="flex gap-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><input value={newLabel} onChange={event => setNewLabel(event.target.value)} placeholder="Categorie noua" className="h-10 flex-1 rounded-xl border border-slate-200 px-3 text-sm"/><button disabled={!newLabel.trim() || categoryDuplicate(categories,newLabel)} onClick={create} className="h-10 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white disabled:opacity-50">Adauga</button></div>
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="divide-y divide-slate-100">{ordered.map(category => <div key={category.id} className="flex flex-col gap-3 px-5 py-3 sm:flex-row sm:items-center"><div className="flex-1"><div className="font-semibold text-slate-800">{category.label}</div><div className="text-xs text-slate-400">ID: {category.id} · ordine {category.order} · {sources.filter(source => source.category === category.label).length} surse</div></div><Pill tone={category.active ? 'green' : 'slate'}>{category.active ? 'Activa' : 'Inactiva'}</Pill><button onClick={() => { setRenameTarget(category); setRenameValue(category.label); }} className="text-xs font-semibold text-slate-600">Redenumeste</button><button onClick={() => toggle(category)} className="text-xs font-semibold text-slate-600">{category.active ? 'Dezactiveaza' : 'Activeaza'}</button><button onClick={() => requestDelete(category)} className="text-xs font-semibold text-red-600">Sterge</button></div>)}</div></div>
    {renameTarget && <ActionDialog title="Redenumeste categoria" fields={[{name:'label',label:'Nume categorie',autoFocus:true}]} values={{label:renameValue}} onChange={(_,value) => setRenameValue(value)} onCancel={() => { setRenameTarget(null); setRenameValue(''); }} onConfirm={() => rename(renameTarget)} confirmDisabled={!renameValue.trim() || renameValue.trim() === renameTarget.label || categoryDuplicate(categories,renameValue,renameTarget.id)}/>}
    {deleteTarget && <ActionDialog title="Sterge categoria" description={`Stergi categoria "${deleteTarget.label}"?`} confirmLabel="Sterge" danger onCancel={() => setDeleteTarget(null)} onConfirm={() => remove(deleteTarget)}/>}
  </div>;
}

function SourcesAdmin(props) {
  const [section,setSection] = useState('registry');
  const [quickFilter,setQuickFilter] = useState('total');
  const summary = adminSourceSummary(props.sources);
  const counters = [
    ['total','Total',summary.total],
    ['active','Active',summary.active],
    ['inactive','Inactive',summary.inactive],
    ['pendingApproval','Asteapta aprobare',summary.pendingApproval],
    ['validated','Validate',summary.validated],
    ['problems','Probleme',summary.problems],
  ];
  const selectQuickFilter = key => {
    setSection('registry');
    setQuickFilter(current => key === 'total' || current === key ? 'total' : key);
  };
  return <div className="space-y-4">
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">{counters.map(([key,label,value]) => <button type="button" key={key} aria-pressed={quickFilter===key} onClick={()=>selectQuickFilter(key)} className={cx('min-h-20 rounded-xl border bg-white px-3 py-3 text-left shadow-sm transition',quickFilter===key?'border-blue-400 ring-2 ring-blue-50':'border-slate-200 hover:border-slate-300')}><div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</div><div className="mt-1 text-xl font-bold text-slate-900">{value}</div></button>)}</div>
    <Tabs value={section} onChange={setSection} items={SOURCE_SECTIONS.map(key => [key, ({registry:'Surse',approval:'Aprobare surse',categories:'Categorii surse'})[key]])}/>
    {section === 'registry' && <Registry {...props} quickFilter={quickFilter}/>} 
    {section === 'approval' && <Approval {...props}/>} 
    {section === 'categories' && <Categories {...props}/>} 
  </div>;
}

function Nomenclatures() {
  const groups = [
    ['Regiuni','EU, US, ASIA'],
    ['Moduri de lucru','Remote, Hybrid, Onsite, N/A'],
    ['Statusuri aplicatii','applied (set curent)'],
    ['Tari','Coduri ISO alpha-2, controlate in configuratia geografica'],
  ];
  return <Panel title="Nomenclatoare" note="Contract extensibil. In 2A sunt expuse valorile controlate existente; editarea regulilor de business va fi adaugata incremental."><div className="grid gap-3 sm:grid-cols-2">{groups.map(([title,values]) => <div key={title} className="rounded-xl bg-slate-50 p-4"><div className="text-sm font-semibold text-slate-800">{title}</div><div className="mt-1 text-xs leading-5 text-slate-500">{values}</div></div>)}</div></Panel>;
}

function Logs({ runs }) {
  const [open,setOpen] = useState(null);
  const [sourceSort,setSourceSort] = useState({key:'source',direction:'asc'});
  const toggleSourceSort = key => setSourceSort(current => ({
    key,
    direction:current.key===key && current.direction==='asc' ? 'desc' : 'asc',
  }));
  const SortHeader = ({field,children}) => {
    const active=sourceSort.key===field;
    return <button type="button" onClick={()=>toggleSourceSort(field)} className="flex w-full items-center gap-1 text-left font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-800">
      <span>{children}</span><span aria-hidden="true">{active?(sourceSort.direction==='asc'?'↑':'↓'):'↕'}</span>
    </button>;
  };
  if (!runs.length) return <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">Nu exista istoric de rulari.</div>;
  return <div className="space-y-3">{runs.slice(0,10).map(run => {
    const summary = sourceSummaryRows(run);
    const failureGroups = failureGroupRows(run);
    const exclusionGroups = exclusionGroupRows(run);
    const sourceRows = sortSourceResultRows(sourceResultRows(run),sourceSort.key,sourceSort.direction);
    return <section key={run.run_id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <button onClick={() => setOpen(open === run.run_id ? null : run.run_id)} className="grid w-full gap-2 px-5 py-4 text-left sm:grid-cols-[160px_120px_120px_1fr]">
        <div><div className="font-semibold text-slate-900">{formatTime(run.completed_at || run.started_at)}</div><div className="text-xs text-slate-400">{run.run_id}</div></div>
        <Pill tone={run.status === 'completed' ? 'green' : run.status === 'completed_with_errors' ? 'amber' : 'red'}>{run.status}</Pill>
        <div className="text-xs text-slate-600">Trigger: {run.trigger || '—'}</div>
        <div className="text-xs text-slate-500">{runSummaryLabel(run)}</div>
      </button>
      {open === run.run_id && <div className="border-t border-slate-100 bg-slate-50 p-4 text-xs text-slate-600">
        <div className="grid gap-2 md:grid-cols-3"><span>Durata: {run.duration_seconds != null ? `${run.duration_seconds}s` : '—'}</span><span>Brute: {run.records_inspected ?? 0}</span><span>Excluse: {run.excluded ?? 0}</span></div>

        {summary.length > 0 && <div className="mt-4">
          <div className="mb-2 font-semibold text-slate-700">Rezultat surse</div>
          <div className="flex flex-wrap gap-2">{summary.map(item => <Pill key={item.outcome} tone={item.tone}>{item.label}: {item.count}</Pill>)}</div>
        </div>}

        {(exclusionGroups.categories.length > 0 || exclusionGroups.reasons.length > 0) && <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-amber-100 bg-white p-3">
            <div className="font-semibold text-slate-700">Excluderi dupa categorie</div>
            <div className="mt-2 space-y-1">{exclusionGroups.categories.map(item => <div key={item.key} className="flex justify-between gap-3"><span>{item.label}</span><span className="font-semibold">{item.count}</span></div>)}</div>
          </div>
          <div className="rounded-xl border border-amber-100 bg-white p-3">
            <div className="font-semibold text-slate-700">Excluderi dupa motiv exact</div>
            <div className="mt-2 space-y-1">{exclusionGroups.reasons.map(item => <div key={item.key} className="flex justify-between gap-3"><span>{item.key}</span><span className="font-semibold">{item.count}</span></div>)}</div>
          </div>
        </div>}

        {(failureGroups.errorCodes.length > 0 || failureGroups.failureStages.length > 0) && <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-red-100 bg-white p-3">
            <div className="font-semibold text-red-700">Erori dupa cod</div>
            <div className="mt-2 space-y-1">{failureGroups.errorCodes.map(item => <div key={item.key} className="flex justify-between gap-3"><span>{item.key}</span><span className="font-semibold">{item.count}</span></div>)}</div>
          </div>
          <div className="rounded-xl border border-red-100 bg-white p-3">
            <div className="font-semibold text-red-700">Erori dupa etapa</div>
            <div className="mt-2 space-y-1">{failureGroups.failureStages.map(item => <div key={item.key} className="flex justify-between gap-3"><span>{item.key}</span><span className="font-semibold">{item.count}</span></div>)}</div>
          </div>
        </div>}

        {sourceRows.length > 0 && <div className="mt-4">
          <div className="space-y-2 md:hidden">
            {sourceRows.map((item,index) => {
              const detail=sourceResultDetail(item);
              const warning=['partial','blocked','no_extractable_jobs'].includes(item.outcome);
              return <article key={`${item.source}-compact-${index}`} className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="flex items-start justify-between gap-2"><div className="font-semibold text-slate-700">{item.source}</div><Pill tone={item.outcomeMeta.tone}>{item.outcomeMeta.label}</Pill></div>
                <div className="mt-2 text-xs text-slate-500">Joburi: <strong className="text-slate-700">{item.jobsLabel}</strong></div>
                <div className={cx('mt-2 break-words text-xs',item.outcome === 'failed' ? 'text-red-700' : warning ? 'text-amber-700' : 'text-slate-500')}>{detail}</div>
              </article>;
            })}
          </div>
          <div className="hidden overflow-hidden rounded-xl border border-slate-200 bg-white md:block">
            <div className="grid grid-cols-[minmax(180px,1fr)_180px_80px_minmax(220px,1fr)] gap-3 border-b border-slate-200 bg-slate-50 px-3 py-2 text-[10px]">
              <SortHeader field="source">Sursa</SortHeader><SortHeader field="status">Status</SortHeader><SortHeader field="jobs">Joburi</SortHeader><SortHeader field="detail">Detaliu</SortHeader>
            </div>
            <div className="divide-y divide-slate-100">{sourceRows.map((item,index) => {
              const detail=sourceResultDetail(item);
              const warning=['partial','blocked','no_extractable_jobs'].includes(item.outcome);
              return <div key={`${item.source}-${index}`} className="grid grid-cols-[minmax(180px,1fr)_180px_80px_minmax(220px,1fr)] gap-3 px-3 py-2"><div className="font-medium text-slate-700">{item.source}</div><div><Pill tone={item.outcomeMeta.tone}>{item.outcomeMeta.label}</Pill></div><div>{item.jobsLabel}</div><div className={item.outcome === 'failed' ? 'text-red-700' : warning ? 'text-amber-700' : 'text-slate-500'} title={item.message || undefined}>{detail}</div></div>;
            })}</div>
          </div>
        </div>}

        {run.limitations?.length > 0 && <div className="mt-3 text-amber-700">{run.limitations.join(' · ')}</div>}
      </div>}
    </section>;
  })}</div>;
}


function CoverageAdmin({ token, notify }) {
  const [snapshot,setSnapshot] = useState(null);
  const [loading,setLoading] = useState(true);

  useEffect(() => {
    let active=true;
    setLoading(true);
    api('/admin/coverage', token)
      .then(payload => { if(active)setSnapshot(payload); })
      .catch(error => { if(active)notify(`Coverage nu a putut fi incarcat: ${error.message}`,'error'); })
      .finally(() => { if(active)setLoading(false); });
    return () => { active=false; };
  }, [token, notify]);

  if (loading) return <Panel title="Coverage" note="Stare globala a corpusului pe scope-uri bounded."><div className="text-sm text-slate-500">Se incarca Coverage...</div></Panel>;
  const scopes=Array.isArray(snapshot?.scopes)?snapshot.scopes:[];
  const counts=snapshot?.state_counts||{};
  const policy=snapshot?.policy||{};
  const tone=state=>state==='SUFFICIENT'?'green':state==='STALE'?'amber':'red';
  return <div className="space-y-4">
    <div className="grid gap-3 sm:grid-cols-3">
      {[['SUFFICIENT',counts.SUFFICIENT||0],['STALE',counts.STALE||0],['INSUFFICIENT',counts.INSUFFICIENT||0]].map(([label,value])=>
        <div key={label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</div><div className="mt-2 text-2xl font-bold text-slate-950">{value}</div></div>
      )}
    </div>
    <Panel title="Collection Policy" note="Threshold-urile sunt globale/system; Coverage nu reprezinta oportunitati USER.">
      <div className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
        <div><span className="text-slate-400">Freshness:</span> {policy.collection_freshness_hours ?? '—'}h</div>
        <div><span className="text-slate-400">Corpus minim:</span> {policy.coverage_min_corpus_volume ?? '—'}</div>
        <div><span className="text-slate-400">Diversitate minima:</span> {policy.coverage_min_source_diversity ?? '—'}</div>
        <div><span className="text-slate-400">Cooldown:</span> {policy.coverage_refresh_cooldown_hours ?? 0}h</div>
      </div>
    </Panel>
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="hidden grid-cols-[minmax(170px,1fr)_120px_110px_110px_150px_minmax(220px,1.2fr)] gap-3 border-b border-slate-100 bg-slate-50 px-5 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400 lg:grid">
        <span>Role Family</span><span>Stare</span><span>Volum</span><span>Surse</span><span>Ultimul usable</span><span>Scope</span>
      </div>
      <div className="divide-y divide-slate-100">
        {scopes.map(item => <div key={item.scope_key} className="grid gap-3 px-5 py-4 text-sm lg:grid-cols-[minmax(170px,1fr)_120px_110px_110px_150px_minmax(220px,1.2fr)] lg:items-center">
          <div className="font-semibold text-slate-800">{item.scope?.role_family || '—'}</div>
          <div><Pill tone={tone(item.state)}>{item.state}</Pill></div>
          <div className="tabular-nums text-slate-700">{item.corpus_volume ?? 0}</div>
          <div className="tabular-nums text-slate-700">{item.source_diversity ?? 0}</div>
          <div className="text-xs text-slate-600">{formatTime(item.last_usable_at)}</div>
          <div className="text-xs leading-5 text-slate-500">
            {(item.scope?.target_regions||[]).join(', ') || (item.scope?.target_country_codes||[]).join(', ') || 'global'} · {(item.scope?.work_modes||[]).join('/')}
          </div>
        </div>)}
      </div>
    </div>
    {!scopes.length&&<div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">Nu exista inca observatii Coverage. Primul bounded Retrieve utilizabil va popula aceasta zona.</div>}
  </div>;
}


function UsersAdmin({ token, notify }) {
  const [accounts,setAccounts] = useState([]);
  const [loading,setLoading] = useState(true);
  const [busyUserId,setBusyUserId] = useState(null);
  const [deleteTarget,setDeleteTarget] = useState(null);

  const reload = async () => {
    const payload = await api('/admin/accounts', token);
    setAccounts(Array.isArray(payload?.accounts) ? payload.accounts : []);
    return payload;
  };

  useEffect(() => {
    let active = true;
    setLoading(true);
    api('/admin/accounts', token)
      .then(payload => { if (active) setAccounts(Array.isArray(payload?.accounts) ? payload.accounts : []); })
      .catch(error => { if (active) notify(`Lista de utilizatori nu a putut fi incarcata: ${error.message}`,'error'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token, notify]);

  const changeStatus = async account => {
    const action = account.status === 'ACTIVE' ? 'deactivate' : 'reactivate';
    setBusyUserId(account.user_id);
    try {
      await api(`/admin/accounts/${encodeURIComponent(account.user_id)}/${action}`, token, { method:'POST' });
      await reload();
      notify(account.status === 'ACTIVE' ? 'Contul a fost dezactivat; sesiunile active au fost revocate.' : 'Contul a fost reactivat; este necesara o autentificare noua.','success');
    } catch (error) {
      notify(`Starea contului nu a putut fi modificata: ${error.message}`,'error');
    } finally {
      setBusyUserId(null);
    }
  };

  const remove = async account => {
    setBusyUserId(account.user_id);
    try {
      await api(`/admin/accounts/${encodeURIComponent(account.user_id)}`, token, { method:'DELETE' });
      await reload();
      notify('Contul si datele personale asociate au fost sterse definitiv.','success');
    } catch (error) {
      notify(`Contul nu a putut fi sters: ${error.message}`,'error');
    } finally {
      setBusyUserId(null);
      setDeleteTarget(null);
    }
  };

  if (loading) return <Panel title="Utilizatori" note="Doar metadata de cont este vizibila administratorului."><div className="text-sm text-slate-500">Se incarca utilizatorii...</div></Panel>;

  return <div className="space-y-4">
    <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
      Administratorul poate gestiona doar ciclul de viata al contului. Criteriile, FIT, aplicarile, notele si workspace-ul personal nu sunt expuse aici.
    </div>
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="hidden grid-cols-[minmax(220px,1.4fr)_100px_120px_150px_150px_minmax(220px,1fr)] gap-3 border-b border-slate-100 bg-slate-50 px-5 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400 lg:grid">
        <span>Utilizator</span><span>Rol</span><span>Status</span><span>Creat</span><span>Ultimul login</span><span>Actiuni</span>
      </div>
      <div className="divide-y divide-slate-100">
        {accounts.map(account => <div key={account.user_id} className="grid gap-3 px-5 py-4 text-sm lg:grid-cols-[minmax(220px,1.4fr)_100px_120px_150px_150px_minmax(220px,1fr)] lg:items-center">
          <div className="min-w-0"><div className="truncate font-semibold text-slate-800">{account.email || 'Email indisponibil'}</div><div className="mt-1 truncate text-xs text-slate-400">{account.user_id}</div></div>
          <div><Pill tone={account.role === 'ADMIN' ? 'blue' : 'slate'}>{account.role}</Pill></div>
          <div><Pill tone={account.status === 'ACTIVE' ? 'green' : 'amber'}>{account.status}</Pill></div>
          <div className="text-xs text-slate-600">{formatTime(account.created_at)}</div>
          <div className="text-xs text-slate-600">{account.last_login_at ? formatTime(account.last_login_at) : '—'}</div>
          <div className="flex flex-wrap gap-2">
            <button disabled={busyUserId===account.user_id} onClick={() => changeStatus(account)} className="min-h-9 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700 disabled:opacity-50">{account.status === 'ACTIVE' ? 'Dezactiveaza' : 'Reactiveaza'}</button>
            <button disabled={busyUserId===account.user_id} onClick={() => setDeleteTarget(account)} className="min-h-9 rounded-lg border border-red-200 px-3 text-xs font-semibold text-red-700 disabled:opacity-50">Sterge</button>
          </div>
        </div>)}
      </div>
    </div>
    {!accounts.length && <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">Nu exista conturi.</div>}
    {deleteTarget && <ActionDialog
      title="Sterge definitiv contul"
      description={`Stergerea contului ${deleteTarget.email || deleteTarget.user_id} este ireversibila. Sesiunile si datele personale vor fi eliminate; corpusul partajat ramane intact.`}
      confirmLabel="Sterge definitiv"
      danger
      busy={busyUserId===deleteTarget.user_id}
      onCancel={() => setDeleteTarget(null)}
      onConfirm={() => remove(deleteTarget)}
    />}
  </div>;
}

export default function AdminShell({
  sources,
  setSources,
  sourceCategories,
  setSourceCategories,
  runStatus,
  runHistory,
  running,
  onRun,
  notify,
  token,
}) {
  const [section,setSection] = useState('overview');
  const governedSources = useMemo(() => sources.map(normalizeSource), [sources]);
  const props = { sources:governedSources, setSources, categories:sourceCategories, setCategories:setSourceCategories, token, notify };
  return <div className="space-y-5">
    <Tabs value={section} onChange={setSection} items={ADMIN_SECTIONS.map(key => [key, ({overview:'Overview',update:'Actualizare date',sources:'Surse',nomenclatures:'Nomenclatoare',coverage:'Coverage',users:'Utilizatori',logs:'Loguri'})[key]])}/>
    {section === 'overview' && <Overview sources={governedSources} runStatus={runStatus} onNavigate={setSection}/>} 
    {section === 'update' && <UpdateData runStatus={runStatus} running={running} onRun={onRun}/>} 
    {section === 'sources' && <SourcesAdmin {...props}/>} 
    {section === 'nomenclatures' && <NomenclaturesAdmin token={token} notify={notify}/>} 
    {section === 'coverage' && <CoverageAdmin token={token} notify={notify}/>} 
    {section === 'users' && <UsersAdmin token={token} notify={notify}/>} 
    {section === 'logs' && <Logs runs={runHistory}/>} 
  </div>;
}