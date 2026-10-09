import { sourceCollectionMethod } from '../../shared/source-connectors.mjs';
import { ROLE_FAMILIES } from '../../shared/role-taxonomy-runtime.mjs';
import { selectRoleFamily } from './role-family-selection.mjs';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import AdminShell from './admin-shell.jsx';
import ActionDialog from './action-dialog.jsx';
import { PromotionStatusPanel } from './promotion-status.jsx';
import { CONTRACT_TYPE_OPTIONS, COUNTRY_NAMES, COUNTRY_OPTIONS, REGION_COUNTRIES, REGION_OPTIONS, WORK_MODE_OPTIONS, normalizedCountryNames } from './nomenclature-runtime.mjs';
import './index.css';
import { completionNotice, isActiveRunStatus, pollingDelayMs, terminalForBaseline } from './run-polling.mjs';
import { runProgressModel } from './run-progress.mjs';
import { buildJobsPath, isSearchProfileConfigured, mergeJobPages, refreshOutcomeNotice, validateJobsPage } from './job-page-model.mjs';
import { readUiState, writeUiState } from './ui-state.mjs';
import { registerPwa } from './pwa.mjs';
import { COOKIE_SESSION_BEARER, googleIdentityOptions, readGoogleLoginHint, rememberGoogleLoginHint } from './auth-session.mjs';
import { environmentBadge, releaseVersionLabel } from './environment-marker.mjs';
import { reviewRowsForFilters } from './review-selection.mjs';
import { jobCountScopeLabel, jobViewCounts, jobViewPopulation } from './job-count-model.mjs';

const DATA_SCHEMA = '1.0';
const APP_VERSION = releaseVersionLabel(__APP_VERSION__);
const modeDisplayValue = code => code === 'hybrid' ? 'Hybrid' : code === 'remote' ? 'Remote' : code === 'onsite' ? 'Onsite' : code;
const ALL_WORK_MODES = WORK_MODE_OPTIONS.map(([code]) => modeDisplayValue(code));
const ALL_CONTRACT_TYPES = CONTRACT_TYPE_OPTIONS.map(([code]) => code);
const EXCLUSION_SUGGESTIONS = [];

const cx = (...classes) => classes.filter(Boolean).join(' ');

function Icon({ name, className='h-4 w-4' }) {
  const common = { className, viewBox:'0 0 24 24', fill:'none', stroke:'currentColor', strokeWidth:1.8, strokeLinecap:'round', strokeLinejoin:'round', 'aria-hidden':true };
  const paths = {
    search:<><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></>,
    refresh:<><path d="M20 6v5h-5"/><path d="M4 18v-5h5"/><path d="M18.5 9a7 7 0 0 0-12-2.5L4 11"/><path d="M5.5 15A7 7 0 0 0 18 17.5L20 13"/></>,
    jobs:<><rect x="4" y="7" width="16" height="12" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/><path d="M4 12h16"/></>,
    review:<><circle cx="12" cy="12" r="9"/><path d="M9 12l2 2 4-4"/></>,
    applications:<><path d="M5 4h14v16H5z"/><path d="M8 8h8M8 12h8M8 16h5"/></>,
    criteria:<><path d="M4 6h16M7 12h10M9 18h6"/><circle cx="8" cy="6" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="12" cy="18" r="1.6"/></>,
    admin:<><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21h-4v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H3v-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6V3h4v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.1v4H21a1.7 1.7 0 0 0-1.6 1Z"/></>,
    chevronDown:<path d="m7 10 5 5 5-5"/>,
    external:<><path d="M14 5h5v5"/><path d="m10 14 9-9"/><path d="M19 13v6H5V5h6"/></>,
    archive:<><path d="M4 7h16"/><path d="M6 7v12h12V7"/><path d="M9 11h6"/><path d="M5 4h14v3H5z"/></>,
    eye:<><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.5"/></>,
    reset:<><path d="M4 4v6h6"/><path d="M5.5 14A7 7 0 1 0 7 7l-3 3"/></>,
    logout:<><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/><path d="M15 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/></>,
    trash:<><path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M7 7l1 13h8l1-13"/><path d="M10 11v5M14 11v5"/></>,
    retry:<><path d="M20 6v5h-5"/><path d="M18.5 9a7 7 0 1 0 .5 7"/></>,
    close:<><path d="m6 6 12 12M18 6 6 18"/></>,
    alert:<><path d="M12 3 2.5 20h19L12 3Z"/><path d="M12 9v4M12 17h.01"/></>,
    globe:<><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/></>,
  };
  return <svg {...common}>{paths[name] || paths.jobs}</svg>;
}

function validateContract(payload,name) {
  if (payload?.schema_version !== DATA_SCHEMA) throw new Error(`${name}: versiune contract ${payload?.schema_version || 'lipsa'}; asteptat ${DATA_SCHEMA}`);
}

async function fetchJson(path,token) {
  const bearer = token && token !== COOKIE_SESSION_BEARER ? { Authorization:`Bearer ${token}` } : {};
  const response = await fetch(path,{ headers:bearer, cache:'no-store', credentials:'same-origin' });
  let payload=null; try { payload=await response.json(); } catch { payload=null; }
  if (!response.ok) { const error=new Error(payload?.error || `${path}: HTTP ${response.status}`); error.status=response.status; throw error; }
  return payload;
}

async function commandApi(path,token,options={}) {
  const headers={...(options.headers||{})};
  if(token && token !== COOKIE_SESSION_BEARER) headers.Authorization=`Bearer ${token}`;
  if(options.body&&!headers['Content-Type']) headers['Content-Type']='application/json';
  const response=await fetch(path,{...options,headers,cache:'no-store',credentials:'same-origin'});
  let payload=null; try{payload=await response.json();}catch{payload=null;}
  if(!response.ok){const error=new Error(payload?.error||`HTTP ${response.status}`);error.status=response.status;throw error;}
  return payload;
}

function ageHours(value,fallback=0) {
  if(!value) return Number.isFinite(Number(fallback))?Number(fallback):0;
  const ms=Date.now()-new Date(value).getTime();
  return Number.isFinite(ms)?Math.max(0,Math.floor(ms/3600000)):Number(fallback)||0;
}

function normalizeMode(value) {
  const raw=String(value||'').trim().toLowerCase();
  if(raw==='remote')return'Remote'; if(raw==='hybrid')return'Hybrid';
  if(['onsite','on-site','office','in-office'].includes(raw))return'Onsite';
  return'N/A';
}

function countryName(code){return COUNTRY_NAMES[String(code||'').toUpperCase()]||String(code||'').toUpperCase();}
function normalizedCountries(job){return normalizedCountryNames(job);}
function countryCompact(job){const list=job.countries||[];if(!list.length)return'Nespecificat';return list.length===1?list[0]:`${list[0]} +${list.length-1}`;}
function normalizeJob(job){const countries=normalizedCountries(job);return{
  id:job.id||null,title:job.title||'Titlu indisponibil',company:job.company||'Companie nespecificata',initial:job.initial||((job.company||'?').split(/\s+/).slice(0,2).map(x=>x[0]).join('').toUpperCase()||'?'),
  fit:Number.isFinite(Number(job.fit))?Number(job.fit):0,location:job.location||'Nespecificat',countries,countryCodes:Array.isArray(job.country_codes)?job.country_codes:[],remoteScope:job.remote_scope||'Unknown',mode:normalizeMode(job.mode),type:job.type||'Nespecificat',contractType:job.contract_type||'unknown',employmentTypeRaw:job.employment_type_raw||null,age:ageHours(job.date_posted,job.age),
  remote:Boolean(job.remote),b2b:Boolean(job.b2b),repost:Boolean(job.repost),status:job.status||'review',pros:Array.isArray(job.pros)?job.pros:[],risks:Array.isArray(job.risks)?job.risks:[],url:job.url||null,
  description:String(job.description||'').trim(),date_posted:job.date_posted||null,source:job.source||'Nespecificata',verified_at:job.verified_at||null,archivedAt:job.archived_at||null,isApplication:false,
};}
function inferApplicationCountry(){return[];}
function normalizeApplication(application){const ref=application.reference?`Referinta: ${application.reference}`:'Referinta nespecificata';const next=application.next_status_check?`Urmatorul status check: ${application.next_status_check}`:'Status check nespecificat';const countries=Array.isArray(application.countries)?application.countries:inferApplicationCountry(application.location);return{
  id:application.id||`application-${application.company||''}-${application.title||''}-${application.applied_at||''}`,title:application.title||'Rol nespecificat',company:application.company||'Companie nespecificata',initial:(application.company||'?').split(/\s+/).slice(0,2).map(x=>x[0]).join('').toUpperCase()||'?',fit:null,location:application.location||'Nespecificat',countries,countryCodes:[],remoteScope:'Unknown',mode:'N/A',type:'Aplicat',contractType:'unknown',employmentTypeRaw:null,age:0,remote:false,b2b:false,repost:false,status:application.status||'applied',pros:[`Aplicat: ${application.applied_at||'data nespecificata'}`,ref],risks:[next],url:application.url||null,description:`Status: ${application.status||'applied'}. ${ref}. ${next}.`,source:'Istoric aplicari',date_posted:application.applied_at||null,isApplication:true,
};}
function criteriaFromConfig(config){
  const modes=config?.work_modes||{};
  return{
    roleFamilies:Array.isArray(config?.target_role_families)?[...config.target_role_families]:[],
    roleSubfamilies:Array.isArray(config?.target_role_subfamilies)?[...config.target_role_subfamilies]:[],
    workRemote:modes.remote===true,
    workHybrid:modes.hybrid===true,
    workOnsite:modes.onsite===true,
    contractTypes:Array.isArray(config?.contract_types)?[...config.contract_types]:[],
    freshness:Number(config?.freshness_hours??24),
    fitThreshold:Number(config?.fit_threshold??60),
    keepReposts:config?.keep_reposts!==false,
    rateMin:Number(config?.rate_min_eur_day??0),
    rateMax:Number(config?.rate_max_eur_day??10000),
    immediateStart:config?.immediate_start===true,
    exclusions:Array.isArray(config?.exclusions)?[...config.exclusions]:[],
    targetRegions:Array.isArray(config?.target_regions)?[...config.target_regions]:[],
    targetCountries:Array.isArray(config?.target_country_codes)?[...config.target_country_codes]:Array.isArray(config?.search_country_codes)?[...config.search_country_codes]:[],
    excludedRegions:Array.isArray(config?.excluded_regions)?[...config.excluded_regions]:[],
    excludedCountries:Array.isArray(config?.excluded_country_codes)?[...config.excluded_country_codes]:[],
  };
}
function normalizeSource(source){const method=source.collection_method||sourceCollectionMethod(source.url)||null;return{
  id:source.id||null,category:source.category||'Altele',name:source.name||'Sursa',url:source.url||'#',active:source.active===true,collectionMethod:method,connectorAvailable:source.connector_available??Boolean(method),validationStatus:source.validation_status||(source.active?'validated':'pending'),approvalStatus:source.approval_status||(source.active?'approved':'pending'),lastValidatedAt:source.last_validated_at||null,validationReason:source.validation_reason||null,
};}
const jobKey=job=>String(job.id||`${job.title}|${job.company}|${job.date_posted||''}`);
function publishedLabel(job){if(job.isApplication)return job.date_posted?`aplicat ${job.date_posted}`:'aplicat';const age=ageHours(job.date_posted,job.age);if(age<1)return'sub 1h';if(age<24)return`${age}h`;const days=Math.floor(age/24),hours=age%24;return hours?`${days}z ${hours}h`:`${days}z`;}
function formatRunTime(value){if(!value)return'—';try{return new Intl.DateTimeFormat('ro-RO',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Bucharest'}).format(new Date(value));}catch{return value;}}
function geographyConflicts(criteria){const targetR=new Set(criteria.targetRegions||[]),excludedR=new Set(criteria.excludedRegions||[]),targetC=new Set(criteria.targetCountries||[]),excludedC=new Set(criteria.excludedCountries||[]);for(const x of targetR)if(excludedR.has(x))return true;for(const x of targetC)if(excludedC.has(x))return true;for(const r of targetR)for(const c of targetC)if(REGION_COUNTRIES[r]?.has(c))return true;for(const r of excludedR)for(const c of excludedC)if(REGION_COUNTRIES[r]?.has(c))return true;for(const r of targetR)for(const c of excludedC)if(REGION_COUNTRIES[r]?.has(c))return true;for(const r of excludedR)for(const c of targetC)if(REGION_COUNTRIES[r]?.has(c))return true;return false;}
function hasTargetGeography(criteria){return Boolean(criteria?.targetRegions?.length||criteria?.targetCountries?.length);}
function hasSelectedRole(criteria){
  const families=Array.isArray(criteria?.roleFamilies)?criteria.roleFamilies:[];
  const subfamilies=new Set(Array.isArray(criteria?.roleSubfamilies)?criteria.roleSubfamilies:[]);
  return families.length>0&&families.every(code=>{
    const family=ROLE_FAMILIES.find(item=>item.code===code);
    return Boolean(family?.subfamilies?.some(item=>subfamilies.has(item.code)));
  });
}
function hasSelectedWorkMode(criteria){return Boolean(criteria?.workRemote||criteria?.workHybrid||criteria?.workOnsite);}
function hasSelectedContractType(criteria){return Array.isArray(criteria?.contractTypes)&&criteria.contractTypes.length>0;}
function preferencePatchFromCriteria(criteria){return{
  roleFamilies:[...(criteria.roleFamilies||[])],
  roleSubfamilies:[...(criteria.roleSubfamilies||[])],
  workRemote:criteria.workRemote===true,
  workHybrid:criteria.workHybrid===true,
  workOnsite:criteria.workOnsite===true,
  contractTypes:[...(criteria.contractTypes||[])],
  freshness:Number(criteria.freshness),
  fitThreshold:Number(criteria.fitThreshold),
  keepReposts:criteria.keepReposts!==false,
  rateMin:Number(criteria.rateMin),
  rateMax:Number(criteria.rateMax),
  immediateStart:criteria.immediateStart===true,
  exclusions:[...(criteria.exclusions||[])],
  targetRegions:[...(criteria.targetRegions||[])],
  targetCountries:[...(criteria.targetCountries||[])],
  excludedRegions:[...(criteria.excludedRegions||[])],
  excludedCountries:[...(criteria.excludedCountries||[])],
};}

function loadGoogleIdentityScript(){if(window.google?.accounts?.id)return Promise.resolve();return new Promise((resolve,reject)=>{const existing=document.querySelector('script[data-google-identity]');if(existing){existing.addEventListener('load',resolve,{once:true});existing.addEventListener('error',reject,{once:true});return;}const script=document.createElement('script');script.src='https://accounts.google.com/gsi/client';script.async=true;script.defer=true;script.dataset.googleIdentity='true';script.onload=resolve;script.onerror=()=>reject(new Error('Google Identity Services nu a putut fi incarcat.'));document.head.appendChild(script);});}
function GoogleSignIn({clientId,loginHint,allowAutoRestore,onCredential,disabled}){const ref=useRef(null);useEffect(()=>{let active=true;if(!clientId||disabled)return undefined;loadGoogleIdentityScript().then(()=>{if(!active||!ref.current)return;const options=googleIdentityOptions({clientId,loginHint,allowAutoRestore,onCredential});window.google.accounts.id.initialize(options);ref.current.innerHTML='';window.google.accounts.id.renderButton(ref.current,{theme:'outline',size:'large',shape:'rectangular',text:'signin_with'});if(options.auto_select)window.google.accounts.id.prompt();}).catch(()=>{});return()=>{active=false;};},[clientId,loginHint,allowAutoRestore,disabled,onCredential]);return<div ref={ref} className={disabled?'pointer-events-none opacity-60':''}/>;}
function Toast({toast}){if(!toast)return null;return<div className={cx('fixed bottom-5 right-5 z-[90] max-w-sm rounded-xl border bg-white px-4 py-3 text-sm text-slate-800 shadow-lg',toast.type==='success'?'border-emerald-200':toast.type==='error'?'border-red-200':'border-slate-200')} role="status"><div className="flex items-start gap-3"><span className={cx('mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full',toast.type==='success'?'bg-emerald-500':toast.type==='error'?'bg-red-500':'bg-slate-400')}/><span>{toast.message}</span></div></div>;}
function Brand(){return<div className="flex items-center gap-3 px-5 py-5"><div className="grid h-10 w-10 place-items-center rounded-xl bg-blue-600 text-lg font-bold text-white shadow-sm">S</div><span className="font-display text-lg font-bold tracking-tight text-white">Job Search</span></div>;}
function SignedOutScreen({clientId,loginHint,allowAutoRestore,authError,authStatus,onCredential}){return<div className="min-h-screen bg-slate-50 md:flex"><aside className="bg-slate-950 md:min-h-screen md:w-64 md:shrink-0"><Brand/></aside><main className="flex min-h-[calc(100vh-80px)] flex-1 items-start justify-center p-6 pt-10 md:min-h-screen md:justify-start md:p-12"><div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><h1 className="font-display text-xl font-bold text-slate-900">Acces securizat</h1><p className="mt-1 text-sm text-slate-500">Autentifica-te cu contul Google autorizat.</p><div className="mt-5 min-h-11">{clientId?<GoogleSignIn clientId={clientId} loginHint={loginHint} allowAutoRestore={allowAutoRestore} onCredential={onCredential} disabled={authStatus==='authenticating'}/>:<div className="h-11 animate-pulse rounded-lg bg-slate-100"/>}</div>{authStatus==='authenticating'&&<p className="mt-3 text-sm text-slate-500">Se verifica sesiunea...</p>}{authError&&<div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{authError}</div>}</div></main></div>;}

function SidebarBadge({value,active}){return<span className={cx('ml-auto min-w-6 rounded-full px-2 py-0.5 text-center text-xs font-semibold text-white',active?'bg-blue-500':'bg-slate-700')}>{value}</span>;}
function Sidebar({view,onView,counts,runStatus,role}) {
  const items=[['jobs','Joburi noi','jobs',counts.jobs],['review','De evaluat','review',counts.review],['applications','Aplicari','applications',counts.applications],['criteria','Criterii de selectie','criteria',null],...(role==='ADMIN'?[['admin','Administrare','admin',null]]:[])];
  const progress=runProgressModel(runStatus);
  const statusTone=runStatus?.status==='completed'?'bg-emerald-500':isActiveRunStatus(runStatus?.status)?'bg-blue-500':runStatus?.status==='completed_with_errors'?'bg-amber-500':'bg-slate-500';
  return <aside className="hidden bg-slate-950 text-slate-300 md:sticky md:top-14 md:flex md:h-[calc(100vh-3.5rem)] md:w-64 md:shrink-0 md:flex-col">
    <nav className="space-y-1 px-3 py-4">{items.map(([key,label,icon,count])=><button key={key} onClick={()=>onView(key)} className={cx('flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition',view===key?'bg-slate-800 text-white':'hover:bg-slate-900 hover:text-white')}><Icon name={icon}/><span>{label}</span>{count!==null&&<SidebarBadge value={count} active={view===key}/>}</button>)}</nav>
    {role==='ADMIN'&&<div className="mt-auto border-t border-slate-800 p-4"><div className="flex items-center gap-2 text-xs text-slate-400"><span className={cx('h-2 w-2 rounded-full',statusTone)}/><span>{isActiveRunStatus(runStatus?.status)?'Rulare in curs':'Ultima rulare'}</span></div><div className="mt-1 text-xs text-slate-500">{formatRunTime(runStatus?.completed_at||runStatus?.started_at)} · {progress.active?`${progress.processed}/${progress.total} surse · ${progress.percent}%`:`${progress.processed} surse`}</div></div>}
  </aside>;
}

function BottomNav({view,onView,counts,role,onLogout}) {
  const[moreOpen,setMoreOpen]=useState(false);
  const primary=[['jobs','Joburi','jobs',counts.jobs],['review','Review','review',counts.review],['applications','Aplicari','applications',counts.applications]];
  const choose=key=>{setMoreOpen(false);onView(key);};
  const moreActive=['criteria','admin'].includes(view);
  return <>
    {moreOpen&&<button type="button" aria-label="Inchide meniul More" onClick={()=>setMoreOpen(false)} className="fixed inset-0 z-40 bg-slate-950/20 md:hidden"/>}
    {moreOpen&&<section aria-label="Mai multe optiuni" className="safe-bottom fixed inset-x-3 bottom-[4.75rem] z-50 rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl md:hidden">
      <button type="button" onClick={()=>choose('criteria')} className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50"><Icon name="criteria"/> Criterii de selectie</button>
      {role==='ADMIN'&&<button type="button" onClick={()=>choose('admin')} className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50"><Icon name="admin"/> Administrare</button>}
      <div className="my-1 border-t border-slate-100"/>
      <div className="px-3 py-2 text-xs text-slate-400">{APP_VERSION}</div>
      <button type="button" onClick={onLogout} className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-semibold text-slate-600 hover:bg-slate-50"><Icon name="logout"/> Deconecteaza</button>
    </section>}
    <nav aria-label="Navigatie principala" className="safe-bottom fixed inset-x-0 bottom-0 z-50 border-t border-slate-200 bg-white/95 px-1 pt-1 shadow-[0_-8px_24px_rgba(15,23,42,0.08)] backdrop-blur md:hidden">
      <div className="grid grid-cols-4 gap-1">
        {primary.map(([key,label,icon,count])=><button key={key} type="button" onClick={()=>choose(key)} aria-current={view===key?'page':undefined} className={cx('relative flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[10px] font-semibold',view===key?'bg-blue-50 text-blue-700':'text-slate-500')}><Icon name={icon} className="h-5 w-5"/><span className="max-w-full truncate">{label}</span>{count!==null&&<span className="absolute right-1 top-1 min-w-4 rounded-full bg-slate-100 px-1 text-[9px] text-slate-600">{count}</span>}</button>)}
        <button type="button" onClick={()=>setMoreOpen(v=>!v)} aria-expanded={moreOpen} className={cx('flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[10px] font-semibold',moreOpen||moreActive?'bg-blue-50 text-blue-700':'text-slate-500')}><span className="text-xl leading-none">•••</span><span>More</span></button>
      </div>
    </nav>
  </>;
}
function ProfileMenu({email,onLogout,onDeleteAccount}){const[open,setOpen]=useState(false),ref=useRef(null);const initial=(email||'G').slice(0,1).toUpperCase();useEffect(()=>{const handler=e=>{if(ref.current&&!ref.current.contains(e.target))setOpen(false)};document.addEventListener('mousedown',handler);return()=>document.removeEventListener('mousedown',handler);},[]);return<div className="relative" ref={ref}><button onClick={()=>setOpen(v=>!v)} className="flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-2.5 text-sm text-slate-700 shadow-sm transition hover:bg-slate-50"><span className="grid h-7 w-7 place-items-center rounded-full bg-slate-100 text-xs font-bold text-slate-700">{initial}</span><span className="hidden max-w-40 truncate lg:block">{email||'Google conectat'}</span><Icon name="chevronDown" className="h-4 w-4 text-slate-400"/></button>{open&&<div className="absolute right-0 z-50 mt-2 w-64 rounded-xl border border-slate-200 bg-white p-2 shadow-lg"><div className="px-3 py-2"><div className="text-xs font-medium uppercase tracking-wide text-slate-400">Cont conectat</div><div className="mt-1 truncate text-sm font-medium text-slate-800">{email||'Google'}</div></div><div className="my-1 border-t border-slate-100"/><button onClick={onLogout} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-600 hover:bg-slate-50 hover:text-slate-900"><Icon name="logout"/> Deconecteaza</button><button onClick={()=>{setOpen(false);onDeleteAccount();}} className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold text-red-600 hover:bg-red-50"><Icon name="trash"/> Sterge contul</button></div>}</div>;}
function EnvironmentMarker({environment,className=''}){const label=environmentBadge(environment);if(!label)return null;return<span className={cx('inline-flex rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-bold tracking-wide text-amber-800',className)}>{`[${label}]`}</span>;}

function ApplicationHeader({email,onLogout,onDeleteAccount,environment}) {
  return <header className="safe-top sticky top-0 z-50 h-14 border-b border-slate-200 bg-white/95 backdrop-blur">
    <div className="mx-auto flex h-full w-full max-w-[1660px] items-center justify-between px-3 sm:px-6">
      <div className="flex min-w-0 items-center gap-2.5"><div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-blue-600 text-sm font-bold text-white">S</div><span className="truncate font-display text-sm font-bold text-slate-950 sm:text-base">Job Search</span><EnvironmentMarker environment={environment}/></div>
      <div className="flex items-center gap-2"><span className="hidden text-xs text-slate-400 sm:inline">{APP_VERSION}</span><ProfileMenu email={email} onLogout={onLogout} onDeleteAccount={onDeleteAccount}/></div>
    </div>
  </header>;
}

function Header({view,running,onRun,refreshDisabled=false,metrics}) {
  const titles={jobs:'Joburi noi',review:'De evaluat',applications:'Aplicari',criteria:'Criterii de selectie',admin:'Administrare'};
  const date=new Intl.DateTimeFormat('ro-RO',{weekday:'long',day:'numeric',month:'long',timeZone:'Europe/Bucharest'}).format(new Date()).toUpperCase();
  const summary=view==='jobs'&&metrics?`${metrics.jobs} noi · ${metrics.high} fit · ${metrics.remote} remote`:view==='review'&&metrics?`${metrics.high} fit ridicat · ${metrics.scope}`:'';
  return <header className="flex items-center justify-between gap-3">
    <div className="min-w-0"><div className="hidden text-xs font-semibold tracking-[0.16em] text-slate-400 sm:block">{date}</div><h1 className="truncate font-display text-xl font-bold tracking-tight text-slate-950 sm:mt-1 sm:text-2xl">{titles[view]}</h1>{summary&&<div className="mt-0.5 truncate text-xs font-medium text-slate-500 md:hidden">{summary}</div>}</div>
    {(view==='jobs'||view==='review'||view==='admin')&&<button onClick={onRun} disabled={running||refreshDisabled} className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-blue-600 px-3 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-11 sm:px-4 sm:text-sm"><Icon name="refresh" className={cx('h-4 w-4',running&&'animate-spin')}/><span className="hidden sm:inline">{running?'Actualizare...':'Actualizeaza joburile'}</span><span className="sm:hidden">{running?'...':'Refresh'}</span></button>}
  </header>;
}


function RunProgressPanel({status}) {
  if(!status)return null;
  const progress=runProgressModel(status);
  if(!progress.active&&!progress.terminal)return null;
  const title=progress.active?'Actualizare joburi in curs':status?.status==='completed'?'Ultima actualizare finalizata':status?.status==='completed_with_errors'?'Ultima actualizare cu erori':'Ultima actualizare esuata';
  return <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" aria-label="Progres actualizare surse">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><div className="text-sm font-semibold text-slate-900">{title}</div><div className="mt-1 text-xs text-slate-500">{progress.processed} din {progress.total} surse procesate</div></div>
      <div className="text-2xl font-bold tabular-nums text-slate-950">{progress.percent}%</div>
    </div>
    <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-blue-600 transition-[width] duration-500" style={{width:`${progress.percent}%`}}/></div>
    <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold">
      <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-700">GOOD {progress.good}</span>
      <span className="rounded-full bg-red-50 px-2.5 py-1 text-red-700">FAIL {progress.failed}</span>
      {progress.skipped>0&&<span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600">SKIP {progress.skipped}</span>}
      {progress.partial>0&&<span className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-700">PARTIAL {progress.partial}</span>}
      {progress.terminal&&<span className="rounded-full bg-blue-50 px-2.5 py-1 text-blue-700">JOBURI {progress.jobsPublished}</span>}
    </div>
  </section>;
}

function MetricCard({value,label,note,icon,tone='blue',active,onClick}){const tones={blue:'bg-blue-50 text-blue-600',amber:'bg-amber-50 text-amber-600',violet:'bg-violet-50 text-violet-600',slate:'bg-slate-100 text-slate-600'};return<button onClick={onClick} className={cx('w-full rounded-2xl border bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md',active?'border-blue-400 ring-4 ring-blue-50':'border-slate-200')}><div className="flex items-start gap-3"><span className={cx('grid h-9 w-9 place-items-center rounded-xl',tones[tone])}><Icon name={icon}/></span><div><div className="text-2xl font-bold leading-none text-slate-950">{value}</div><div className="mt-1 text-sm text-slate-600">{label}</div><div className="mt-1 text-xs text-slate-400">{note}</div></div></div></button>;}
function MobileKpiChip({value,label,active,onClick}){return<button type="button" onClick={onClick} className={cx('min-w-[7rem] rounded-xl border px-3 py-2 text-left shadow-sm',active?'border-blue-300 bg-blue-50':'border-slate-200 bg-white')}><span className="block text-lg font-bold leading-none text-slate-950">{value}</span><span className="mt-1 block text-[11px] font-medium text-slate-500">{label}</span></button>;}
function KPIGrid({metrics,selected,onSelect}){const toggle=key=>onSelect(selected===key?'all':key);return<>
  <section aria-label="Rezumat joburi" className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1 md:hidden">
    <MobileKpiChip value={metrics.jobs} label="noi" active={selected==='new'} onClick={()=>toggle('new')}/>
    <MobileKpiChip value={metrics.high} label="fit ridicat" active={selected==='high'} onClick={()=>toggle('high')}/>
    <MobileKpiChip value={metrics.remote} label="remote" active={selected==='remote'} onClick={()=>toggle('remote')}/>
    <MobileKpiChip value={metrics.reposts} label="repostari" active={selected==='repost'} onClick={()=>toggle('repost')}/>
  </section>
  <section className="hidden gap-3 sm:grid-cols-2 md:grid xl:grid-cols-4"><MetricCard value={metrics.jobs} label="roluri noi" note="ultimele 24h din filtrul curent" icon="jobs" active={selected==='new'} onClick={()=>toggle('new')}/><MetricCard value={metrics.high} label="fit ridicat" note={`>= ${metrics.threshold}% · ${metrics.scope}`} icon="review" tone="slate" active={selected==='high'} onClick={()=>toggle('high')}/><MetricCard value={metrics.reposts} label="repostari" note={metrics.scope} icon="refresh" tone="amber" active={selected==='repost'} onClick={()=>toggle('repost')}/><MetricCard value={metrics.remote} label="remote" note={metrics.scope} icon="globe" tone="violet" active={selected==='remote'} onClick={()=>toggle('remote')}/></section>
</>;}
function FilterButton({active,onClick,children,count}){return<button onClick={onClick} className={cx('inline-flex h-9 items-center gap-2 rounded-full border px-3 text-sm font-medium transition',active?'border-blue-200 bg-blue-50 text-blue-700':'border-slate-200 bg-white text-slate-600 hover:bg-slate-50')}>{children}{count!==undefined&&<span className={cx('rounded-full px-1.5 py-0.5 text-[11px] font-semibold',active?'bg-blue-100 text-blue-700':'bg-slate-100 text-slate-500')}>{count}</span>}</button>;}
function WorkModeDropdown({selected,onChange}){const[open,setOpen]=useState(false),ref=useRef(null);useEffect(()=>{const h=e=>{if(ref.current&&!ref.current.contains(e.target))setOpen(false)};document.addEventListener('mousedown',h);return()=>document.removeEventListener('mousedown',h)},[]);const label=selected.length===ALL_WORK_MODES.length?'Toate':selected.length===0?'Niciunul':selected.map(mode=>mode==='Hybrid'?'Hibrid':mode).join(', ');const toggle=mode=>onChange(selected.includes(mode)?selected.filter(x=>x!==mode):[...selected,mode]);return<div className="relative" ref={ref}><button onClick={()=>setOpen(v=>!v)} className="inline-flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-600">Mod lucru: <span className="max-w-36 truncate text-slate-800">{label}</span><Icon name="chevronDown" className="h-4 w-4 text-slate-400"/></button>{open&&<div className="absolute left-0 z-40 mt-2 w-48 rounded-xl border border-slate-200 bg-white p-2 shadow-lg">{ALL_WORK_MODES.map(mode=><label key={mode} className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-slate-700 hover:bg-slate-50"><input type="checkbox" checked={selected.includes(mode)} onChange={()=>toggle(mode)} className="h-4 w-4 rounded border-slate-300"/>{mode==='Hybrid'?'Hibrid':mode}</label>)}</div>}</div>;}
function Filters({filters,setFilters,counts,defaultFreshness,onResetKpi}) {
  const[mobileOpen,setMobileOpen]=useState(false);
  const reset=()=>{setFilters({search:'',quick:'all',freshness:defaultFreshness||24,workModes:[...ALL_WORK_MODES],sort:'fit-desc'});onResetKpi?.();};
  const secondaryCount=(filters.freshness!==(defaultFreshness||24)?1:0)+(filters.workModes.length!==ALL_WORK_MODES.length?1:0)+(filters.sort!=='fit-desc'?1:0);
  const secondary=<><label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Vechime<select value={filters.freshness} onChange={e=>setFilters(v=>({...v,freshness:Number(e.target.value)}))} className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700"><option value={24}>24h</option><option value={36}>36h</option><option value={48}>48h</option><option value={120}>5 zile</option><option value={720}>30 zile</option></select></label><div><div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Mod lucru</div><WorkModeDropdown selected={filters.workModes} onChange={workModes=>setFilters(v=>({...v,workModes}))}/></div><label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Sortare<select value={filters.sort} onChange={e=>setFilters(v=>({...v,sort:e.target.value}))} className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700"><option value="fit-desc">FIT descrescator</option><option value="fit-asc">FIT crescator</option></select></label></>;
  return <>
    <div className="sticky top-14 z-30 -mx-3 border-y border-slate-200 bg-slate-50/95 px-3 py-2 backdrop-blur md:static md:mx-0 md:rounded-2xl md:border md:bg-white md:p-0 md:shadow-sm">
      <div className="flex gap-2 md:border-b md:border-slate-100 md:p-4">
        <label className="relative min-w-0 flex-1"><Icon name="search" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"/><input value={filters.search} onChange={e=>setFilters(v=>({...v,search:e.target.value}))} type="search" placeholder="Cauta joburi..." className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-3 text-sm text-slate-800 outline-none md:h-11 md:bg-slate-50"/></label>
        <button type="button" onClick={()=>setMobileOpen(true)} className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 md:hidden">Filtre{secondaryCount>0&&<span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] text-blue-700">{secondaryCount}</span>}</button>
      </div>
      <div className="mt-2 flex gap-2 overflow-x-auto pb-0.5 md:mt-0 md:flex-wrap md:items-center md:p-4">
        <FilterButton active={filters.quick==='all'} onClick={()=>setFilters(v=>({...v,quick:'all'}))} count={counts.all}>Toate</FilterButton><FilterButton active={filters.quick==='high'} onClick={()=>setFilters(v=>({...v,quick:'high'}))} count={counts.high}>High FIT</FilterButton><FilterButton active={filters.quick==='b2b'} onClick={()=>setFilters(v=>({...v,quick:'b2b'}))} count={counts.b2b}>B2B</FilterButton>
        <div className="hidden flex-1 items-center gap-2 md:flex">{secondary}<button onClick={reset} className="ml-auto inline-flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-600"><Icon name="reset"/> Reseteaza</button></div>
      </div>
    </div>
    {mobileOpen&&<><button type="button" aria-label="Inchide filtrele" className="fixed inset-0 z-[70] bg-slate-950/30 md:hidden" onClick={()=>setMobileOpen(false)}/><section role="dialog" aria-modal="true" aria-label="Filtre afisare" className="safe-bottom fixed inset-x-0 bottom-0 z-[80] rounded-t-3xl bg-white p-4 shadow-2xl md:hidden">
      <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-200"/>
      <div className="flex items-center justify-between"><div><div className="flex items-center gap-2"><h2 className="font-display text-lg font-bold text-slate-950">Filtre</h2><ScopeBadge scope="GUI ONLY"/></div><p className="mt-0.5 text-xs text-slate-400" title="Filtrele de afisare nu pornesc Retrieve si nu apeleaza provideri.">Mod lucru: Toate include si N/A · doar afisare</p></div><button type="button" onClick={()=>setMobileOpen(false)} className="grid min-h-11 min-w-11 place-items-center rounded-xl text-slate-500"><Icon name="close"/></button></div>
      <div className="mt-4 grid gap-4">{secondary}</div>
      <div className="mt-5 grid grid-cols-2 gap-2"><button type="button" onClick={reset} className="min-h-11 rounded-xl border border-slate-200 font-semibold text-slate-600">Reseteaza</button><button type="button" onClick={()=>setMobileOpen(false)} className="min-h-11 rounded-xl bg-blue-600 font-semibold text-white">Aplica</button></div>
    </section></>}
  </>;
}
function FitBadge({fit,threshold}){if(fit===null||fit===undefined)return<span className="text-sm text-slate-400">—</span>;return<span className={cx('inline-flex min-w-12 justify-center rounded-full px-2 py-1 text-xs font-semibold',fit>=threshold?'bg-blue-50 text-blue-700':'bg-slate-100 text-slate-600')}>{fit}%</span>;}
function ModeBadge({mode}){const tone=mode==='Remote'?'bg-violet-50 text-violet-700':mode==='Hybrid'?'bg-amber-50 text-amber-700':'bg-slate-100 text-slate-600';return<span className={cx('inline-flex rounded-full px-2 py-1 text-xs font-medium',tone)}>{mode==='Hybrid'?'Hibrid':mode}</span>;}
function knownCompact(value){const text=String(value||'').trim();return text&&!['n/a','nespecificat','unknown','companie nespecificata'].includes(text.toLowerCase())?text:null;}
function MobileOverflow({job,onArchive}){return<details className="relative"><summary aria-label="Mai multe actiuni" className="flex min-h-11 min-w-11 cursor-pointer list-none items-center justify-center rounded-xl border border-slate-200 bg-white text-lg font-bold text-slate-500">•••</summary><div className="absolute bottom-12 right-0 z-20 w-44 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl">{!job.isApplication&&<button type="button" onClick={()=>onArchive(job)} className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-sm font-medium text-slate-600 hover:bg-slate-50"><Icon name="archive"/> Arhiveaza</button>}</div></details>;}
function JobTable({rows,threshold,onDetails,onReview,onArchive,onApply,hasMore=false,loadingMore=false,onLoadMore,loading=false}) {
  if(!rows.length&&!loading)return<div className="rounded-2xl border border-slate-200 bg-white px-6 py-14 text-center text-sm text-slate-500 shadow-sm">Niciun rol nu corespunde filtrelor.</div>;
  return <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
    <div className="hidden grid-cols-[minmax(0,1fr)_150px_80px_105px_95px_220px] gap-3 border-b border-slate-100 bg-slate-50 px-5 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400 md:grid"><span>Rol</span><span>Tara</span><span>Fit</span><span>Mod lucru</span><span>Publicat</span><span className="text-right">Actiuni</span></div>
    <div>{rows.map((job,index)=><article key={jobKey(job)} className={cx('border-b border-slate-100 px-3 py-3 transition last:border-b-0 md:grid md:grid-cols-[minmax(0,1fr)_150px_80px_105px_95px_220px] md:items-center md:gap-3 md:px-5 md:py-3',index%2===0?'bg-white':'bg-slate-50/70','hover:bg-blue-50/40')}>
      <button type="button" onClick={()=>onDetails(job)} className="block w-full min-w-0 text-left md:flex md:items-start md:gap-3">
        <span className="hidden h-10 w-10 shrink-0 place-items-center rounded-xl bg-slate-100 text-xs font-bold text-slate-600 md:grid">{job.initial}</span>
        <span className="block min-w-0">
          <span className="flex items-start justify-between gap-3"><span className="line-clamp-2 text-[15px] font-semibold leading-5 text-slate-950 md:block md:truncate md:text-sm">{job.title}</span><span className="shrink-0 md:hidden"><FitBadge fit={job.fit} threshold={threshold}/></span></span>
          <span className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-slate-500"><span className="truncate">{knownCompact(job.company)||'Companie'}</span>{knownCompact(job.location)&&<><span>·</span><span className="truncate">{job.location}</span></>}{knownCompact(job.mode)&&<><span>·</span><span>{job.mode==='Hybrid'?'Hibrid':job.mode}</span></>}<span>·</span><span>{publishedLabel(job)}</span>{job.repost&&<span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-amber-700">Repost</span>}</span>
        </span>
      </button>
      <div className="hidden text-xs md:contents"><div className="font-medium text-slate-600">{countryCompact(job)}</div><div><FitBadge fit={job.fit} threshold={threshold}/></div><div>{knownCompact(job.mode)?<ModeBadge mode={job.mode}/>:<span className="text-slate-300">—</span>}</div><div className="font-medium text-slate-500">{publishedLabel(job)}</div></div>
      <div className="mt-3 flex items-center gap-2 md:hidden" onClick={event=>event.stopPropagation()}>
        {!job.isApplication&&<button type="button" onClick={()=>onReview(job)} className="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl border border-blue-200 bg-white px-3 text-xs font-semibold text-blue-700"><Icon name="review"/>Review</button>}
        {job.url&&<a role="button" href={job.url} target="_blank" rel="noopener noreferrer" onClick={()=>onApply(job)} className="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-blue-600 px-3 text-xs font-semibold text-white"><Icon name="external"/>Aplica</a>}
        {!job.isApplication&&<MobileOverflow job={job} onArchive={onArchive}/>}
      </div>
      <div className="hidden gap-2 md:flex md:justify-end" onClick={event=>event.stopPropagation()}>
        <button type="button" onClick={()=>onDetails(job)} className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-600"><Icon name="eye"/>Detalii</button>
        {!job.isApplication&&<button type="button" onClick={()=>onReview(job)} className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-blue-200 px-3 text-xs font-semibold text-blue-700"><Icon name="review"/>Review</button>}
        {job.url&&<a role="button" href={job.url} target="_blank" rel="noopener noreferrer" onClick={()=>onApply(job)} className="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-blue-600 px-3 text-xs font-semibold text-white"><Icon name="external"/>Aplica</a>}
        {!job.isApplication&&<button type="button" onClick={()=>onArchive(job)} className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-600"><Icon name="archive"/>Arhiveaza</button>}
      </div>
    </article>)}</div>
    <div className="flex flex-col gap-2 border-t border-slate-100 bg-slate-50 px-4 py-3 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between"><span>{loading?'Se actualizeaza lista...':rows.length+' rezultate de profil incarcate'}</span>{hasMore&&<button type="button" disabled={loadingMore} onClick={onLoadMore} className="min-h-11 rounded-xl border border-slate-200 bg-white px-4 font-semibold text-slate-700 disabled:opacity-50">{loadingMore?'Se incarca...':'Incarca mai multe'}</button>}</div>
  </div>;
}
function ErrorPanel({error,onRetry}){return<div className="rounded-2xl border border-red-200 bg-white p-6 shadow-sm"><div className="flex items-start gap-4"><span className="grid h-10 w-10 place-items-center rounded-xl bg-red-50 text-red-600"><Icon name="alert"/></span><div><h2 className="font-display font-bold text-slate-900">Datele nu au putut fi incarcate</h2><p className="mt-1 text-sm text-slate-600">{error?.message||'Eroare necunoscuta'}</p><button onClick={onRetry} className="mt-4 inline-flex h-9 items-center gap-2 rounded-xl border border-slate-200 px-3 text-sm font-semibold"><Icon name="retry"/> Reincearca</button></div></div></div>;}
function LoadingPanel(){return<div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><div className="flex items-center gap-3 text-sm text-slate-500"><span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-blue-600"/> Se incarca datele protejate...</div></div>;}
function DetailDrawer({job,threshold,onClose,onApply}) {
  if(!job)return null;
  return <><button className="fixed inset-0 z-50 bg-slate-950/25" onClick={onClose} aria-label="Inchide detaliile"/><aside className="fixed inset-0 z-[60] overflow-y-auto bg-white shadow-2xl md:inset-y-0 md:left-auto md:right-0 md:w-full md:max-w-xl md:border-l md:border-slate-200">
    <div className="safe-top sticky top-0 flex items-center justify-between border-b border-slate-100 bg-white px-3 py-2 sm:px-6 sm:py-3"><button type="button" onClick={onClose} className="inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"><span aria-hidden="true">←</span><span className="md:hidden">Inapoi</span><span className="hidden text-xs uppercase tracking-wide text-slate-400 md:inline">Detalii job</span></button><button onClick={onClose} aria-label="Inchide detaliile" className="hidden min-h-11 min-w-11 place-items-center rounded-lg hover:bg-slate-100 md:grid"><Icon name="close"/></button></div>
    <div className="space-y-6 p-4 pb-24 sm:p-6"><div><h2 className="font-display text-2xl font-bold text-slate-950">{job.title}</h2><p className="mt-1 text-sm text-slate-500">{job.company}</p></div><div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><div className="rounded-xl bg-slate-50 p-3"><div className="text-xs text-slate-400">FIT</div><div className="mt-1"><FitBadge fit={job.fit} threshold={threshold}/></div></div><div className="rounded-xl bg-slate-50 p-3"><div className="text-xs text-slate-400">Mod lucru</div><div className="mt-1"><ModeBadge mode={job.mode}/></div></div><div className="rounded-xl bg-slate-50 p-3"><div className="text-xs text-slate-400">Locatie</div><div className="mt-1 text-sm font-medium text-slate-700">{job.location}</div></div><div className="rounded-xl bg-slate-50 p-3"><div className="text-xs text-slate-400">Tara / tari</div><div className="mt-1 text-sm font-medium text-slate-700">{job.countries?.length?job.countries.join(', '):'Nespecificat'}</div></div><div className="rounded-xl bg-slate-50 p-3"><div className="text-xs text-slate-400">Tip contract</div><div className="mt-1 text-sm font-medium text-slate-700">{job.type||'Nespecificat'}</div></div><div className="rounded-xl bg-slate-50 p-3"><div className="text-xs text-slate-400">Sursa</div><div className="mt-1 text-sm font-medium text-slate-700">{job.source}</div></div>{job.remote&&<div className="rounded-xl bg-slate-50 p-3"><div className="text-xs text-slate-400">Scope Remote</div><div className="mt-1 text-sm font-medium text-slate-700">{job.remoteScope}</div></div>}</div>{job.pros?.length>0&&<div><h3 className="text-sm font-semibold text-slate-900">Puncte forte</h3><ul className="mt-2 space-y-2 text-sm text-slate-600">{job.pros.map((x,i)=><li key={i}>• {x}</li>)}</ul></div>}{job.risks?.length>0&&<div><h3 className="text-sm font-semibold text-slate-900">Riscuri</h3><ul className="mt-2 space-y-2 text-sm text-slate-600">{job.risks.map((x,i)=><li key={i}>• {x}</li>)}</ul></div>}<div><h3 className="text-sm font-semibold text-slate-900">Descriere</h3><div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-600">{job.description||'Descriere indisponibila.'}</div></div>{job.url&&<a role="button" href={job.url} target="_blank" rel="noopener noreferrer" onClick={()=>onApply?.(job)} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white">Deschide jobul <Icon name="external"/></a>}</div>
  </aside></>;
}


function ScopeBadge({scope}){const gui=scope==='GUI'||scope==='GUI ONLY';return<span className={cx('inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold tracking-wide',gui?'border-violet-200 bg-violet-50 text-violet-700':'border-blue-200 bg-blue-50 text-blue-700')}>{scope}</span>;}
function CriteriaCard({title,note,children,className,scope}) {
  return <details open className={cx('group rounded-2xl border border-slate-200 bg-white p-4 shadow-sm',className)}>
    <summary className="flex cursor-pointer list-none items-center justify-between gap-3"><span className="font-display text-base font-bold text-slate-900">{title}</span><span className="flex items-center gap-2">{scope&&<ScopeBadge scope={scope}/>}<span className="text-slate-400 transition group-open:rotate-180 md:hidden">⌄</span></span></summary>
    {note&&<p className="mt-1 text-sm text-slate-500">{note}</p>}
    <div className="mt-3 space-y-3">{children}</div>
  </details>;
}
function CheckRow({checked,onChange,children,disabled=false}){return<label className={cx('flex items-start gap-3 text-sm text-slate-700',disabled?'cursor-not-allowed opacity-60':'cursor-pointer')}><input type="checkbox" checked={checked} onChange={e=>onChange(e.target.checked)} disabled={disabled} className="mt-0.5 h-4 w-4 rounded border-slate-300"/><span>{children}</span></label>;}
function ChipsSelector({label,values,onChange,options,placeholder}){const available=options.filter(([value])=>!values.includes(value));return<div><div className="text-sm text-slate-700">{label}</div><select defaultValue="" onChange={e=>{if(e.target.value)onChange([...values,e.target.value]);e.target.value='';}} className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700"><option value="">{placeholder}</option>{available.map(([value,text])=><option key={value} value={value}>{text}</option>)}</select><div className="mt-2 flex flex-wrap gap-2">{values.map(value=><button type="button" key={value} onClick={()=>onChange(values.filter(x=>x!==value))} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">{COUNTRY_NAMES[value]||value}<Icon name="close" className="h-3 w-3"/></button>)}</div></div>;}
function RegionSelector({label,values,onChange}){return<div><div className="text-sm text-slate-700">{label}</div><div className="mt-2 flex flex-wrap gap-2">{REGION_OPTIONS.map(region=><button type="button" key={region} onClick={()=>onChange(values.includes(region)?values.filter(x=>x!==region):[...values,region])} className={cx('rounded-full border px-3 py-1.5 text-xs font-semibold',values.includes(region)?'border-blue-200 bg-blue-50 text-blue-700':'border-slate-200 bg-white text-slate-600')}>{region==='ASIA'?'Asia':region}</button>)}</div></div>;}
function ContractTypeSelector({values,onChange}){return<div><div className="text-sm text-slate-700">Tip contract</div><div className="mt-2 grid gap-2 sm:grid-cols-2">{CONTRACT_TYPE_OPTIONS.map(([code,label])=><CheckRow key={code} checked={values.includes(code)} onChange={checked=>onChange(checked?[...values,code]:values.filter(value=>value!==code))}>{label}</CheckRow>)}</div></div>;}
function CriteriaPage({draft,setDraft,saved,onSave,onReset,saving}){
  const dirty=JSON.stringify(draft)!==JSON.stringify(saved);
  const update=(key,value)=>setDraft(v=>({...v,[key]:value}));
  const addExclusion=value=>{if(value&&!draft.exclusions.includes(value))update('exclusions',[...draft.exclusions,value])};
  const removeExclusion=value=>update('exclusions',draft.exclusions.filter(x=>x!==value));
  const conflict=geographyConflicts(draft);
  const missingTarget=!hasTargetGeography(draft);
  const missingRole=!hasSelectedRole(draft);
  const tooManyRoleFamilies=(draft.roleFamilies||[]).length>2;
  const missingWorkMode=!hasSelectedWorkMode(draft);
  const missingContract=!hasSelectedContractType(draft);
  const invalidRetrieve=conflict||missingTarget||missingRole||tooManyRoleFamilies||missingWorkMode||missingContract;
  return <div className="space-y-5">
    <section className="rounded-2xl border border-blue-200 bg-blue-50 p-4">
      <div className="flex flex-wrap items-center gap-2"><h2 className="font-display text-base font-bold text-slate-900">Criterii Retrieve</h2><ScopeBadge scope="RETRIEVE"/></div>
      <p className="mt-1 text-sm text-slate-600">Aceste criterii definesc urmatoarea actualizare bounded si setul de joburi eligibile pentru Search Profile. Salvarea singura nu porneste Retrieve.</p>
    </section>
    <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
      <CriteriaCard title="Roluri urmarite" scope="RETRIEVE" note="Selecteaza familia si subfamiliile care definesc scope-ul de cautare.">
        {ROLE_FAMILIES.map(family=>{
          const familySelected=draft.roleFamilies.includes(family.code);
          const selectedSubs=new Set(draft.roleSubfamilies);
          const toggleFamily=checked=>setDraft(current=>selectRoleFamily(current,family,checked));
          const toggleSubfamily=(code,checked)=>{
            const next=checked?[...new Set([...draft.roleSubfamilies,code])]:draft.roleSubfamilies.filter(item=>item!==code);
            update('roleSubfamilies',next);
          };
          return <div key={family.code} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
            <CheckRow checked={familySelected} onChange={toggleFamily}><span className="font-semibold text-slate-800">{family.label}</span></CheckRow>
            {familySelected&&<div className="ml-7 mt-2 space-y-2 border-l border-slate-200 pl-3">
              {family.subfamilies.map(sub=><CheckRow key={sub.code} checked={selectedSubs.has(sub.code)} onChange={checked=>toggleSubfamily(sub.code,checked)}>{sub.label}</CheckRow>)}
              {!family.subfamilies.some(sub=>selectedSubs.has(sub.code))&&<div className="text-xs text-red-600">Selecteaza cel putin o subfamilie.</div>}
            </div>}
          </div>;
        })}
        {missingRole&&<div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">Selecteaza cel putin o familie si o subfamilie pentru Retrieve.</div>}
        {!missingRole&&draft.roleFamilies.length>=2&&<div className="text-xs text-slate-500">Poti selecta maximum doua familii majore pentru un Retrieve USER.</div>}
        {tooManyRoleFamilies&&<div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">Pastreaza maximum doua familii pentru Retrieve.</div>}
      </CriteriaCard>
      <CriteriaCard title="Mod de lucru" scope="RETRIEVE" note="Aici controlezi eligibilitatea backend. Filtrul de pe pagina Joburi este separat si GUI-only.">
        <CheckRow checked={draft.workRemote} onChange={v=>update('workRemote',v)}>Remote</CheckRow>
        <CheckRow checked={draft.workHybrid} onChange={v=>update('workHybrid',v)}>Hibrid</CheckRow>
        <CheckRow checked={draft.workOnsite} onChange={v=>update('workOnsite',v)}>Onsite</CheckRow>
        {missingWorkMode&&<div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">Selecteaza cel putin un mod de lucru pentru Retrieve.</div>}
      </CriteriaCard>
      <CriteriaCard title="Tara / regiune" scope="RETRIEVE">
        <RegionSelector label="Regiuni incluse" values={draft.targetRegions} onChange={v=>update('targetRegions',v)}/>
        <ChipsSelector label="Tari incluse" values={draft.targetCountries} onChange={v=>update('targetCountries',v)} options={COUNTRY_OPTIONS} placeholder="Adauga o tara"/>
        {missingTarget&&<div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">Selecteaza cel putin o tara sau regiune tinta.</div>}
        {conflict&&<div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">Exista conflict intre includeri si excluderi.</div>}
      </CriteriaCard>
      <CriteriaCard title="Vechime si repostari" scope="RETRIEVE">
        <label className="block text-sm text-slate-700">Vechime maxima la Retrieve<select value={draft.freshness} onChange={e=>update('freshness',Number(e.target.value))} className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 bg-white px-3"><option value={24}>24 ore</option><option value={36}>36 ore</option><option value={48}>48 ore</option><option value={120}>5 zile</option><option value={720}>30 zile</option></select></label>
        <CheckRow checked={draft.keepReposts} onChange={v=>update('keepReposts',v)}>Pastreaza repostarile</CheckRow>
      </CriteriaCard>
      <CriteriaCard title="Tip contract" scope="RETRIEVE">
        <ContractTypeSelector values={draft.contractTypes} onChange={v=>update('contractTypes',v)}/>
        {missingContract&&<div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">Selecteaza cel putin un tip de contract pentru Retrieve.</div>}
      </CriteriaCard>
      <CriteriaCard title="Excluderi" scope="RETRIEVE">
        <select defaultValue="" onChange={e=>{addExclusion(e.target.value);e.target.value='';}} className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"><option value="">Adauga excludere</option>{EXCLUSION_SUGGESTIONS.map(x=><option key={x}>{x}</option>)}</select>
        <div className="flex flex-wrap gap-2">{draft.exclusions.map(x=><button key={x} onClick={()=>removeExclusion(x)} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs">{x} ×</button>)}</div>
        <RegionSelector label="Regiuni excluse" values={draft.excludedRegions} onChange={v=>update('excludedRegions',v)}/>
        <ChipsSelector label="Tari excluse" values={draft.excludedCountries} onChange={v=>update('excludedCountries',v)} options={COUNTRY_OPTIONS} placeholder="Adauga tara exclusa"/>
      </CriteriaCard>
    </div>
    <section className="rounded-2xl border border-violet-200 bg-violet-50 p-4">
      <div className="flex flex-wrap items-center gap-2"><h2 className="font-display text-base font-bold text-slate-900">Preferinte de afisare</h2><ScopeBadge scope="GUI"/></div>
      <p className="mt-1 text-sm text-slate-600">Nu elimina joburi din dataset si nu apeleaza provideri. Pragul FIT reclasifica instant High FIT / De evaluat in interfata.</p>
      <div className="mt-4 max-w-sm"><label className="block text-sm text-slate-700">Prag High FIT<input type="number" min="50" max="100" value={draft.fitThreshold} onChange={e=>update('fitThreshold',Number(e.target.value))} className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 bg-white px-3"/></label></div>
    </section>
    <section className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600 shadow-sm">
      <strong className="text-slate-800">Controale scoase din Criterii:</strong> JobsPipe/providerii se administreaza in Administrare. Rate si Disponibilitate imediata nu sunt afisate ca filtre active deoarece motorul curent nu le aplica.
    </section>
    <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-20 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white/95 px-4 py-3 shadow-lg backdrop-blur sm:flex-row sm:items-center sm:justify-between md:static md:bg-white md:px-5 md:py-4 md:shadow-sm"><span className={cx('text-sm font-medium',dirty?'text-amber-600':'text-slate-500')}>{dirty?'Modificari nesalvate':'Preferinte salvate'}</span><div className="flex gap-2"><button type="button" onClick={onReset} disabled={!dirty||saving} className="min-h-11 flex-1 rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-600 disabled:opacity-50 sm:flex-none">Reseteaza</button><button onClick={onSave} disabled={!dirty||saving||invalidRetrieve} className="min-h-11 flex-1 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold disabled:opacity-50 sm:flex-none">{saving?'Se salveaza...':'Salveaza preferintele'}</button></div></div>
  </div>;
}

function OnboardingPanel({onStart}) {
  return <section className="rounded-2xl border border-blue-200 bg-white p-6 shadow-sm"><div className="max-w-2xl"><span className="inline-flex rounded-full bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700">Configurare initiala</span><h2 className="mt-3 font-display text-xl font-bold text-slate-950">Defineste Search Profile-ul inainte de prima lista de joburi</h2><p className="mt-2 text-sm leading-6 text-slate-600">JSCC nu porneste automat un Retrieve pentru un profil nou. Alege familia de roluri, geografia, modul de lucru si tipul de contract; apoi sistemul va reutiliza mai intai corpusul partajat existent.</p><button type="button" onClick={onStart} className="mt-5 min-h-11 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white">Configureaza criteriile</button></div></section>;
}

function App(){
  const initialUiRef=useRef(readUiState()),initialUi=initialUiRef.current;
  const[clientId,setClientId]=useState(null),[environment,setEnvironment]=useState(null),[auth,setAuth]=useState({status:'signed-out',token:null,email:null,role:null,error:null}),[dataState,setDataState]=useState({status:'idle',error:null});
  const[loginHint,setLoginHint]=useState(()=>readGoogleLoginHint()),[allowAutoRestore,setAllowAutoRestore]=useState(true);
  const[jobs,setJobs]=useState([]),[applications,setApplications]=useState([]),[sources,setSources]=useState([]),[sourceCategories,setSourceCategories]=useState([]),[runStatus,setRunStatus]=useState(null),[runHistory,setRunHistory]=useState([]),[promotionStatus,setPromotionStatus]=useState(null),[canonicalConfig,setCanonicalConfig]=useState(null);
  const[savedCriteria,setSavedCriteria]=useState(criteriaFromConfig({})),[draftCriteria,setDraftCriteria]=useState(criteriaFromConfig({})),[view,setView]=useState(initialUi.view||'jobs');
  const[filters,setFilters]=useState(()=>({...initialUi.filters,workModes:[...(initialUi.filters?.workModes||ALL_WORK_MODES)]})),[kpiFilter,setKpiFilter]=useState('all'),[detailJob,setDetailJob]=useState(null),[running,setRunning]=useState(false),[saving,setSaving]=useState(false),[toast,setToast]=useState(null);
  const[deleteAccountOpen,setDeleteAccountOpen]=useState(false),[deleteAccountConfirmation,setDeleteAccountConfirmation]=useState(''),[deletingAccount,setDeletingAccount]=useState(false);
  const[jobPage,setJobPage]=useState({nextCursor:null,loading:false,loadingMore:false,results:0});
  const[archivedKeys,setArchivedKeys]=useState([]);
  const pollGenerationRef=useRef(0),filtersRef=useRef(filters),jobQueryRef=useRef(''),restoredScrollRef=useRef(false),restoredJobRef=useRef(false),detailScrollRef=useRef(0);
  const notify=useCallback((message,type='info')=>{const id=Date.now();setToast({id,message,type});window.setTimeout(()=>setToast(current=>current?.id===id?null:current),3500);},[]);

  useEffect(()=>{filtersRef.current=filters;},[filters]);
  useEffect(()=>{registerPwa().catch(()=>{});},[]);
  useEffect(()=>{Promise.all([commandApi('/auth/config',null),commandApi('/health',null)]).then(([config,health])=>{if(!config?.configured||!config?.client_id)throw new Error('Autentificarea Google nu este configurata complet.');setClientId(config.client_id);setEnvironment(health?.environment||null);}).catch(error=>setAuth(current=>({...current,error:error.message})));},[]);
  useEffect(()=>()=>{pollGenerationRef.current+=1;},[]);

  useEffect(()=>{
    if(auth.status!=='authenticated'||auth.role!=='ADMIN')return undefined;
    let active=true,timer=null;
    const poll=async()=>{try{const payload=await fetchJson('/data/promotion-status.json',auth.token);if(!active)return;validateContract(payload,'promotion-status.json');setPromotionStatus(payload);if(payload?.status==='QUEUED'||payload?.status==='IN_PROGRESS')timer=setTimeout(poll,5000);}catch(error){if(active&&error?.status!==404)console.warn('promotion status poll failed');}};
    poll();
    return()=>{active=false;if(timer)clearTimeout(timer);};
  },[auth.status,auth.role,auth.token]);

  useEffect(()=>{if(auth.status==='authenticated'&&auth.role!=='ADMIN'&&view==='admin')setView('jobs');},[auth.status,auth.role,view]);

  const rememberUi=useCallback((selected=detailJob)=>writeUiState({view,filters,selectedJobId:selected?.id||null,scrollY:window.scrollY}),[view,filters,detailJob]);
  useEffect(()=>{if(auth.status==='authenticated')rememberUi();},[auth.status,rememberUi]);
  useEffect(()=>{if(auth.status!=='authenticated')return undefined;const save=()=>rememberUi();window.addEventListener('pagehide',save);return()=>window.removeEventListener('pagehide',save);},[auth.status,rememberUi]);

  const clearData=useCallback(()=>{setJobs([]);setApplications([]);setSources([]);setSourceCategories([]);setRunStatus(null);setRunHistory([]);setPromotionStatus(null);setCanonicalConfig(null);setJobPage({nextCursor:null,loading:false,loadingMore:false,results:0});jobQueryRef.current='';},[]);

  const loadJobsPage=useCallback(async(token,criteria,filterState,{cursor=null,append=false}={})=>{
    if(!isSearchProfileConfigured(criteria)){setJobs([]);setJobPage({nextCursor:null,loading:false,loadingMore:false,results:0});jobQueryRef.current='';return null;}
    const path=buildJobsPath({filters:filterState,cursor,limit:25,prefetch:25});
    setJobPage(current=>({...current,loading:!append,loadingMore:append}));
    try{
      const payload=validateJobsPage(await fetchJson(path,token));
      const normalized=(payload.jobs||[]).map(normalizeJob);
      setJobs(current=>append?mergeJobPages(current,normalized,jobKey):normalized);
      setArchivedKeys(current=>append?current:normalized.filter(job=>job.archivedAt).map(jobKey));
      setJobPage({nextCursor:payload.next_cursor||null,loading:false,loadingMore:false,results:Number(payload.results||normalized.length)});
      if(!append)jobQueryRef.current=buildJobsPath({filters:filterState,limit:25,prefetch:25});
      return payload;
    }catch(error){setJobPage(current=>({...current,loading:false,loadingMore:false}));throw error;}
  },[]);

  const loadData=useCallback(async(token,role)=>{setDataState({status:'loading',error:null});try{
    const[applicationPayload,configPayload]=await Promise.all([fetchJson('/applications',token),fetchJson('/me/preferences',token)]);
    for(const [payload,name] of [[applicationPayload,'applications'],[configPayload,'me/preferences']])validateContract(payload,name);
    const criteria=criteriaFromConfig(configPayload);
    const currentFilters=filtersRef.current;
    const nextFilters={...currentFilters,freshness:currentFilters.freshness??criteria.freshness??24,workModes:Array.isArray(currentFilters.workModes)&&currentFilters.workModes.length?currentFilters.workModes:[...ALL_WORK_MODES]};
    let statusPayload=null,historyPayload={runs:[]},sourcePayload={sources:[]},categoryPayload={categories:[]};
    if(role==='ADMIN'){
      [statusPayload,historyPayload,sourcePayload,categoryPayload]=await Promise.all([fetchJson('/data/run-status.json',token),fetchJson('/data/run-history.json',token),fetchJson('/data/sources.json',token),fetchJson('/data/source-categories.json',token)]);
      for(const [payload,name] of [[statusPayload,'run-status.json'],[historyPayload,'run-history.json'],[sourcePayload,'sources.json'],[categoryPayload,'source-categories.json']])validateContract(payload,name);
    }
    setApplications((applicationPayload.applications||[]).map(normalizeApplication));setSources((sourcePayload.sources||[]).map(normalizeSource));setSourceCategories(categoryPayload.categories||[]);setRunStatus(statusPayload);setRunHistory(historyPayload.runs||[]);setCanonicalConfig(configPayload);setSavedCriteria(criteria);setDraftCriteria(criteria);setFilters(nextFilters);
    await loadJobsPage(token,criteria,nextFilters);
    setDataState({status:'ready',error:null});return statusPayload;
  }catch(error){setDataState({status:'error',error});throw error;}},[loadJobsPage]);

  const handleCredential=useCallback(async credential=>{setAuth({status:'authenticating',token:null,email:null,role:null,error:null});try{const session=await commandApi('/auth/session',credential,{method:'POST'});const email=session?.email||null,role=session?.role||'USER';if(email){const remembered=rememberGoogleLoginHint(email);if(remembered)setLoginHint(remembered);}setAllowAutoRestore(true);setAuth({status:'authenticated',token:COOKIE_SESSION_BEARER,email,role,error:null});try{await loadData(COOKIE_SESSION_BEARER,role);notify('Autentificare Google reusita.','success');}catch(error){notify('Autentificarea a reusit, dar datele nu s-au incarcat: '+error.message,'error');}}catch(error){const message=error.status===403?'Contul este dezactivat sau nu are acces.':'Autentificare esuata: '+error.message;setAuth({status:'signed-out',token:null,email:null,role:null,error:message});}},[loadData,notify]);
  const logout=useCallback(async()=>{pollGenerationRef.current+=1;setAllowAutoRestore(false);try{await commandApi('/auth/logout',COOKIE_SESSION_BEARER,{method:'POST'});}catch{}try{window.google?.accounts?.id?.disableAutoSelect();}catch{}setAuth({status:'signed-out',token:null,email:null,role:null,error:null});setDataState({status:'idle',error:null});clearData();setDetailJob(null);setRunning(false);notify('Contul Google a fost deconectat.','info');},[clearData,notify]);
  const deleteCurrentAccount=useCallback(async()=>{if(deletingAccount||deleteAccountConfirmation!=='STERGE')return;setDeletingAccount(true);try{await commandApi('/me/account',auth.token,{method:'DELETE'});pollGenerationRef.current+=1;setAllowAutoRestore(false);try{window.google?.accounts?.id?.disableAutoSelect();}catch{}setAuth({status:'signed-out',token:null,email:null,role:null,error:null});setDataState({status:'idle',error:null});clearData();setDetailJob(null);setRunning(false);setDeleteAccountOpen(false);setDeleteAccountConfirmation('');notify('Contul si datele personale au fost sterse definitiv.','success');}catch(error){notify('Contul nu a putut fi sters: '+error.message,'error');}finally{setDeletingAccount(false);}},[auth.token,deletingAccount,deleteAccountConfirmation,clearData,notify]);
  const retryData=useCallback(()=>{if(auth.token)loadData(auth.token,auth.role).then(()=>notify('Datele au fost reincarcate.','success')).catch(error=>notify('Incarcarea a esuat: '+error.message,'error'));},[auth.token,auth.role,loadData,notify]);

  const profileConfigured=isSearchProfileConfigured(savedCriteria);
  useEffect(()=>{
    if(auth.status!=='authenticated'||dataState.status!=='ready'||!profileConfigured||!['jobs','review'].includes(view))return undefined;
    const key=buildJobsPath({filters,limit:25,prefetch:25});
    if(key===jobQueryRef.current)return undefined;
    const timer=setTimeout(()=>loadJobsPage(auth.token,savedCriteria,filters).catch(error=>notify('Lista de joburi nu a putut fi actualizata: '+error.message,'error')),250);
    return()=>clearTimeout(timer);
  },[auth.status,auth.token,dataState.status,profileConfigured,view,filters.search,filters.freshness,filters.workModes.join('|'),savedCriteria,loadJobsPage,notify]);

  useEffect(()=>{if(dataState.status!=='ready'||restoredScrollRef.current)return;restoredScrollRef.current=true;requestAnimationFrame(()=>window.scrollTo({top:initialUi.scrollY||0,behavior:'auto'}));},[dataState.status,initialUi.scrollY]);
  useEffect(()=>{if(restoredJobRef.current||!initialUi.selectedJobId||!jobs.length)return;const found=jobs.find(job=>String(job.id)===String(initialUi.selectedJobId));if(found)setDetailJob(found);restoredJobRef.current=true;},[jobs,initialUi.selectedJobId]);

  const activeJobs=useMemo(()=>jobs.filter(job=>!archivedKeys.includes(jobKey(job))),[jobs,archivedKeys]);
  const threshold=savedCriteria.fitThreshold||80;
  const jobPopulation=useMemo(()=>jobViewPopulation(activeJobs,filters,ageHours),[activeJobs,filters.freshness,filters.workModes]);
  const reviewRows=useMemo(()=>reviewRowsForFilters(activeJobs,filters,ageHours,threshold),[activeJobs,filters.freshness,filters.workModes,threshold]);
  const baseRows=useMemo(()=>view==='applications'?applications:view==='review'?reviewRows:jobPopulation,[view,applications,reviewRows,jobPopulation]);
  const filteredRows=useMemo(()=>{if(view==='applications')return[...baseRows];const q=filters.search.trim().toLowerCase();const rows=baseRows.filter(job=>{const quick=filters.quick==='all'||(filters.quick==='high'&&job.fit!==null&&job.fit>=threshold)||(filters.quick==='b2b'&&job.b2b);const kpi=kpiFilter==='all'||(kpiFilter==='new'&&ageHours(job.date_posted,job.age)<=24)||(kpiFilter==='high'&&job.fit!==null&&job.fit>=threshold)||(kpiFilter==='repost'&&job.repost)||(kpiFilter==='remote'&&job.mode==='Remote');const text=(job.title+' '+job.company+' '+job.description+' '+job.source+' '+job.location+' '+(job.countries||[]).join(' ')).toLowerCase();return quick&&kpi&&(!q||text.includes(q));});return[...rows].sort(filters.sort==='fit-asc'?(a,b)=>(a.fit??Number.MAX_SAFE_INTEGER)-(b.fit??Number.MAX_SAFE_INTEGER)||a.age-b.age:(a,b)=>(b.fit??-1)-(a.fit??-1)||a.age-b.age);},[view,baseRows,filters.quick,filters.search,filters.sort,threshold,kpiFilter]);
  const canonicalCounts=useMemo(()=>jobViewCounts(jobPopulation,threshold,ageHours),[jobPopulation,threshold]);
  const quickCounts=useMemo(()=>({all:canonicalCounts.all,high:canonicalCounts.high,b2b:canonicalCounts.b2b}),[canonicalCounts]);
  const metrics=useMemo(()=>({jobs:canonicalCounts.new24h,high:canonicalCounts.high,reposts:canonicalCounts.reposts,remote:canonicalCounts.remote,threshold,scope:jobCountScopeLabel(filters.freshness)}),[canonicalCounts,threshold,filters.freshness]);
  const counts=useMemo(()=>({jobs:canonicalCounts.all,review:reviewRows.length,applications:applications.length}),[canonicalCounts,reviewRows,applications]);

  const archiveJob=useCallback(async job=>{try{await commandApi('/me/jobs/'+job.id+'/state',auth.token,{method:'PUT',body:JSON.stringify({archived:true})});setArchivedKeys(current=>[...new Set([...current,jobKey(job)])]);if(detailJob?.id===job.id)setDetailJob(null);notify('Job arhivat pentru profilul curent.','success');}catch(error){notify('Arhivarea a esuat: '+error.message,'error');}},[auth.token,detailJob,notify]);
  const reviewJob=useCallback(async job=>{setDetailJob(job);try{await commandApi('/me/jobs/'+job.id+'/state',auth.token,{method:'PUT',body:JSON.stringify({seen:true})});}catch(error){notify('Starea Review nu a putut fi salvata: '+error.message,'error');}},[auth.token,notify]);
  const applyJob=useCallback(job=>{writeUiState({view,filters,selectedJobId:job?.id||null,scrollY:window.scrollY});},[view,filters]);

  const pollRun=useCallback(async(previousRunId,previousCompletedAt)=>{const generation=++pollGenerationRef.current;const baseline={runId:previousRunId??null,completedAt:previousCompletedAt??null};for(let attempt=0;generation===pollGenerationRef.current;attempt+=1){await new Promise(resolve=>setTimeout(resolve,pollingDelayMs(attempt)));if(generation!==pollGenerationRef.current)return null;try{const status=await fetchJson('/data/run-status.json?t='+Date.now(),auth.token);setRunStatus(status);if(!terminalForBaseline(status,baseline))continue;await loadData(auth.token,auth.role);const notice=completionNotice(status);notify(notice.message,notice.type);return status;}catch(error){if(error?.status===401||error?.status===403){notify('Urmarirea rularii s-a oprit deoarece sesiunea nu mai este autorizata.','error');return null;}}}return null;},[auth.token,auth.role,loadData,notify]);
  useEffect(()=>{if(auth.status!=='authenticated'||auth.role!=='ADMIN'||!auth.token||dataState.status!=='ready'||running||!isActiveRunStatus(runStatus?.status))return undefined;setRunning(true);pollRun(runStatus?.run_id??null,runStatus?.completed_at??null).finally(()=>setRunning(false));return undefined;},[auth.status,auth.role,auth.token,dataState.status,runStatus?.status,runStatus?.run_id,runStatus?.completed_at,running,pollRun]);

  const runSearch=useCallback(async()=>{
    if(!auth.token||running)return;
    if(!isSearchProfileConfigured(savedCriteria)){setView('criteria');notify('Configureaza familia, subfamilia si restul Search Profile-ului inainte de actualizare.','error');return;}
    setRunning(true);
    const previousRunId=runStatus?.run_id||null,previousCompletedAt=runStatus?.completed_at||null;
    try{
      const result=await commandApi(auth.role==='ADMIN'?'/admin/refresh':'/me/refresh',auth.token,{method:'POST'});
      const notice=refreshOutcomeNotice(result);notify(notice.message,notice.type);
      if(result.outcome==='REUSED_CORPUS'){await loadJobsPage(auth.token,savedCriteria,filtersRef.current);}
      else if(auth.role==='ADMIN'&&['STARTED_RUN','JOINED_EXISTING_RUN'].includes(result.outcome)){
        try{const currentStatus=await fetchJson('/data/run-status.json?t='+Date.now(),auth.token);setRunStatus(currentStatus);}catch(statusError){notify('Actualizarea a fost acceptata; astept statusul live al executiei.','info');}
        await pollRun(previousRunId,previousCompletedAt);
      }
    }catch(error){notify('Nu am putut actualiza joburile: '+error.message,'error');}
    finally{setRunning(false);}
  },[auth.token,auth.role,running,savedCriteria,runStatus,notify,loadJobsPage,pollRun]);

  const saveCriteria=useCallback(async()=>{if(!auth.token||saving)return;if(geographyConflicts(draftCriteria)){notify('Rezolva conflictul dintre includerile si excluderile teritoriale.','error');return;}if(!hasTargetGeography(draftCriteria)){notify('Selecteaza cel putin o tara sau regiune tinta.','error');return;}if(!hasSelectedRole(draftCriteria)){notify('Selecteaza cel putin o familie si o subfamilie pentru Retrieve.','error');return;}if(!hasSelectedWorkMode(draftCriteria)){notify('Selecteaza cel putin un mod de lucru pentru Retrieve.','error');return;}if(!hasSelectedContractType(draftCriteria)){notify('Selecteaza cel putin un tip de contract pentru Retrieve.','error');return;}setSaving(true);try{const result=await commandApi('/me/preferences',auth.token,{method:'PUT',body:JSON.stringify(preferencePatchFromCriteria(draftCriteria))});setSavedCriteria(draftCriteria);setCanonicalConfig(result?.preferences||canonicalConfig);const nextFilters={...filtersRef.current,freshness:filtersRef.current.freshness??draftCriteria.freshness};setFilters(nextFilters);await loadJobsPage(auth.token,draftCriteria,nextFilters);notify('Preferintele au fost salvate. Nu a fost pornit niciun Retrieve.','success');}catch(error){notify('Preferintele nu au putut fi salvate: '+error.message,'error');}finally{setSaving(false);}},[auth.token,saving,draftCriteria,notify,loadJobsPage,canonicalConfig]);

  const loadMoreJobs=useCallback(()=>{if(auth.token&&jobPage.nextCursor&&!jobPage.loadingMore)loadJobsPage(auth.token,savedCriteria,filtersRef.current,{cursor:jobPage.nextCursor,append:true}).catch(error=>notify('Pagina urmatoare nu a putut fi incarcata: '+error.message,'error'));},[auth.token,jobPage.nextCursor,jobPage.loadingMore,savedCriteria,loadJobsPage,notify]);
  const changeView=useCallback(next=>{setView(next);if(next!=='jobs')setKpiFilter('all');},[]);
  const openDetails=useCallback(job=>{detailScrollRef.current=window.scrollY;setDetailJob(job);},[]);
  const closeDetails=useCallback(()=>{setDetailJob(null);requestAnimationFrame(()=>window.scrollTo({top:detailScrollRef.current,behavior:'auto'}));},[]);

  if(auth.status!=='authenticated')return<><SignedOutScreen clientId={clientId} loginHint={loginHint} allowAutoRestore={allowAutoRestore} authError={auth.error} authStatus={auth.status} onCredential={handleCredential}/><EnvironmentMarker environment={environment} className="fixed left-4 top-4 z-50"/><Toast toast={toast}/></>;
  const onboarding=!profileConfigured&&(view==='jobs'||view==='review');
  return<div className="min-h-screen bg-slate-50"><ApplicationHeader email={auth.email} onLogout={logout} onDeleteAccount={()=>{setDeleteAccountConfirmation('');setDeleteAccountOpen(true);}} environment={environment}/><div className="md:flex"><Sidebar view={view} onView={changeView} counts={counts} runStatus={runStatus} role={auth.role}/><main className="min-w-0 flex-1 pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-0"><div className="mx-auto w-full max-w-[1400px] space-y-3 px-3 py-3 sm:space-y-5 sm:px-6 lg:px-8 lg:py-6"><Header view={view} running={running} onRun={runSearch} refreshDisabled={!profileConfigured} metrics={metrics}/>{auth.role==='ADMIN'&&<PromotionStatusPanel status={promotionStatus}/>} {auth.role==='ADMIN'&&<RunProgressPanel status={runStatus}/>} {dataState.status==='loading'&&<LoadingPanel/>}{dataState.status==='error'&&<ErrorPanel error={dataState.error} onRetry={retryData}/>} {dataState.status==='ready'&&<>{onboarding&&<OnboardingPanel onStart={()=>changeView('criteria')}/>} {!onboarding&&view==='jobs'&&<KPIGrid metrics={metrics} selected={kpiFilter} onSelect={setKpiFilter}/>} {!onboarding&&(view==='jobs'||view==='review')&&<Filters filters={filters} setFilters={setFilters} counts={quickCounts} defaultFreshness={savedCriteria.freshness} onResetKpi={()=>setKpiFilter('all')}/>} {(!onboarding&&(view==='jobs'||view==='review')||view==='applications')&&<JobTable rows={filteredRows} threshold={threshold} onDetails={openDetails} onReview={reviewJob} onArchive={archiveJob} onApply={applyJob} hasMore={view!=='applications'&&Boolean(jobPage.nextCursor)} loadingMore={jobPage.loadingMore} loading={jobPage.loading} onLoadMore={loadMoreJobs}/>} {view==='criteria'&&<CriteriaPage draft={draftCriteria} setDraft={setDraftCriteria} saved={savedCriteria} onSave={saveCriteria} onReset={()=>setDraftCriteria(savedCriteria)} saving={saving}/>} {view==='admin'&&auth.role==='ADMIN'&&<AdminShell sources={sources} setSources={setSources} sourceCategories={sourceCategories} setSourceCategories={setSourceCategories} runStatus={runStatus} runHistory={runHistory} running={running} onRun={runSearch} notify={notify} token={auth.token}/>}</>}</div></main></div><BottomNav view={view} onView={changeView} counts={counts} role={auth.role} onLogout={logout}/><DetailDrawer job={detailJob} threshold={threshold} onClose={closeDetails} onApply={applyJob}/>{deleteAccountOpen&&<ActionDialog title="Sterge definitiv contul" description="Aceasta actiune este ireversibila. Sesiunile si toate datele personale JSCC vor fi sterse; corpusul partajat de joburi ramane intact." fields={[{name:'confirmation',label:'Scrie STERGE pentru confirmare',autoFocus:true}]} values={{confirmation:deleteAccountConfirmation}} onChange={(name,value)=>{if(name==='confirmation')setDeleteAccountConfirmation(value);}} confirmLabel="Sterge definitiv" danger busy={deletingAccount} confirmDisabled={deleteAccountConfirmation!=='STERGE'} onCancel={()=>{setDeleteAccountOpen(false);setDeleteAccountConfirmation('');}} onConfirm={deleteCurrentAccount}/>}<Toast toast={toast}/></div>;
}

createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);