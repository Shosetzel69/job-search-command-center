import React, { useMemo, useState } from 'react';
import { sourceCollectionMethod } from '../../shared/source-connectors.mjs';
import {
  ADMIN_SECTIONS,
  SOURCE_SECTIONS,
  adminSourceSummary,
  categoryDuplicate,
  sortCategories,
  sourceApprovalLabel,
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
  const method = source.collection_method || sourceCollectionMethod(source.url) || null;
  return {
    id: source.id,
    category: source.category || 'Altele',
    name: source.name || 'Sursa',
    url: source.url || '#',
    active: source.active === true,
    collectionMethod: method,
    connectorAvailable: source.connector_available ?? Boolean(method),
    validationStatus: source.validation_status || (source.active ? 'validated' : 'pending'),
    approvalStatus: source.approval_status || (source.active ? 'approved' : 'pending'),
    lastValidatedAt: source.last_validated_at || null,
    validationReason: source.validation_reason || null,
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
        {[['update','Actualizare date'],['sources','Surse'],['nomenclatures','Nomenclatoare'],['logs','Loguri']].map(([key,label]) => <button key={key} onClick={() => onNavigate(key)} className="rounded-xl border border-slate-200 p-4 text-left text-sm font-semibold text-slate-700 hover:border-slate-300 hover:bg-slate-50">{label}<div className="mt-1 text-xs font-normal text-slate-400">Deschide sectiunea</div></button>)}
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
    category:source?.category || ordered[0]?.label || '',
  }));
  const [newCategory,setNewCategory] = useState('');
  const [creatingCategory,setCreatingCategory] = useState(false);
  const submit = async () => {
    let category = form.category;
    if (creatingCategory) {
      const label = newCategory.trim().replace(/\s+/g,' ');
      if (!label) return;
      if (categoryDuplicate(categories, label)) return;
      const created = await onCreateCategory(label);
      if (!created) return;
      category = created.label;
    }
    await onSave({ ...form, category });
  };
  return <><button className="fixed inset-0 z-50 bg-slate-950/30" onClick={onClose}/><div className="fixed left-1/2 top-1/2 z-[70] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
    <div className="flex items-center justify-between"><h2 className="font-display text-lg font-bold text-slate-900">{source ? 'Editeaza sursa' : 'Adauga sursa'}</h2><button onClick={onClose} className="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100">×</button></div>
    <div className="mt-4 space-y-3">
      <label className="block text-sm text-slate-700">Nume<input value={form.name} onChange={event => setForm(value => ({...value,name:event.target.value}))} className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 px-3"/></label>
      <label className="block text-sm text-slate-700">URL<input value={form.url} onChange={event => setForm(value => ({...value,url:event.target.value}))} className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 px-3"/></label>
      <label className="block text-sm text-slate-700">Categorie<select value={creatingCategory ? '__new__' : form.category} onChange={event => { if (event.target.value === '__new__') setCreatingCategory(true); else { setCreatingCategory(false); setForm(value => ({...value,category:event.target.value})); } }} className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 bg-white px-3"><option value="" disabled>Selecteaza categoria</option>{ordered.map(category => <option key={category.id} value={category.label}>{category.label}</option>)}<option value="__new__">+ Categorie noua</option></select></label>
      {creatingCategory && <label className="block text-sm text-slate-700">Categorie noua<input value={newCategory} onChange={event => setNewCategory(event.target.value)} className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 px-3"/>{newCategory && categoryDuplicate(categories,newCategory) && <span className="mt-1 block text-xs text-red-600">Categoria exista deja.</span>}</label>}
      {!source && <div className="rounded-xl bg-blue-50 px-3 py-2 text-xs text-blue-700">Sursele noi sunt create `pending` si inactive. Validarea, aprobarea si activarea sunt pasi separati.</div>}
    </div>
    <div className="mt-5 flex justify-end gap-2"><button onClick={onClose} className="h-9 rounded-xl border border-slate-200 px-3 text-sm font-medium text-slate-600">Renunta</button><button disabled={saving || !form.name.trim() || !form.url.trim() || (!creatingCategory && !form.category) || (creatingCategory && (!newCategory.trim() || categoryDuplicate(categories,newCategory)))} onClick={submit} className="h-9 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Se salveaza...' : 'Salveaza'}</button></div>
  </div></>;
}

function Registry({ sources, categories, token, notify, setSources, setCategories }) {
  const [query,setQuery] = useState('');
  const [editing,setEditing] = useState(null);
  const [open,setOpen] = useState(false);
  const [saving,setSaving] = useState(false);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sources.filter(source => !q || `${source.name} ${source.category} ${source.url}`.toLowerCase().includes(q)).sort((a,b) => a.name.localeCompare(b.name));
  }, [sources,query]);
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
    if (!window.confirm(`Elimini definitiv sursa "${source.name}"?`)) return;
    try {
      const payload = await api(`/sources/${encodeURIComponent(source.id)}`, token, { method:'DELETE' });
      applyCatalog(payload); notify('Sursa a fost eliminata.','success');
    } catch (error) { notify(`Sursa nu a putut fi eliminata: ${error.message}`,'error'); }
  };
  return <div className="space-y-4">
    <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row"><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Cauta sursa" className="h-10 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm"/><button onClick={() => { setEditing(null); setOpen(true); }} className="h-10 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white">Adauga sursa</button></div>
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="hidden grid-cols-[minmax(0,1fr)_170px_120px_120px_105px] gap-3 border-b border-slate-100 bg-slate-50 px-5 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400 md:grid"><span>Sursa</span><span>Categorie</span><span>Validare</span><span>Aprobare</span><span>Actiuni</span></div><div className="divide-y divide-slate-100">{rows.map(source => <div key={source.id} className="grid gap-3 px-5 py-3 text-sm md:grid-cols-[minmax(0,1fr)_170px_120px_120px_105px] md:items-center"><div className="min-w-0"><a href={source.url} target="_blank" rel="noreferrer" className="truncate font-semibold text-slate-800 hover:text-blue-700">{source.name}</a><div className="mt-1 flex gap-2 text-xs text-slate-400"><span>{source.collectionMethod || 'fara metoda'}</span>{source.active ? <Pill tone="green">Activa</Pill> : <Pill>Inactiva</Pill>}</div></div><div className="text-xs text-slate-600">{source.category}</div><div><Pill tone={source.validationStatus === 'validated' ? 'green' : source.validationStatus === 'requires_connector' ? 'amber' : source.validationStatus === 'rejected' ? 'red' : 'blue'}>{sourceValidationLabel(source.validationStatus)}</Pill></div><div><Pill tone={source.approvalStatus === 'approved' ? 'green' : source.approvalStatus === 'rejected' ? 'red' : 'slate'}>{sourceApprovalLabel(source.approvalStatus)}</Pill></div><div className="flex gap-2"><button onClick={() => { setEditing(source); setOpen(true); }} className="text-xs font-semibold text-slate-600 hover:text-slate-900">Editeaza</button><button onClick={() => remove(source)} className="text-xs font-semibold text-red-600">Elimina</button></div></div>)}</div></div>
    {!rows.length && <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">Nicio sursa.</div>}
    {open && <SourceDialog source={editing} categories={categories} saving={saving} onClose={() => { setOpen(false); setEditing(null); }} onSave={save} onCreateCategory={createCategory}/>} 
  </div>;
}

function Approval({ sources, token, notify, setSources }) {
  const rows = sources.filter(source => !source.active || source.validationStatus !== 'validated' || source.approvalStatus !== 'approved');
  const apply = payload => setSources((payload?.catalog?.sources || []).map(normalizeSource));
  const action = async (source, actionName) => {
    try {
      const payload = await api(`/sources/${encodeURIComponent(source.id)}/actions`, token, { method:'POST', body:JSON.stringify({ action:actionName }) });
      apply(payload); notify(`Actiune aplicata: ${actionName}.`,'success');
    } catch (error) { notify(`Actiunea nu a putut fi aplicata: ${error.message}`,'error'); }
  };
  return <div className="space-y-3">
    <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">2A implementeaza workflow-ul de guvernanta. Validarea tehnica automata a URL/API/ATS este conectata in 2C; o sursa `validating` nu este activata automat.</div>
    {rows.map(source => <section key={source.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex flex-col gap-3 lg:flex-row lg:items-center"><div className="min-w-0 flex-1"><div className="font-semibold text-slate-900">{source.name}</div><div className="mt-1 text-xs text-slate-500">{source.category} · {source.url}</div><div className="mt-2 flex flex-wrap gap-2"><Pill tone={source.validationStatus === 'validated' ? 'green' : source.validationStatus === 'requires_connector' ? 'amber' : source.validationStatus === 'rejected' ? 'red' : 'blue'}>{sourceValidationLabel(source.validationStatus)}</Pill><Pill tone={source.approvalStatus === 'approved' ? 'green' : source.approvalStatus === 'rejected' ? 'red' : 'slate'}>{sourceApprovalLabel(source.approvalStatus)}</Pill>{source.validationReason && <span className="text-xs text-amber-700">{source.validationReason}</span>}</div></div><div className="flex flex-wrap gap-2">{source.validationStatus === 'pending' && <button onClick={() => action(source,'submit_validation')} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold">Trimite la validare</button>}{['requires_connector','rejected'].includes(source.validationStatus) && <button onClick={() => action(source,'revalidate')} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold">Retrimite la validare</button>}{source.validationStatus === 'validated' && source.approvalStatus !== 'approved' && <button onClick={() => action(source,'approve')} className="rounded-xl bg-blue-600 px-3 py-2 text-xs font-semibold text-white">Aproba</button>}{source.validationStatus === 'validated' && source.approvalStatus === 'approved' && !source.active && <button onClick={() => action(source,'activate')} className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-semibold text-white">Activeaza</button>}{source.active && <button onClick={() => action(source,'disable')} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold">Dezactiveaza</button>}{source.approvalStatus !== 'rejected' && <button onClick={() => action(source,'reject')} className="rounded-xl border border-red-200 px-3 py-2 text-xs font-semibold text-red-700">Respinge</button>}</div></div></section>)}
    {!rows.length && <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">Nu exista surse in asteptare.</div>}
  </div>;
}

function Categories({ categories, sources, token, notify, setCategories, setSources }) {
  const [newLabel,setNewLabel] = useState('');
  const ordered = sortCategories(categories);
  const apply = payload => setCategories(payload?.catalog?.categories || []);
  const create = async () => {
    const label = newLabel.trim().replace(/\s+/g,' ');
    if (!label || categoryDuplicate(categories,label)) return;
    try { const payload = await api('/source-categories', token, { method:'POST', body:JSON.stringify({ label }) }); apply(payload); setNewLabel(''); notify('Categoria a fost creata.','success'); }
    catch (error) { notify(`Categoria nu a putut fi creata: ${error.message}`,'error'); }
  };
  const rename = async category => {
    const label = window.prompt('Noul nume al categoriei', category.label)?.trim().replace(/\s+/g,' ');
    if (!label || label === category.label || categoryDuplicate(categories,label,category.id)) return;
    try { const payload = await api(`/source-categories/${encodeURIComponent(category.id)}`, token, { method:'PUT', body:JSON.stringify({ label }) }); apply(payload); setSources(current => current.map(source => source.category === category.label ? {...source,category:label} : source)); notify('Categoria a fost redenumita.','success'); }
    catch (error) { notify(`Categoria nu a putut fi redenumita: ${error.message}`,'error'); }
  };
  const toggle = async category => {
    try { const payload = await api(`/source-categories/${encodeURIComponent(category.id)}`, token, { method:'PUT', body:JSON.stringify({ active:!category.active }) }); apply(payload); notify('Starea categoriei a fost actualizata.','success'); }
    catch (error) { notify(`Categoria nu a putut fi actualizata: ${error.message}`,'error'); }
  };
  const remove = async category => {
    if (sources.some(source => source.category === category.label)) { notify('Muta mai intai sursele din aceasta categorie.','error'); return; }
    if (!window.confirm(`Stergi categoria "${category.label}"?`)) return;
    try { const payload = await api(`/source-categories/${encodeURIComponent(category.id)}`, token, { method:'DELETE' }); apply(payload); notify('Categoria a fost stearsa.','success'); }
    catch (error) { notify(`Categoria nu a putut fi stearsa: ${error.message}`,'error'); }
  };
  return <div className="space-y-4">
    <div className="flex gap-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><input value={newLabel} onChange={event => setNewLabel(event.target.value)} placeholder="Categorie noua" className="h-10 flex-1 rounded-xl border border-slate-200 px-3 text-sm"/><button disabled={!newLabel.trim() || categoryDuplicate(categories,newLabel)} onClick={create} className="h-10 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white disabled:opacity-50">Adauga</button></div>
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="divide-y divide-slate-100">{ordered.map(category => <div key={category.id} className="flex flex-col gap-3 px-5 py-3 sm:flex-row sm:items-center"><div className="flex-1"><div className="font-semibold text-slate-800">{category.label}</div><div className="text-xs text-slate-400">ID: {category.id} · ordine {category.order} · {sources.filter(source => source.category === category.label).length} surse</div></div><Pill tone={category.active ? 'green' : 'slate'}>{category.active ? 'Activa' : 'Inactiva'}</Pill><button onClick={() => rename(category)} className="text-xs font-semibold text-slate-600">Redenumeste</button><button onClick={() => toggle(category)} className="text-xs font-semibold text-slate-600">{category.active ? 'Dezactiveaza' : 'Activeaza'}</button><button onClick={() => remove(category)} className="text-xs font-semibold text-red-600">Sterge</button></div>)}</div></div>
  </div>;
}

function SourcesAdmin(props) {
  const [section,setSection] = useState('registry');
  return <div className="space-y-4"><Tabs value={section} onChange={setSection} items={SOURCE_SECTIONS.map(key => [key, ({registry:'Surse',approval:'Aprobare surse',categories:'Categorii surse'})[key]])}/>{section === 'registry' && <Registry {...props}/>} {section === 'approval' && <Approval {...props}/>} {section === 'categories' && <Categories {...props}/>}</div>;
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
  if (!runs.length) return <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">Nu exista istoric de rulari.</div>;
  return <div className="space-y-3">{runs.slice(0,10).map(run => <section key={run.run_id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><button onClick={() => setOpen(open === run.run_id ? null : run.run_id)} className="grid w-full gap-2 px-5 py-4 text-left sm:grid-cols-[160px_120px_120px_1fr]"><div><div className="font-semibold text-slate-900">{formatTime(run.completed_at || run.started_at)}</div><div className="text-xs text-slate-400">{run.run_id}</div></div><Pill tone={run.status === 'completed' ? 'green' : run.status === 'completed_with_errors' ? 'amber' : 'red'}>{run.status}</Pill><div className="text-xs text-slate-600">Trigger: {run.trigger || '—'}</div><div className="text-xs text-slate-500">{run.sources_attempted ?? run.sources_processed ?? 0} surse · {run.jobs_published ?? 0} publicate</div></button>{open === run.run_id && <div className="border-t border-slate-100 bg-slate-50 p-4 text-xs text-slate-600"><div className="grid gap-2 md:grid-cols-3"><span>Durata: {run.duration_seconds != null ? `${run.duration_seconds}s` : '—'}</span><span>Brute: {run.records_inspected ?? 0}</span><span>Excluse: {run.excluded ?? 0}</span></div>{run.limitations?.length > 0 && <div className="mt-3 text-amber-700">{run.limitations.join(' · ')}</div>}{run.failed_sources?.length > 0 && <div className="mt-3 text-red-700">Surse cu eroare: {run.failed_sources.join(', ')}</div>}</div>}</section>)}</div>;
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
  const props = { sources, setSources, categories:sourceCategories, setCategories:setSourceCategories, token, notify };
  return <div className="space-y-5">
    <Tabs value={section} onChange={setSection} items={ADMIN_SECTIONS.map(key => [key, ({overview:'Overview',update:'Actualizare date',sources:'Surse',nomenclatures:'Nomenclatoare',logs:'Loguri'})[key]])}/>
    {section === 'overview' && <Overview sources={sources} runStatus={runStatus} onNavigate={setSection}/>} 
    {section === 'update' && <UpdateData runStatus={runStatus} running={running} onRun={onRun}/>} 
    {section === 'sources' && <SourcesAdmin {...props}/>} 
    {section === 'nomenclatures' && <Nomenclatures/>} 
    {section === 'logs' && <Logs runs={runHistory}/>} 
  </div>;
}
