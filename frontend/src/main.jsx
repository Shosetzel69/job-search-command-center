import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';

const DATA_SCHEMA = '1.0';
const ALL_WORK_MODES = ['Remote', 'Hybrid', 'Onsite', 'N/A'];
const EXCLUSION_SUGGESTIONS = [
  'Star Storage si companiile grupului',
  'Implementari ERP care cer experienta specializata ampla',
  'Roluri non-IT',
  'Roluri exclusiv onsite in afara Bucurestiului',
];

const cx = (...classes) => classes.filter(Boolean).join(' ');

function Icon({ name, className = 'h-4 w-4' }) {
  const common = { className, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true };
  const paths = {
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></>,
    refresh: <><path d="M20 6v5h-5"/><path d="M4 18v-5h5"/><path d="M18.5 9a7 7 0 0 0-12-2.5L4 11"/><path d="M5.5 15A7 7 0 0 0 18 17.5L20 13"/></>,
    jobs: <><rect x="4" y="7" width="16" height="12" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/><path d="M4 12h16"/></>,
    review: <><circle cx="12" cy="12" r="9"/><path d="M9 12l2 2 4-4"/></>,
    applications: <><path d="M5 4h14v16H5z"/><path d="M8 8h8M8 12h8M8 16h5"/></>,
    criteria: <><path d="M4 6h16M7 12h10M9 18h6"/><circle cx="8" cy="6" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="12" cy="18" r="1.6"/></>,
    sources: <><rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/></>,
    chevronDown: <path d="m7 10 5 5 5-5"/>,
    external: <><path d="M14 5h5v5"/><path d="m10 14 9-9"/><path d="M19 13v6H5V5h6"/></>,
    archive: <><path d="M4 7h16"/><path d="M6 7v12h12V7"/><path d="M9 11h6"/><path d="M5 4h14v3H5z"/></>,
    eye: <><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.5"/></>,
    reset: <><path d="M4 4v6h6"/><path d="M5.5 14A7 7 0 1 0 7 7l-3 3"/></>,
    logout: <><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/><path d="M15 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/></>,
    retry: <><path d="M20 6v5h-5"/><path d="M18.5 9a7 7 0 1 0 .5 7"/></>,
    close: <><path d="m6 6 12 12M18 6 6 18"/></>,
    alert: <><path d="M12 3 2.5 20h19L12 3Z"/><path d="M12 9v4M12 17h.01"/></>,
  };
  return <svg {...common}>{paths[name] || paths.jobs}</svg>;
}

function validateContract(payload, name) {
  if (payload?.schema_version !== DATA_SCHEMA) throw new Error(`${name}: versiune contract ${payload?.schema_version || 'lipsa'}; asteptat ${DATA_SCHEMA}`);
}

async function fetchJson(path, token) {
  const response = await fetch(path, { headers: token ? { Authorization: `Bearer ${token}` } : {}, cache: 'no-store' });
  let payload = null;
  try { payload = await response.json(); } catch { payload = null; }
  if (!response.ok) {
    const error = new Error(payload?.error || `${path}: HTTP ${response.status}`);
    error.status = response.status;
    error.path = path;
    throw error;
  }
  return payload;
}

async function commandApi(path, token, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  const response = await fetch(path, { ...options, headers, cache: 'no-store' });
  let payload = null;
  try { payload = await response.json(); } catch { payload = null; }
  if (!response.ok) {
    const error = new Error(payload?.error || `HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

function ageHours(value, fallback = 0) {
  if (!value) return Number.isFinite(Number(fallback)) ? Number(fallback) : 0;
  const ms = Date.now() - new Date(value).getTime();
  return Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 3600000)) : Number(fallback) || 0;
}

function normalizeMode(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'remote') return 'Remote';
  if (raw === 'hybrid') return 'Hybrid';
  if (['onsite', 'on-site', 'office', 'in-office'].includes(raw)) return 'Onsite';
  return 'N/A';
}

function normalizeJob(job) {
  return {
    id: job.id || null,
    title: job.title || 'Titlu indisponibil', company: job.company || 'Companie nespecificata',
    initial: job.initial || ((job.company || '?').split(/\s+/).slice(0, 2).map(x => x[0]).join('').toUpperCase() || '?'),
    fit: Number.isFinite(Number(job.fit)) ? Number(job.fit) : 0, location: job.location || 'Nespecificat', mode: normalizeMode(job.mode), type: job.type || 'Nespecificat', age: ageHours(job.date_posted, job.age),
    remote: Boolean(job.remote), b2b: Boolean(job.b2b), repost: Boolean(job.repost), status: job.status || 'review',
    pros: Array.isArray(job.pros) ? job.pros : [], risks: Array.isArray(job.risks) ? job.risks : [], url: job.url || null,
    description: String(job.description || '').trim(), date_posted: job.date_posted || null, source: job.source || 'Nespecificata', verified_at: job.verified_at || null, isApplication: false,
  };
}

function normalizeApplication(application) {
  const ref = application.reference ? `Referinta: ${application.reference}` : 'Referinta nespecificata';
  const next = application.next_status_check ? `Urmatorul status check: ${application.next_status_check}` : 'Status check nespecificat';
  return {
    id: application.id || `application-${application.company || ''}-${application.title || ''}-${application.applied_at || ''}`,
    title: application.title || 'Rol nespecificat', company: application.company || 'Companie nespecificata',
    initial: (application.company || '?').split(/\s+/).slice(0, 2).map(x => x[0]).join('').toUpperCase() || '?', fit: null,
    location: application.location || 'Nespecificat', mode: 'N/A', type: 'Aplicat', age: 0, remote: false, b2b: false, repost: false,
    status: application.status || 'applied', pros: [`Aplicat: ${application.applied_at || 'data nespecificata'}`, ref], risks: [next], url: application.url || null,
    description: `Status: ${application.status || 'applied'}. ${ref}. ${next}.`, source: 'Istoric aplicari', date_posted: application.applied_at || null, isApplication: true,
  };
}

function criteriaFromConfig(config) {
  const groups = config?.role_groups || {}, modes = config?.work_modes || {};
  const legacyMode = config?.jobspipe_enabled === true ? 'direct' : 'disabled';
  return {
    rolePm: groups.pm?.enabled !== false, roleDelivery: groups.delivery?.enabled !== false, roleService: groups.service?.enabled !== false,
    roleScrum: groups.scrum?.enabled !== false, roleProgram: groups.program?.enabled !== false, workRemote: modes.remote !== false, workHybrid: modes.hybrid !== false,
    freshness: Number(config?.freshness_hours ?? 24), fitThreshold: Number(config?.fit_threshold ?? 80), keepReposts: config?.keep_reposts !== false,
    rateMin: Number(config?.rate_min_eur_day ?? 250), rateMax: Number(config?.rate_max_eur_day ?? 650), immediateStart: config?.immediate_start !== false,
    jobspipeMode: config?.jobspipe_mode || legacyMode,
    jobspipeApifyMaxItems: Number(config?.jobspipe_apify_max_items_per_run ?? 5000),
    jobspipeDirectRunBudget: Number(config?.jobspipe_credit_budget_per_run ?? 14),
    jobspipeDirectMonthlyGuard: Number(config?.jobspipe_monthly_credit_guard ?? 950),
    exclusions: Array.isArray(config?.exclusions) ? [...config.exclusions] : [],
  };
}

const jobKey = job => String(job.id || `${job.title}|${job.company}|${job.date_posted || ''}`);
function publishedLabel(job) {
  if (job.isApplication) return job.date_posted ? `aplicat ${job.date_posted}` : 'aplicat';
  const age = ageHours(job.date_posted, job.age);
  if (age < 1) return 'sub 1h';
  if (age < 24) return `${age}h`;
  const days = Math.floor(age / 24), hours = age % 24;
  return hours ? `${days}z ${hours}h` : `${days}z`;
}

function loadGoogleIdentityScript() {
  if (window.google?.accounts?.id) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-google-identity]');
    if (existing) { existing.addEventListener('load', resolve, { once: true }); existing.addEventListener('error', reject, { once: true }); return; }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client'; script.async = true; script.defer = true; script.dataset.googleIdentity = 'true'; script.onload = resolve;
    script.onerror = () => reject(new Error('Google Identity Services nu a putut fi incarcat.')); document.head.appendChild(script);
  });
}

function GoogleSignIn({ clientId, onCredential, disabled }) {
  const ref = useRef(null);
  useEffect(() => {
    let active = true;
    if (!clientId || disabled) return undefined;
    loadGoogleIdentityScript().then(() => {
      if (!active || !ref.current) return;
      window.google.accounts.id.initialize({ client_id: clientId, callback: ({ credential }) => onCredential(credential), auto_select: false, cancel_on_tap_outside: true });
      ref.current.innerHTML = '';
      window.google.accounts.id.renderButton(ref.current, { theme: 'outline', size: 'large', shape: 'rectangular', text: 'signin_with' });
    }).catch(() => {});
    return () => { active = false; };
  }, [clientId, disabled, onCredential]);
  return <div ref={ref} className={disabled ? 'pointer-events-none opacity-60' : ''} />;
}

function Toast({ toast }) {
  if (!toast) return null;
  return <div className={cx('fixed bottom-5 right-5 z-[70] max-w-sm rounded-xl border bg-white px-4 py-3 text-sm text-slate-800 shadow-lg', toast.type === 'success' ? 'border-emerald-200' : toast.type === 'error' ? 'border-red-200' : 'border-slate-200')} role="status"><div className="flex items-start gap-3"><span className={cx('mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full', toast.type === 'success' ? 'bg-emerald-500' : toast.type === 'error' ? 'bg-red-500' : 'bg-slate-400')} /><span>{toast.message}</span></div></div>;
}

function Brand() { return <div className="flex items-center gap-3 px-5 py-5"><div className="grid h-10 w-10 place-items-center rounded-xl bg-blue-600 text-lg font-bold text-white shadow-sm">S</div><span className="font-display text-lg font-bold tracking-tight text-white">Job Search</span></div>; }

function SignedOutScreen({ clientId, authError, authStatus, onCredential }) {
  return <div className="min-h-screen bg-slate-50 md:flex"><aside className="bg-slate-950 md:min-h-screen md:w-64 md:shrink-0"><Brand /></aside><main className="flex min-h-[calc(100vh-80px)] flex-1 items-start justify-center p-6 pt-10 md:min-h-screen md:justify-start md:p-12"><div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><h1 className="font-display text-xl font-bold text-slate-900">Acces securizat</h1><p className="mt-1 text-sm text-slate-500">Autentifica-te cu contul Google autorizat.</p><div className="mt-5 min-h-11">{clientId ? <GoogleSignIn clientId={clientId} onCredential={onCredential} disabled={authStatus === 'authenticating'} /> : <div className="h-11 animate-pulse rounded-lg bg-slate-100" />}</div>{authStatus === 'authenticating' && <p className="mt-3 text-sm text-slate-500">Se verifica sesiunea...</p>}{authError && <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{authError}</div>}</div></main></div>;
}

function SidebarBadge({ value, active }) { return <span className={cx('ml-auto min-w-6 rounded-full px-2 py-0.5 text-center text-xs font-semibold text-white', active ? 'bg-blue-500' : 'bg-slate-700')}>{value}</span>; }
function Sidebar({ view, onView, counts, runStatus }) {
  const items = [['jobs','Joburi noi','jobs',counts.jobs],['review','De evaluat','review',counts.review],['applications','Aplicari','applications',counts.applications],['criteria','Criterii de selectie','criteria',null],['sources','Surse','sources',null]];
  const statusTone = runStatus?.status === 'completed' ? 'bg-emerald-500' : runStatus?.status === 'running' ? 'bg-blue-500' : runStatus?.status === 'failed' ? 'bg-red-500' : 'bg-amber-500';
  const statusText = runStatus?.status === 'completed' ? 'Monitor activ' : runStatus?.status === 'running' ? 'Verificare in curs' : runStatus?.status === 'failed' ? 'Ultima rulare esuata' : runStatus?.status === 'completed_with_errors' ? 'Finalizat cu erori' : 'Monitor';
  return <aside className="flex w-full shrink-0 flex-col bg-slate-950 md:sticky md:top-0 md:h-screen md:w-64"><Brand /><nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-1 md:flex-col md:overflow-visible md:pt-3" aria-label="Navigare principala">{items.map(([key,label,icon,badge]) => { const active = view === key; return <button key={key} onClick={() => onView(key)} className={cx('flex min-w-max items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition md:w-full', active ? 'bg-slate-800 text-white' : 'text-slate-300 hover:bg-slate-900 hover:text-white')}><Icon name={icon} className="h-4 w-4"/><span>{label}</span>{badge !== null && <SidebarBadge value={badge} active={active}/>}</button>; })}</nav><div className="hidden border-t border-slate-800 p-4 md:block"><div className="flex items-start gap-3 rounded-xl bg-slate-900/70 p-3"><span className={cx('mt-1.5 h-2.5 w-2.5 rounded-full',statusTone,runStatus?.status === 'running' && 'animate-pulse')}/><div className="min-w-0"><div className="text-sm font-semibold text-slate-100">{statusText}</div><div className="mt-0.5 text-xs text-slate-500">{runStatus?.completed_at ? new Intl.DateTimeFormat('ro-RO',{dateStyle:'short',timeStyle:'short',timeZone:'Europe/Bucharest'}).format(new Date(runStatus.completed_at)) : 'Fara rulare recenta'}</div></div></div><div className="mt-3 px-1 text-xs text-slate-600">Versiunea 0.04</div></div></aside>;
}

function ProfileMenu({ email, onLogout }) {
  const [open,setOpen] = useState(false), ref = useRef(null); const initial = (email || 'G').slice(0,1).toUpperCase();
  useEffect(() => { const handler = event => { if (ref.current && !ref.current.contains(event.target)) setOpen(false); }; document.addEventListener('mousedown',handler); return () => document.removeEventListener('mousedown',handler); }, []);
  return <div className="relative" ref={ref}><button onClick={() => setOpen(v => !v)} className="flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-2.5 text-sm text-slate-700 shadow-sm transition hover:bg-slate-50" aria-expanded={open}><span className="grid h-7 w-7 place-items-center rounded-full bg-slate-100 text-xs font-bold text-slate-700">{initial}</span><span className="hidden max-w-36 truncate lg:block">{email || 'Google conectat'}</span><Icon name="chevronDown" className="h-4 w-4 text-slate-400"/></button>{open && <div className="absolute right-0 z-50 mt-2 w-64 rounded-xl border border-slate-200 bg-white p-2 shadow-lg"><div className="px-3 py-2"><div className="text-xs font-medium uppercase tracking-wide text-slate-400">Cont conectat</div><div className="mt-1 truncate text-sm font-medium text-slate-800">{email || 'Google'}</div></div><div className="my-1 border-t border-slate-100"/><button onClick={onLogout} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-600 hover:bg-slate-50 hover:text-slate-900"><Icon name="logout" className="h-4 w-4"/> Deconecteaza</button></div>}</div>;
}

function Header({ view, email, running, onRun, onLogout }) {
  const titles = { jobs:'Joburi noi',review:'De evaluat',applications:'Aplicari',criteria:'Criterii de selectie',sources:'Surse' };
  const date = new Intl.DateTimeFormat('ro-RO',{weekday:'long',day:'numeric',month:'long',timeZone:'Europe/Bucharest'}).format(new Date()).toUpperCase();
  return <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><div className="text-xs font-semibold tracking-[0.16em] text-slate-400">{date}</div><h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-slate-950">{titles[view]}</h1></div><div className="flex items-center gap-2">{view !== 'criteria' && <button onClick={onRun} disabled={running} className="inline-flex h-10 items-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"><Icon name="refresh" className={cx('h-4 w-4',running && 'animate-spin')}/>{running ? 'Verificare in curs...' : 'Ruleaza verificarea'}</button>}<ProfileMenu email={email} onLogout={onLogout}/></div></header>;
}

function MetricCard({ value,label,note,icon,tone='blue' }) { const tones={blue:'bg-blue-50 text-blue-600',amber:'bg-amber-50 text-amber-600',violet:'bg-violet-50 text-violet-600',slate:'bg-slate-100 text-slate-600'}; return <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-start gap-3"><span className={cx('grid h-9 w-9 place-items-center rounded-xl',tones[tone])}><Icon name={icon} className="h-4 w-4"/></span><div><div className="text-2xl font-bold leading-none text-slate-950">{value}</div><div className="mt-1 text-sm text-slate-600">{label}</div><div className="mt-1 text-xs text-slate-400">{note}</div></div></div></div>; }
function KPIGrid({ metrics,freshness }) { return <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Rezumat"><MetricCard value={metrics.jobs} label="roluri noi" note={freshness===120?'ultimele 5 zile':`ultimele ${freshness}h`} icon="jobs" tone="blue"/><MetricCard value={metrics.high} label="fit ridicat" note={`>= ${metrics.threshold}%`} icon="review" tone="slate"/><MetricCard value={metrics.reposts} label="repostari" note="marcate, nu ascunse" icon="refresh" tone="amber"/><MetricCard value={metrics.remote} label="remote" note="eligibile din Romania" icon="sources" tone="violet"/></section>; }

function FilterButton({ active,onClick,children,count }) { return <button onClick={onClick} className={cx('inline-flex h-9 items-center gap-2 rounded-full border px-3 text-sm font-medium transition',active?'border-blue-200 bg-blue-50 text-blue-700':'border-slate-200 bg-white text-slate-600 hover:bg-slate-50')}>{children}{count!==undefined && <span className={cx('rounded-full px-1.5 py-0.5 text-[11px] font-semibold',active?'bg-blue-100 text-blue-700':'bg-slate-100 text-slate-500')}>{count}</span>}</button>; }
function WorkModeDropdown({ selected,onChange }) {
  const [open,setOpen]=useState(false),ref=useRef(null); useEffect(()=>{const h=e=>{if(ref.current&&!ref.current.contains(e.target))setOpen(false)};document.addEventListener('mousedown',h);return()=>document.removeEventListener('mousedown',h)},[]);
  const label=selected.length===ALL_WORK_MODES.length?'Toate':selected.length===0?'Niciunul':selected.join(', '); const toggle=mode=>onChange(selected.includes(mode)?selected.filter(x=>x!==mode):[...selected,mode]);
  return <div className="relative" ref={ref}><button onClick={()=>setOpen(v=>!v)} className="inline-flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-600 hover:bg-slate-50">Mod lucru: <span className="max-w-36 truncate text-slate-800">{label}</span><Icon name="chevronDown" className="h-4 w-4 text-slate-400"/></button>{open&&<div className="absolute left-0 z-40 mt-2 w-48 rounded-xl border border-slate-200 bg-white p-2 shadow-lg">{ALL_WORK_MODES.map(mode=><label key={mode} className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-slate-700 hover:bg-slate-50"><input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" checked={selected.includes(mode)} onChange={()=>toggle(mode)}/>{mode==='Hybrid'?'Hibrid':mode}</label>)}</div>}</div>;
}
function Filters({ filters,setFilters,counts,defaultFreshness }) {
  const reset=()=>setFilters({search:'',quick:'all',freshness:defaultFreshness||24,workModes:[...ALL_WORK_MODES],sort:'fit-desc'});
  return <div className="rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-100 p-4"><label className="relative block"><Icon name="search" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"/><input value={filters.search} onChange={e=>setFilters(v=>({...v,search:e.target.value}))} type="search" placeholder="Cauta rol, companie sau tehnologie" className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-4 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:bg-white focus:ring-4 focus:ring-blue-50"/></label></div><div className="flex flex-wrap items-center gap-2 p-4"><FilterButton active={filters.quick==='all'} onClick={()=>setFilters(v=>({...v,quick:'all'}))} count={counts.all}>Toate</FilterButton><FilterButton active={filters.quick==='high'} onClick={()=>setFilters(v=>({...v,quick:'high'}))} count={counts.high}>Fit ridicat</FilterButton><FilterButton active={filters.quick==='b2b'} onClick={()=>setFilters(v=>({...v,quick:'b2b'}))} count={counts.b2b}>B2B</FilterButton><select value={filters.freshness} onChange={e=>setFilters(v=>({...v,freshness:Number(e.target.value)}))} className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-600 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-50" aria-label="Vechimea joburilor"><option value={24}>24h</option><option value={36}>36h</option><option value={48}>48h</option><option value={120}>5 zile</option></select><WorkModeDropdown selected={filters.workModes} onChange={workModes=>setFilters(v=>({...v,workModes}))}/><select value={filters.sort} onChange={e=>setFilters(v=>({...v,sort:e.target.value}))} className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-600 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-50"><option value="fit-desc">FIT descrescator</option><option value="fit-asc">FIT crescator</option></select><button onClick={reset} className="ml-auto inline-flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-600 hover:bg-slate-50"><Icon name="reset" className="h-4 w-4"/> Reseteaza filtrele</button></div></div>;
}

function FitBadge({ fit,threshold }) { if(fit===null||fit===undefined)return <span className="text-sm text-slate-400">—</span>; return <span className={cx('inline-flex min-w-12 justify-center rounded-full px-2 py-1 text-xs font-semibold',fit>=threshold?'bg-blue-50 text-blue-700':'bg-slate-100 text-slate-600')}>{fit}%</span>; }
function ModeBadge({ mode }) { const tone=mode==='Remote'?'bg-violet-50 text-violet-700':mode==='Hybrid'?'bg-amber-50 text-amber-700':'bg-slate-100 text-slate-600'; return <span className={cx('inline-flex rounded-full px-2 py-1 text-xs font-medium',tone)}>{mode==='Hybrid'?'Hibrid':mode}</span>; }
function JobTable({ rows,threshold,onDetails,onArchive }) {
  if(!rows.length)return <div className="rounded-2xl border border-slate-200 bg-white px-6 py-14 text-center text-sm text-slate-500 shadow-sm">Niciun rol nu corespunde filtrelor.</div>;
  return <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="hidden grid-cols-[minmax(0,1fr)_90px_120px_110px_116px] gap-4 border-b border-slate-100 bg-slate-50/70 px-5 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400 md:grid"><span>Rol</span><span>Fit</span><span>Mod de lucru</span><span>Publicat</span><span className="text-right">Actiuni</span></div><div className="divide-y divide-slate-100">{rows.map(job=><div key={jobKey(job)} onClick={()=>onDetails(job)} className="group grid cursor-pointer gap-3 px-4 py-3 transition hover:bg-slate-50 md:grid-cols-[minmax(0,1fr)_90px_120px_110px_116px] md:items-center md:gap-4 md:px-5"><div className="flex min-w-0 items-start gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-slate-100 text-xs font-bold text-slate-600">{job.initial}</span><div className="min-w-0"><div className="truncate text-sm font-semibold text-slate-900">{job.title}</div><div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500"><span className="truncate">{job.company} · {job.location}</span>{job.repost&&<span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-amber-700">Repostare</span>}{job.type&&<span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-slate-500">{job.type}</span>}</div></div></div><div><FitBadge fit={job.fit} threshold={threshold}/></div><div><ModeBadge mode={job.mode}/></div><div className="text-xs font-medium text-slate-500">{publishedLabel(job)}</div><div className="flex items-center justify-end gap-1 opacity-100 transition md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100" onClick={e=>e.stopPropagation()}><button onClick={()=>onArchive(job)} title="Arhiveaza" className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"><Icon name="archive" className="h-4 w-4"/></button>{job.url&&<a href={job.url} target="_blank" rel="noopener noreferrer" title="Aplica" className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"><Icon name="external" className="h-4 w-4"/></a>}<button onClick={()=>onDetails(job)} title="Vezi detalii" className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"><Icon name="eye" className="h-4 w-4"/></button></div></div>)}</div></div>;
}

function ErrorPanel({ error,onRetry }) { return <div className="rounded-2xl border border-red-200 bg-white p-6 shadow-sm"><div className="flex items-start gap-4"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-red-50 text-red-600"><Icon name="alert" className="h-5 w-5"/></span><div className="min-w-0 flex-1"><h2 className="font-display text-base font-bold text-slate-900">Datele nu au putut fi incarcate</h2><p className="mt-1 break-words text-sm text-slate-600">Autentificarea Google este valida, dar accesul la date a esuat: {error?.message||'eroare necunoscuta'}.</p><button onClick={onRetry} className="mt-4 inline-flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"><Icon name="retry" className="h-4 w-4"/> Reincearca incarcarea</button></div></div></div>; }
function LoadingPanel(){return <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><div className="flex items-center gap-3 text-sm text-slate-500"><span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-blue-600"/> Se incarca datele protejate...</div></div>;}

function DetailDrawer({ job,threshold,onClose }) { if(!job)return null; return <><button className="fixed inset-0 z-50 bg-slate-950/25" onClick={onClose} aria-label="Inchide detaliile"/><aside className="fixed inset-y-0 right-0 z-[60] w-full max-w-xl overflow-y-auto border-l border-slate-200 bg-white shadow-2xl"><div className="sticky top-0 flex items-center justify-between border-b border-slate-100 bg-white/95 px-6 py-4 backdrop-blur"><div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Evaluare rapida</div><button onClick={onClose} className="grid h-9 w-9 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"><Icon name="close" className="h-5 w-5"/></button></div><div className="space-y-6 p-6"><div><h2 className="font-display text-2xl font-bold text-slate-950">{job.title}</h2><p className="mt-1 text-sm text-slate-500">{job.company} · {job.location} · {job.source}</p></div><div className="flex items-center gap-3"><FitBadge fit={job.fit} threshold={threshold}/><ModeBadge mode={job.mode}/></div><section><h3 className="text-sm font-semibold text-slate-900">De ce se potriveste</h3><ul className="mt-2 space-y-2 text-sm text-slate-600">{(job.pros.length?job.pros:['Nu exista argumente generate.']).map((x,i)=><li key={i} className="flex gap-2"><span className="mt-1 text-slate-400">•</span><span>{x}</span></li>)}</ul></section><section><h3 className="text-sm font-semibold text-slate-900">Riscuri</h3><ul className="mt-2 space-y-2 text-sm text-slate-600">{(job.risks.length?job.risks:['Nu exista riscuri generate.']).map((x,i)=><li key={i} className="flex gap-2"><span className="mt-1 text-amber-500">•</span><span>{x}</span></li>)}</ul></section><section><h3 className="text-sm font-semibold text-slate-900">Descrierea pozitiei</h3><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-600">{job.description||'Descrierea pozitiei nu este disponibila din sursa.'}</p></section>{job.url&&<a href={job.url} target="_blank" rel="noopener noreferrer" className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50">Deschide jobul <Icon name="external" className="h-4 w-4"/></a>}</div></aside></>; }

function CriteriaCard({ title,note,children,className }) { return <section className={cx('rounded-2xl border border-slate-200 bg-white p-5 shadow-sm',className)}><h2 className="font-display text-base font-bold text-slate-900">{title}</h2>{note&&<p className="mt-1 text-sm text-slate-500">{note}</p>}<div className="mt-4 space-y-3">{children}</div></section>; }
function CheckRow({ checked,onChange,children,disabled=false }) { return <label className={cx('flex items-start gap-3 text-sm text-slate-700',disabled?'cursor-not-allowed opacity-60':'cursor-pointer')}><input type="checkbox" checked={checked} onChange={e=>onChange(e.target.checked)} disabled={disabled} className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"/><span>{children}</span></label>; }
function CriteriaPage({ draft,setDraft,saved,onSave,saving }) {
  const dirty=JSON.stringify(draft)!==JSON.stringify(saved),update=(key,value)=>setDraft(v=>({...v,[key]:value}));
  const addExclusion=value=>{if(value&&!draft.exclusions.includes(value))update('exclusions',[...draft.exclusions,value])},removeExclusion=value=>update('exclusions',draft.exclusions.filter(x=>x!==value));
  return <div className="space-y-5"><div className="grid grid-cols-1 gap-6 md:grid-cols-2"><CriteriaCard title="Roluri urmarite"><CheckRow checked={draft.rolePm} onChange={v=>update('rolePm',v)}>Project Manager / IT Project Manager</CheckRow><CheckRow checked={draft.roleDelivery} onChange={v=>update('roleDelivery',v)}>Delivery / Technical Project Manager</CheckRow><CheckRow checked={draft.roleService} onChange={v=>update('roleService',v)}>Service Manager</CheckRow><CheckRow checked={draft.roleScrum} onChange={v=>update('roleScrum',v)}>Scrum Master, fara nivel excesiv de senior</CheckRow><CheckRow checked={draft.roleProgram} onChange={v=>update('roleProgram',v)}>Program / PMO Manager</CheckRow></CriteriaCard><CriteriaCard title="Mod de lucru" note="Ordinea ramane Remote, Hibrid, apoi celelalte rezultate eligibile."><CheckRow checked={draft.workRemote} onChange={v=>update('workRemote',v)}>Remote</CheckRow><CheckRow checked={draft.workHybrid} onChange={v=>update('workHybrid',v)}>Hibrid</CheckRow></CriteriaCard><CriteriaCard title="Praguri de selectie"><label className="block text-sm text-slate-700">Vechimea implicita<select value={draft.freshness} onChange={e=>update('freshness',Number(e.target.value))} className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-50"><option value={24}>24 ore</option><option value={36}>36 ore</option><option value={48}>48 ore</option><option value={120}>5 zile</option></select></label><label className="block text-sm text-slate-700">Scor minim pentru fit ridicat<div className="mt-1.5 flex items-center gap-2"><input type="number" min="50" max="100" value={draft.fitThreshold} onChange={e=>update('fitThreshold',Number(e.target.value))} className="h-10 w-28 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-50"/><span className="text-slate-400">%</span></div></label><CheckRow checked={draft.keepReposts} onChange={v=>update('keepReposts',v)}>Pastreaza si marcheaza repostarile</CheckRow></CriteriaCard><CriteriaCard title="Contract si disponibilitate"><label className="block text-sm text-slate-700">Interval B2B zilnic<div className="mt-1.5 flex items-center gap-2"><input type="number" value={draft.rateMin} onChange={e=>update('rateMin',Number(e.target.value))} className="h-10 w-28 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-50"/><span className="text-slate-400">—</span><input type="number" value={draft.rateMax} onChange={e=>update('rateMax',Number(e.target.value))} className="h-10 w-28 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-50"/><span className="text-slate-400">EUR/zi</span></div></label><CheckRow checked={draft.immediateStart} onChange={v=>update('immediateStart',v)}>Prioritizeaza disponibilitatea imediata</CheckRow></CriteriaCard><CriteriaCard title="JobsPipe" note="Alege transportul. In perioada de stabilizare modul ramane Oprit."><label className="block text-sm text-slate-700">Transport<select value={draft.jobspipeMode} onChange={e=>update('jobspipeMode',e.target.value)} className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-50"><option value="disabled">Oprit</option><option value="apify">Apify - recomandat pentru volum</option><option value="direct">JobsPipe Direct - fallback</option></select></label>{draft.jobspipeMode==='apify'&&<><label className="block text-sm text-slate-700">Maximum joburi brute / rulare<input type="number" min="100" max="20000" step="100" value={draft.jobspipeApifyMaxItems} onChange={e=>update('jobspipeApifyMaxItems',Number(e.target.value))} className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-50"/></label><div className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">Actorul JobsPipe din Apify pagineaza automat. Plafonul implicit este 5.000 pentru stabilizare si poate fi marit dupa masurarea costului si duratei. Necesita secretul GitHub Actions <code>APIFY_TOKEN</code>.</div></>}{draft.jobspipeMode==='direct'&&<><label className="block text-sm text-slate-700">Buget credite / rulare<input type="number" min="1" max="1000" value={draft.jobspipeDirectRunBudget} onChange={e=>update('jobspipeDirectRunBudget',Number(e.target.value))} className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-50"/></label><label className="block text-sm text-slate-700">Prag lunar local<input type="number" min="1" max="100000" value={draft.jobspipeDirectMonthlyGuard} onChange={e=>update('jobspipeDirectMonthlyGuard',Number(e.target.value))} className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-50"/></label><div className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">Modul Direct pastreaza preview-ul, polling-ul incremental, cursorul si circuit breaker-ul de quota. Necesita <code>JOBSPIPE_API_KEY</code>.</div></>}{draft.jobspipeMode==='disabled'&&<div className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">Nu se executa nicio cerere JobsPipe sau Apify. Rezultatele existente sunt pastrate.</div>}</CriteriaCard><CriteriaCard title="Excluderi" className="md:col-span-2"><select defaultValue="" onChange={e=>{addExclusion(e.target.value);e.target.value='';}} className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-50"><option value="">Selecteaza o propunere de excludere</option>{EXCLUSION_SUGGESTIONS.map(x=><option key={x}>{x}</option>)}</select><div className="flex flex-wrap gap-2 pt-1">{draft.exclusions.length?draft.exclusions.map(x=><button key={x} onClick={()=>removeExclusion(x)} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-200">{x}<Icon name="close" className="h-3 w-3"/></button>):<span className="text-sm text-slate-400">Nicio excludere selectata.</span>}</div></CriteriaCard></div><div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm"><span className={cx('text-sm font-medium',dirty?'text-amber-600':'text-slate-500')}>{dirty?'Modificari nesalvate':'Preferinte salvate'}</span><button onClick={onSave} disabled={!dirty||saving} className="h-10 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">{saving?'Se salveaza...':'Salveaza preferintele'}</button></div></div>;
}

function SourcesPage({ sources,setSources,notify }) {
  const [query,setQuery]=useState(''),[sort,setSort]=useState('name');
  const rows=useMemo(()=>{const q=query.toLowerCase();return sources.filter(s=>`${s.name} ${s.category}`.toLowerCase().includes(q)).sort((a,b)=>sort==='status'?Number(b.active)-Number(a.active)||a.name.localeCompare(b.name):a.name.localeCompare(b.name));},[sources,query,sort]);
  const groups=useMemo(()=>rows.reduce((acc,source)=>{(acc[source.category]||=[]).push(source);return acc;},{}),[rows]);
  const toggle=source=>{const next=sources.map(s=>s.url===source.url?{...s,active:!s.active}:s);setSources(next);localStorage.setItem('sourceState',JSON.stringify(Object.fromEntries(next.map(s=>[s.url,s.active]))));notify('Starea sursei a fost salvata local.','info');};
  return <div className="space-y-4"><div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex flex-col gap-3 sm:flex-row"><label className="relative flex-1"><Icon name="search" className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Cauta o sursa" className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-3 text-sm outline-none focus:border-blue-400 focus:bg-white focus:ring-4 focus:ring-blue-50"/></label><select value={sort} onChange={e=>setSort(e.target.value)} className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-600 outline-none"><option value="name">Nume A-Z</option><option value="status">Surse active primele</option></select></div></div>{Object.entries(groups).map(([category,items])=><section key={category} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="flex items-center justify-between border-b border-slate-100 px-5 py-3"><h2 className="font-display text-sm font-bold text-slate-900">{category}</h2><span className="text-xs text-slate-400">{items.length} surse</span></div><div className="divide-y divide-slate-100">{items.map(source=><div key={source.url} className="flex items-center justify-between gap-4 px-5 py-3"><a href={source.url} target="_blank" rel="noopener noreferrer" className="min-w-0 truncate text-sm font-medium text-slate-700 hover:text-slate-950">{source.name} <span className="text-slate-400">↗</span></a><button onClick={()=>toggle(source)} className={cx('inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-medium',source.active?'bg-emerald-50 text-emerald-700':'bg-slate-100 text-slate-500')}><span className={cx('h-2 w-2 rounded-full',source.active?'bg-emerald-500':'bg-slate-400')}/>{source.active?'Activa':'Inactiva'}</button></div>)}</div></section>)}{!rows.length&&<div className="rounded-2xl border border-slate-200 bg-white py-12 text-center text-sm text-slate-500 shadow-sm">Nicio sursa gasita.</div>}</div>;
}

function App() {
  const [clientId,setClientId]=useState(null),[auth,setAuth]=useState({status:'signed-out',token:null,email:null,error:null}),[dataState,setDataState]=useState({status:'idle',error:null});
  const [jobs,setJobs]=useState([]),[applications,setApplications]=useState([]),[sources,setSources]=useState([]),[runStatus,setRunStatus]=useState(null),[canonicalConfig,setCanonicalConfig]=useState(null);
  const [savedCriteria,setSavedCriteria]=useState(criteriaFromConfig({})),[draftCriteria,setDraftCriteria]=useState(criteriaFromConfig({})),[view,setView]=useState('jobs');
  const [filters,setFilters]=useState({search:'',quick:'all',freshness:24,workModes:[...ALL_WORK_MODES],sort:'fit-desc'}),[detailJob,setDetailJob]=useState(null),[running,setRunning]=useState(false),[saving,setSaving]=useState(false),[toast,setToast]=useState(null);
  const [archivedKeys,setArchivedKeys]=useState(()=>{try{return JSON.parse(localStorage.getItem('archivedJobKeys')||'[]')}catch{return[]}});
  const notify=useCallback((message,type='info')=>{const id=Date.now();setToast({id,message,type});window.setTimeout(()=>setToast(current=>current?.id===id?null:current),3500);},[]);
  useEffect(()=>{commandApi('/auth/config',null).then(config=>{if(!config?.configured||!config?.client_id)throw new Error('Autentificarea Google nu este configurata complet.');setClientId(config.client_id);}).catch(error=>setAuth(current=>({...current,error:error.message})));},[]);
  const clearData=useCallback(()=>{setJobs([]);setApplications([]);setSources([]);setRunStatus(null);setCanonicalConfig(null);},[]);
  const loadData=useCallback(async token=>{setDataState({status:'loading',error:null});clearData();try{const [jobPayload,statusPayload,applicationPayload,sourcePayload,configPayload]=await Promise.all([fetchJson('/data/jobs.json',token),fetchJson('/data/run-status.json',token),fetchJson('/data/applications.json',token),fetchJson('/data/sources.json',token),fetchJson('/data/search-config.json',token)]);validateContract(jobPayload,'jobs.json');validateContract(statusPayload,'run-status.json');validateContract(configPayload,'search-config.json');const criteria=criteriaFromConfig(configPayload);const localSources=(()=>{try{return JSON.parse(localStorage.getItem('sourceState')||'null')}catch{return null}})();setJobs((jobPayload.jobs||[]).map(normalizeJob));setApplications((applicationPayload.applications||[]).map(normalizeApplication));setSources((sourcePayload.sources||[]).map(source=>({category:source.category||'Altele',name:source.name||'Sursa',url:source.url||'#',active:localSources&&Object.hasOwn(localSources,source.url)?Boolean(localSources[source.url]):source.active!==false})));setRunStatus(statusPayload);setCanonicalConfig(configPayload);setSavedCriteria(criteria);setDraftCriteria(criteria);setFilters(current=>({...current,freshness:criteria.freshness||24}));setDataState({status:'ready',error:null});}catch(error){setDataState({status:'error',error});throw error;}},[clearData]);
  const handleCredential=useCallback(async credential=>{setAuth({status:'authenticating',token:null,email:null,error:null});try{const session=await commandApi('/auth/session',credential,{method:'POST'});setAuth({status:'authenticated',token:credential,email:session?.email||null,error:null});try{await loadData(credential);notify('Autentificare Google reusita.','success');}catch(error){notify(`Autentificarea a reusit, dar datele nu s-au incarcat: ${error.message}`,'error');}}catch(error){const message=error.status===403?'Contul Google nu este autorizat pentru aceasta aplicatie.':`Autentificare esuata: ${error.message}`;setAuth({status:'signed-out',token:null,email:null,error:message});}},[loadData,notify]);
  const logout=useCallback(()=>{try{window.google?.accounts?.id?.disableAutoSelect();}catch{}setAuth({status:'signed-out',token:null,email:null,error:null});setDataState({status:'idle',error:null});clearData();setDetailJob(null);notify('Contul Google a fost deconectat din aceasta sesiune.','info');},[clearData,notify]);
  const retryData=useCallback(()=>{if(auth.token)loadData(auth.token).then(()=>notify('Datele au fost reincarcate.','success')).catch(error=>notify(`Incarcarea a esuat: ${error.message}`,'error'));},[auth.token,loadData,notify]);
  const activeJobs=useMemo(()=>jobs.filter(job=>!archivedKeys.includes(jobKey(job))),[jobs,archivedKeys]);
  const baseRows=useMemo(()=>view==='applications'?applications:view==='review'?activeJobs.filter(job=>job.status==='review'):activeJobs,[view,applications,activeJobs]);
  const threshold=savedCriteria.fitThreshold||80;
  const modeFreshRows=useMemo(()=>view==='applications'?baseRows:baseRows.filter(job=>ageHours(job.date_posted,job.age)<=filters.freshness&&filters.workModes.includes(job.mode)),[view,baseRows,filters.freshness,filters.workModes]);
  const filteredRows=useMemo(()=>{if(view==='applications')return[...baseRows];const q=filters.search.trim().toLowerCase();let rows=modeFreshRows.filter(job=>{const quick=filters.quick==='all'||(filters.quick==='high'&&job.fit!==null&&job.fit>=threshold)||(filters.quick==='b2b'&&job.b2b);const text=`${job.title} ${job.company} ${job.description} ${job.source} ${job.location}`.toLowerCase();return quick&&(!q||text.includes(q));});return[...rows].sort(filters.sort==='fit-asc'?(a,b)=>(a.fit??Number.MAX_SAFE_INTEGER)-(b.fit??Number.MAX_SAFE_INTEGER)||a.age-b.age:(a,b)=>(b.fit??-1)-(a.fit??-1)||a.age-b.age);},[view,baseRows,modeFreshRows,filters.quick,filters.search,filters.sort,threshold]);
  const quickCounts=useMemo(()=>({all:modeFreshRows.length,high:modeFreshRows.filter(j=>j.fit!==null&&j.fit>=threshold).length,b2b:modeFreshRows.filter(j=>j.b2b).length}),[modeFreshRows,threshold]);
  const dashboardJobs=useMemo(()=>activeJobs.filter(job=>ageHours(job.date_posted,job.age)<=filters.freshness&&filters.workModes.includes(job.mode)),[activeJobs,filters.freshness,filters.workModes]);
  const metrics=useMemo(()=>({jobs:dashboardJobs.length,high:dashboardJobs.filter(j=>j.fit>=threshold).length,reposts:dashboardJobs.filter(j=>j.repost).length,remote:dashboardJobs.filter(j=>j.mode==='Remote').length,threshold}),[dashboardJobs,threshold]);
  const counts=useMemo(()=>({jobs:activeJobs.length,review:activeJobs.filter(j=>j.status==='review').length,applications:applications.length}),[activeJobs,applications]);
  const archiveJob=job=>{const next=[...new Set([...archivedKeys,jobKey(job)])];setArchivedKeys(next);localStorage.setItem('archivedJobKeys',JSON.stringify(next));notify('Job arhivat local.','info');};
  const pollRun=useCallback(async(previousRunId,previousCompletedAt)=>{for(let attempt=0;attempt<60;attempt+=1){await new Promise(resolve=>setTimeout(resolve,5000));try{const status=await fetchJson(`/data/run-status.json?t=${Date.now()}`,auth.token);if(status.run_id===previousRunId&&status.completed_at===previousCompletedAt)continue;await loadData(auth.token);notify(status.status==='failed'?'Verificarea s-a terminat cu eroare.':`Verificare finalizata: ${status.jobs_published??0} joburi publicate.`,status.status==='failed'?'error':'success');return;}catch{}}notify('Verificarea a fost pornita, dar rezultatul nu a fost publicat inca.','info');},[auth.token,loadData,notify]);
  const runSearch=useCallback(async()=>{if(!auth.token||running)return;setRunning(true);const previousRunId=runStatus?.run_id||null,previousCompletedAt=runStatus?.completed_at||null;try{await commandApi('/commands/run',auth.token,{method:'POST'});notify('Verificarea a fost pornita in GitHub Actions.','info');await pollRun(previousRunId,previousCompletedAt);}catch(error){if(error.status===409){notify('Exista deja o verificare in curs.','info');await pollRun(previousRunId,previousCompletedAt);}else notify(`Nu am putut porni verificarea: ${error.message}`,'error');}finally{setRunning(false);}},[auth.token,running,runStatus,notify,pollRun]);
  const saveCriteria=useCallback(async()=>{if(!auth.token||saving)return;setSaving(true);try{await commandApi('/config',auth.token,{method:'PUT',body:JSON.stringify(draftCriteria)});setSavedCriteria(draftCriteria);setCanonicalConfig(current=>current?{...current,freshness_hours:draftCriteria.freshness,fit_threshold:draftCriteria.fitThreshold,jobspipe_mode:draftCriteria.jobspipeMode,jobspipe_apify_max_items_per_run:draftCriteria.jobspipeApifyMaxItems,jobspipe_credit_budget_per_run:draftCriteria.jobspipeDirectRunBudget,jobspipe_monthly_credit_guard:draftCriteria.jobspipeDirectMonthlyGuard}:current);setFilters(current=>({...current,freshness:draftCriteria.freshness}));notify('Preferintele au fost salvate. O noua verificare va porni automat.','success');}catch(error){notify(`Preferintele nu au putut fi salvate: ${error.message}`,'error');}finally{setSaving(false);}},[auth.token,saving,draftCriteria,notify]);
  if(auth.status!=='authenticated')return <><SignedOutScreen clientId={clientId} authError={auth.error} authStatus={auth.status} onCredential={handleCredential}/><Toast toast={toast}/></>;
  return <div className="min-h-screen bg-slate-50 md:flex"><Sidebar view={view} onView={setView} counts={counts} runStatus={runStatus}/><main className="min-w-0 flex-1"><div className="mx-auto w-full max-w-[1400px] space-y-5 px-4 py-5 sm:px-6 lg:px-8 lg:py-7"><Header view={view} email={auth.email} running={running} onRun={runSearch} onLogout={logout}/>{dataState.status==='loading'&&<LoadingPanel/>}{dataState.status==='error'&&<ErrorPanel error={dataState.error} onRetry={retryData}/>} {dataState.status==='ready'&&<>{view==='jobs'&&<KPIGrid metrics={metrics} freshness={filters.freshness}/>} {(view==='jobs'||view==='review')&&<Filters filters={filters} setFilters={setFilters} counts={quickCounts} defaultFreshness={savedCriteria.freshness}/>} {(view==='jobs'||view==='review'||view==='applications')&&<JobTable rows={filteredRows} threshold={threshold} onDetails={setDetailJob} onArchive={archiveJob}/>} {view==='criteria'&&<CriteriaPage draft={draftCriteria} setDraft={setDraftCriteria} saved={savedCriteria} onSave={saveCriteria} saving={saving}/>} {view==='sources'&&<SourcesPage sources={sources} setSources={setSources} notify={notify}/>}</>}</div></main><DetailDrawer job={detailJob} threshold={threshold} onClose={()=>setDetailJob(null)}/><Toast toast={toast}/></div>;
}

createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>);
