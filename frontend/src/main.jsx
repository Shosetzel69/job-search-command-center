import { FIT_CRITERIA, normalizeFitConfig } from '../../shared/fit-v2.mjs';
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
import { completionNotice, isActiveRunStatus, pollingDelayMs, terminalForBaseline, statusForTrackedRun, initialTrackedRun } from './run-polling.mjs';
import { runProgressModel } from './run-progress.mjs';
import { JOBS_PAGE_SIZE, JOBS_PAGE_SIZES, jobPageSize, buildJobsPath, ignorePageResponse, isSearchProfileConfigured, navigateJobPage, needsPageReload, pageRequestKey, scanResultCount, refreshOutcomeNotice, validateJobsPage } from './job-page-model.mjs';
import { clearUiState, readUiState, sanitizeUiState, writeUiState } from './ui-state.mjs';
import { registerPwa } from './pwa.mjs';
import { COOKIE_SESSION_BEARER, googleIdentityOptions, readGoogleLoginHint, rememberGoogleLoginHint } from './auth-session.mjs';
import { environmentBadge, releaseVersionLabel } from './environment-marker.mjs';
import { reviewRowsForFilters } from './review-selection.mjs';
import { jobCountScopeLabel, jobViewCounts, jobViewPopulation } from './job-count-model.mjs';
import { filterAndSortJobRows } from './job-row-filters.mjs';

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

async function fetchJson(path,token,signal) {
  const bearer = token && token !== COOKIE_SESSION_BEARER ? { Authorization:`Bearer ${token}` } : {};
  const response = await fetch(path,{ headers:bearer, cache:'no-store', credentials:'same-origin', signal });
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

function ageHours(value,fallback=null) {
  // API age is relative to the immutable first-page/cursor anchor.
  if(fallback != null && Number.isFinite(Number(fallback))) return Number(fallback);
  if(!value) return null;
  const ms=Date.now()-new Date(value).getTime();
  return Number.isFinite(ms) && ms>=0 ? Math.floor(ms/3600000) : null;
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
  quality:job.job_quality||null,fitMatrix:Array.isArray(job.fit_matrix)?job.fit_matrix:[],eligibilityState:job.eligibility_state||null,eligibilityReason:job.eligibility_reason||null,
  fit:job.fit!=null&&Number.isFinite(Number(job.fit))?Number(job.fit):null,location:job.location||'Nespecificat',countries,countryCodes:Array.isArray(job.country_codes)?job.country_codes:[],remoteScope:job.remote_scope||'Unknown',mode:normalizeMode(job.mode),type:job.type||'Nespecificat',contractType:job.contract_type||'unknown',employmentTypeRaw:job.employment_type_raw||null,age:ageHours(job.date_posted,job.age),
  remote:Boolean(job.remote),b2b:Boolean(job.b2b),repost:Boolean(job.repost),status:job.status||'review',pros:Array.isArray(job.pros)?job.pros:[],risks:Array.isArray(job.risks)?job.risks:[],url:job.url||null,
  description:String(job.description||'').trim(),date_posted:job.date_posted||null,retrieveDate:job.retrieve_date||null,publicationDate:job.publication_date||null,source:job.source||'Nespecificata',verified_at:job.verified_at||null,archivedAt:job.archived_at||null,isApplication:false,
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
    fitConfig:config?.fit_config??null,
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
function publishedLabel(job){if(job.isApplication)return job.date_posted?`aplicat ${job.date_posted}`:'aplicat';const age=ageHours(job.date_posted,job.age);if(age===null)return'data publicării necunoscută';if(age<1)return'sub 1h';if(age<24)return`${age}h`;const days=Math.floor(age/24),hours=age%24;return hours?`${days}z ${hours}h`:`${days}z`;}
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
  fitConfig:normalizeFitConfig(criteria.fitConfig??null),
  keepReposts:criteria.keepReposts!==false,
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
function Sidebar({view,onView,counts,runStatus,role,filters,setFilters,defaultFreshness}) {
  const items=[['jobs','Joburi noi','jobs',counts.jobs],['review','De evaluat','review',counts.review],['unclassified','Neclasificate','review',null],['applications','Aplicari','applications',counts.applications],['criteria','Criterii de selectie','criteria',null],...(role==='ADMIN'?[['admin','Administrare','admin',null]]:[])];
  const progress=runProgressModel(runStatus);
  const statusTone=runStatus?.status==='completed'?'bg-emerald-500':isActiveRunStatus(runStatus?.status)?'bg-blue-500':runStatus?.status==='completed_with_errors'?'bg-amber-500':'bg-slate-500';
  return <aside className="hidden bg-slate-950 text-slate-300 md:sticky md:top-14 md:flex md:h-[calc(100vh-3.5rem)] md:w-64 md:shrink-0 md:flex-col md:overflow-y-auto">
    <nav className="space-y-1 px-3 py-4">{items.map(([key,label,icon,count])=><button key={key} onClick={()=>onView(key)} className={cx('flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition',view===key?'bg-slate-800 text-white':'hover:bg-slate-900 hover:text-white')}><Icon name={icon}/><span>{label}</span>{count!==null&&<SidebarBadge value={count} active={view===key}/>}</button>)}</nav>
    {['jobs','review','unclassified'].includes(view)&&<div className="border-t border-slate-800 px-3 py-3"><h3 className="mb-3 text-xs font-semibold uppercase tracking-wide">Filtre</h3><ListingFilters filters={filters} setFilters={setFilters} defaultFreshness={defaultFreshness}/></div>}
    {role==='ADMIN'&&<div className="mt-auto border-t border-slate-800 p-4"><div className="flex items-center gap-2 text-xs text-slate-400"><span className={cx('h-2 w-2 rounded-full',statusTone)}/><span>{isActiveRunStatus(runStatus?.status)?'Rulare in curs':'Ultima rulare'}</span></div><div className="mt-1 text-xs text-slate-500">{formatRunTime(runStatus?.completed_at||runStatus?.started_at)} · {progress.active?`${progress.processed}/${progress.total} surse · ${progress.percent}%`:`${progress.processed} surse`}</div></div>}
  </aside>;
}

function BottomNav({view,onView,counts,role,onLogout}) {
  const[moreOpen,setMoreOpen]=useState(false);
  const primary=[['jobs','Joburi','jobs',counts.jobs],['review','Review','review',counts.review],['applications','Aplicari','applications',counts.applications]];
  const choose=key=>{setMoreOpen(false);onView(key);};
  const moreActive=['criteria','admin','unclassified'].includes(view);
  return <>
    {moreOpen&&<button type="button" aria-label="Inchide meniul More" onClick={()=>setMoreOpen(false)} className="fixed inset-0 z-40 bg-slate-950/20 md:hidden"/>}
    {moreOpen&&<section aria-label="Mai multe optiuni" className="safe-bottom fixed inset-x-3 bottom-[4.75rem] z-50 rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl md:hidden">
      <button type="button" onClick={()=>choose('unclassified')} className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50"><Icon name="review"/> Neclasificate</button>
      <button type="button" onClick={()=>choose('criteria')} className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50"><Icon name="criteria"/> Criterii de selectie</button>
      {role==='ADMIN'&&<button type="button" onClick={()=>choose('admin')} className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50"><Icon name="admin"/> Administrare</button>}
      <div className="my-1 border-t border-slate-100"/>
      <div className="px-3 py-2 text-xs text-slate-400">{APP_VERSION}</div>
      <button type="button" onClick={onLogout} className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-semibold text-slate-600 hover:bg-slate-50"><Icon name="logout"/> Deconecteaza</button>
    </section>}
    <nav aria-label="Navigatie principala" className="safe-bottom fixed inset-x-0 bottom-0 z-50 border-t border-slate-200 bg-white/95 px-1 pt-1 shadow-[0_-8px_24px_rgba(15,23,42,0.08)] backdrop-blur md:hidden">
      <div className="grid grid-cols-4 gap-1">
        {primary.map(([key,label,icon,count])=><button key={key} type="button" onClick={()=>choose(key)} aria-current={view===key?'page':undefined} className={cx('relative flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[10px] font-semibold',view===key?'bg-blue-50 text-blue-700':'text-slate-500')}><Icon name={icon} className="h-5 w-5"/><span className="max-w-full truncate">{label}</span>{count!==null&&<span className="absolute right-1 top-1 min-w-4 rounded-full bg-slate-100 px-1 text-[9px] text-slate-600">{count}</span>}</button>)}
        <button type="button" onClick={()=>setMoreOpen(v=>!v)} aria-expanded={moreOpen} title="Mai multe optiuni" aria-label="Mai multe optiuni" aria-haspopup="true" className={cx('flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[10px] font-semibold',moreOpen||moreActive?'bg-blue-50 text-blue-700':'text-slate-500')}><span aria-hidden="true" className="text-xl leading-none">•••</span><span>More</span></button>
      </div>
    </nav>
  </>;
}
function ProfileMenu({email,onLogout,onDeleteAccount}){const[open,setOpen]=useState(false),ref=useRef(null),triggerRef=useRef(null);const initial=(email||'G').slice(0,1).toUpperCase();useEffect(()=>{const handler=e=>{if(ref.current&&!ref.current.contains(e.target))setOpen(false)};document.addEventListener('mousedown',handler);return()=>document.removeEventListener('mousedown',handler);},[]);return<div className="relative" ref={ref} onKeyDown={event=>{if(event.key==='Escape'&&open){setOpen(false);triggerRef.current?.focus();}}}><button ref={triggerRef} type="button" aria-label="Meniu cont" title="Meniu cont" aria-haspopup="dialog" aria-controls="jscc-account-popover" aria-expanded={open} onClick={()=>setOpen(v=>!v)} className="flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-2.5 text-sm text-slate-700 shadow-sm transition hover:bg-slate-50"><span className="grid h-7 w-7 place-items-center rounded-full bg-slate-100 text-xs font-bold text-slate-700">{initial}</span><span className="hidden max-w-40 truncate lg:block">{email||'Google conectat'}</span><Icon name="chevronDown" className="h-4 w-4 text-slate-400"/></button>{open&&<div id="jscc-account-popover" role="dialog" aria-label="Optiuni cont" className="absolute right-0 z-50 mt-2 w-64 rounded-xl border border-slate-200 bg-white p-2 shadow-lg"><div className="px-3 py-2"><div className="text-xs font-medium uppercase tracking-wide text-slate-400">Cont conectat</div><div className="mt-1 truncate text-sm font-medium text-slate-800">{email||'Google'}</div></div><div className="my-1 border-t border-slate-100"/><button onClick={onLogout} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-600 hover:bg-slate-50 hover:text-slate-900"><Icon name="logout"/> Deconecteaza</button><button onClick={()=>{setOpen(false);onDeleteAccount();}} className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold text-red-600 hover:bg-red-50"><Icon name="trash"/> Sterge contul</button></div>}</div>;}
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
  const titles={jobs:'Joburi noi',review:'De evaluat',unclassified:'Neclasificate',applications:'Aplicari',criteria:'Criterii de selectie',admin:'Administrare'};
  const date=new Intl.DateTimeFormat('ro-RO',{weekday:'long',day:'numeric',month:'long',timeZone:'Europe/Bucharest'}).format(new Date()).toUpperCase();
  const summary=view==='jobs'&&metrics?`${metrics.jobs??"—"} noi · ${metrics.high??"—"} fit · ${metrics.remote??"—"} remote`:view==='review'&&metrics?`${metrics.high??"—"} fit ridicat · ${metrics.scope}`:'';
  return <header className="flex items-center justify-between gap-3">
    <div className="min-w-0"><div className="hidden text-xs font-semibold tracking-[0.16em] text-slate-400 sm:block">{date}</div><h1 className="truncate font-display text-xl font-bold tracking-tight text-slate-950 sm:mt-1 sm:text-2xl">{titles[view]}</h1>{summary&&<div className="mt-0.5 truncate text-xs font-medium text-slate-500 md:hidden">{summary}</div>}</div>
    {(view==='jobs'||view==='review'||view==='admin')&&<button onClick={onRun} disabled={running||refreshDisabled} className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-blue-600 px-3 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-11 sm:px-4 sm:text-sm"><Icon name="refresh" className={cx('h-4 w-4',running&&'animate-spin')}/><span className="hidden sm:inline">{running?'Actualizare...':'Actualizeaza joburile'}</span><span className="sm:hidden">{running?'...':'Refresh'}</span></button>}
  </header>;
}


function RunProgressPanel({status}) {
  if(!status)return null;
  const progress=runProgressModel(status);
  if(status?.status==='unavailable')return <section className="rounded-2xl border border-amber-200 bg-white p-4 text-sm text-slate-700" role="status">Starea actualizarii nu este confirmata. Reincarca datele pentru verificare.</section>;
  if(!progress.active&&!progress.terminal)return null;
  const title=progress.active?'Actualizare joburi in curs':status?.status==='completed'?'Ultima actualizare finalizata':status?.status==='completed_with_errors'?'Ultima actualizare cu erori':'Ultima actualizare esuata';
  return <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" aria-label="Progres actualizare surse">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><div className="text-sm font-semibold text-slate-900">{title}</div><div className="mt-1 text-xs text-slate-500">{progress.active&&progress.total===0?'Se pregateste rularea...':<>{progress.processed} din {progress.total} surse planificate procesate</>}</div></div>
      <div className="text-2xl font-bold tabular-nums text-slate-950">{progress.percent}%</div>
    </div>
    <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-blue-600 transition-[width] duration-500" style={{width:`${progress.percent}%`}}/></div>
    <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold">
      <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-700">GOOD {progress.good}</span>
      <span className="rounded-full bg-red-50 px-2.5 py-1 text-red-700">FAIL {progress.failed}</span>
      {progress.skipped>0&&<span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600">SKIP {progress.skipped}</span>}
      {progress.preflightSkipped>0&&<span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600">SKIP CONFIG {progress.preflightSkipped}</span>}
      {progress.blocked>0&&<span className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-700">BLOCKED {progress.blocked}</span>}
      {progress.noExtractable>0&&<span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600">FARA EXTRACTIE {progress.noExtractable}</span>}
      {progress.partial>0&&<span className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-700">PARTIAL {progress.partial}</span>}
      {progress.terminal&&<span className="rounded-full bg-blue-50 px-2.5 py-1 text-blue-700">JOBURI {progress.jobsPublished}</span>}
    </div>
  </section>;
}

function MetricCard({value,label,note,icon,tone='blue',active,onClick}){const tones={blue:'bg-blue-50 text-blue-600',amber:'bg-amber-50 text-amber-600',violet:'bg-violet-50 text-violet-600',slate:'bg-slate-100 text-slate-600'};return<button onClick={onClick} className={cx('w-full rounded-2xl border bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md',active?'border-blue-400 ring-4 ring-blue-50':'border-slate-200')}><div className="flex items-start gap-3"><span className={cx('grid h-9 w-9 place-items-center rounded-xl',tones[tone])}><Icon name={icon}/></span><div><div className="text-2xl font-bold leading-none text-slate-950">{value??"—"}</div><div className="mt-1 text-sm text-slate-600">{label}</div><div className="mt-1 text-xs text-slate-400">{note}</div></div></div></button>;}
function MobileKpiChip({value,label,active,onClick}){return<button type="button" onClick={onClick} className={cx('min-w-[7rem] rounded-xl border px-3 py-2 text-left shadow-sm',active?'border-blue-300 bg-blue-50':'border-slate-200 bg-white')}><span className="block text-lg font-bold leading-none text-slate-950">{value??"—"}</span><span className="mt-1 block text-[11px] font-medium text-slate-500">{label}</span></button>;}
function KPIGrid({metrics,selected,onSelect}){const toggle=key=>onSelect(selected===key?'all':key);return<>
  <section aria-label="Rezumat joburi" className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1 md:hidden">
    <MobileKpiChip value={metrics.jobs} label="noi" active={selected==='new'} onClick={()=>toggle('new')}/>
    <MobileKpiChip value={metrics.high} label="fit ridicat" active={selected==='high'} onClick={()=>toggle('high')}/>
    <MobileKpiChip value={metrics.remote} label="remote" active={selected==='remote'} onClick={()=>toggle('remote')}/>
    <MobileKpiChip value={metrics.reposts} label="repostari" active={selected==='repost'} onClick={()=>toggle('repost')}/>
  </section>
  <section className="hidden gap-3 sm:grid-cols-2 md:grid xl:grid-cols-4"><MetricCard value={metrics.jobs} label="roluri noi" note="ultimele 24h din filtrul curent" icon="jobs" active={selected==='new'} onClick={()=>toggle('new')}/><MetricCard value={metrics.high} label="fit ridicat" note={`>= ${metrics.threshold}% · ${metrics.scope}`} icon="review" tone="slate" active={selected==='high'} onClick={()=>toggle('high')}/><MetricCard value={metrics.reposts} label="repostari" note={metrics.scope} icon="refresh" tone="amber" active={selected==='repost'} onClick={()=>toggle('repost')}/><MetricCard value={metrics.remote} label="remote" note={metrics.scope} icon="globe" tone="violet" active={selected==='remote'} onClick={()=>toggle('remote')}/></section>
</>;}
function ListingFilters({filters,setFilters,defaultFreshness}) {
  const roles=ROLE_FAMILIES.flatMap(f=>f.subfamilies.map(s=>[s.code,s.label]));
  const update=(key,value)=>setFilters(v=>({...v,[key]:value}));
  const multi=(label,key,options,noneFlag)=>{
    const stored=filters[key]||[];
    const all=options.map(([code])=>code);
    const selected=filters[noneFlag]?[]:stored.length===0?all:stored;
    const allSelected=selected.length===all.length&&all.every(code=>selected.includes(code));
    const choose=next=>{const full=next.length===all.length&&all.every(code=>next.includes(code));setFilters(current=>({...current,[key]:full?[]:next,[noneFlag]:next.length===0}));};
    return <fieldset className="min-w-0"><legend className="text-xs font-semibold">{label}</legend><details className="mt-1 rounded border border-slate-400/40 p-2 text-xs"><summary className="cursor-pointer">{allSelected?'Toate':selected.length?selected.length+' selectate':'Niciuna'}</summary><div className="mt-2 max-h-40 space-y-1 overflow-y-auto">{options.map(([code,name])=><label key={code} className="flex items-start gap-2"><input type="checkbox" checked={selected.includes(code)} onChange={e=>choose(e.target.checked?[...selected,code]:selected.filter(v=>v!==code))}/>{name}</label>)}</div><button type="button" className="mt-2 underline" onClick={()=>choose(allSelected?[]:all)}>{allSelected?'Deselecteaza toate':'Selecteaza toate'}</button></details></fieldset>;
  };
  return <div className="space-y-3 text-sm">
    {multi('Roluri individuale','roleSubfamilies',roles,'roleSubfamiliesNone')}
    <fieldset><legend className="text-xs font-semibold">Mod de lucru</legend><button type="button" className="mb-2 block text-xs underline" onClick={()=>update('workModes',filters.workModes.length===ALL_WORK_MODES.length?[]:[...ALL_WORK_MODES])}>{filters.workModes.length===ALL_WORK_MODES.length?'Deselecteaza toate':'Selecteaza toate'}</button>{ALL_WORK_MODES.map(mode=><label key={mode} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={filters.workModes.includes(mode)} onChange={e=>update('workModes',e.target.checked?[...filters.workModes,mode]:filters.workModes.filter(v=>v!==mode))}/>{mode}</label>)}</fieldset>
    {multi('Tip contract','contractTypes',CONTRACT_TYPE_OPTIONS,'contractTypesNone')}
    <label className="block text-xs font-semibold">FIT minim<select aria-label="FIT minim" value={filters.minFit??''} onChange={e=>update('minFit',e.target.value)} className="mt-1 w-full rounded border border-slate-400/40 bg-white p-2 text-slate-800"><option value="">Toate</option>{Array.from({length:21},(_,i)=>i*5).map(n=><option key={n} value={n}>{n}%</option>)}</select></label>
    <label className="block text-xs font-semibold">Vechime job<select value={filters.freshness} onChange={e=>update('freshness',Number(e.target.value))} className="mt-1 w-full rounded border border-slate-400/40 bg-white p-2 text-slate-800">{[[24,'24h'],[36,'36h'],[48,'48h'],[120,'5 zile'],[720,'30 zile']].map(([n,label])=><option key={n} value={n}>{label}</option>)}</select></label>
    <button type="button" onClick={()=>setFilters(v=>({...v,roleSubfamilies:[],roleSubfamiliesNone:false,contractTypes:[],contractTypesNone:false,minFit:'',workModes:[...ALL_WORK_MODES],freshness:defaultFreshness||24,search:'',quick:'all'}))} className="text-xs underline">Reseteaza filtrele</button>
  </div>;
}
function Filters({filters,setFilters,defaultFreshness,onResetKpi}) {
  const[mobileOpen,setMobileOpen]=useState(false);
  const reset=()=>{setFilters({search:'',quick:'all',freshness:defaultFreshness||24,workModes:[...ALL_WORK_MODES],roleSubfamilies:[],roleSubfamiliesNone:false,contractTypes:[],contractTypesNone:false,minFit:'',sort:'fit-desc',pageSize:jobPageSize(filters.pageSize)});onResetKpi?.();};
  const secondaryCount=(filters.freshness!==(defaultFreshness||24)?1:0)+(filters.workModes.length!==ALL_WORK_MODES.length?1:0)+(filters.sort!=='fit-desc'?1:0)+(filters.roleSubfamilies?.length||filters.roleSubfamiliesNone?1:0)+(filters.contractTypes?.length||filters.contractTypesNone?1:0)+(filters.minFit!==''&&filters.minFit!=null?1:0);
  return <>
    <div className="sticky top-14 z-30 -mx-3 border-y border-slate-200 bg-slate-50/95 px-3 py-2 backdrop-blur md:static md:mx-0 md:rounded-2xl md:border md:bg-white md:p-0 md:shadow-sm">
      <div className="flex gap-2 md:border-b md:border-slate-100 md:p-4">
        <label className="relative min-w-0 flex-1"><Icon name="search" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"/><input value={filters.search} onChange={e=>setFilters(v=>({...v,search:e.target.value}))} type="search" placeholder="Cauta joburi..." className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-3 text-sm text-slate-800 outline-none md:h-11 md:bg-slate-50"/></label>
        <button type="button" aria-haspopup="dialog" aria-expanded={mobileOpen} aria-controls="jscc-mobile-filters" onClick={()=>setMobileOpen(true)} className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 md:hidden">Filtre{secondaryCount>0&&<span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] text-blue-700">{secondaryCount}</span>}</button>
      </div>
      
    </div>
    {mobileOpen&&<><button type="button" aria-label="Inchide filtrele" className="fixed inset-0 z-[70] bg-slate-950/30 md:hidden" onClick={()=>setMobileOpen(false)}/><section id="jscc-mobile-filters" role="dialog" aria-modal="true" aria-label="Filtre afisare" className="safe-bottom fixed inset-x-0 bottom-0 z-[80] rounded-t-3xl bg-white p-4 shadow-2xl md:hidden">
      <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-200"/>
      <div className="flex items-center justify-between"><div><div className="flex items-center gap-2"><h2 className="font-display text-lg font-bold text-slate-950">Filtre</h2><ScopeBadge scope="GUI ONLY"/></div><p className="mt-0.5 text-xs text-slate-400" title="Filtrele de afisare nu pornesc Retrieve si nu apeleaza provideri.">Mod lucru: Toate include si N/A · doar afisare</p></div><button type="button" aria-label="Inchide filtrele" title="Inchide filtrele" onClick={()=>setMobileOpen(false)} className="grid min-h-11 min-w-11 place-items-center rounded-xl text-slate-500"><Icon name="close"/></button></div>
      <div className="mt-4 max-h-[60vh] overflow-y-auto"><ListingFilters filters={filters} setFilters={setFilters} defaultFreshness={defaultFreshness}/></div>
      <div className="mt-5 grid grid-cols-2 gap-2"><button type="button" onClick={reset} className="min-h-11 rounded-xl border border-slate-200 font-semibold text-slate-600">Reseteaza</button><button type="button" onClick={()=>setMobileOpen(false)} className="min-h-11 rounded-xl bg-blue-600 font-semibold text-white">Aplica</button></div>
    </section></>}
  </>;
}
function FitBadge({fit,threshold}){if(fit===null||fit===undefined)return<span className="text-sm text-slate-400">—</span>;return<span className={cx('inline-flex min-w-12 justify-center rounded-full px-2 py-1 text-xs font-semibold',fit>=threshold?'bg-blue-50 text-blue-700':'bg-slate-100 text-slate-600')}>{fit}%</span>;}
function ModeBadge({mode}){const tone=mode==='Remote'?'bg-violet-50 text-violet-700':mode==='Hybrid'?'bg-amber-50 text-amber-700':'bg-slate-100 text-slate-600';return<span className={cx('inline-flex rounded-full px-2 py-1 text-xs font-medium',tone)}>{mode==='Hybrid'?'Hibrid':mode}</span>;}
function knownCompact(value){const text=String(value||'').trim();return text&&!['n/a','nespecificat','unknown','companie nespecificata'].includes(text.toLowerCase())?text:null;}
function MobileOverflow({job,onArchive}){return<details className="relative"><summary aria-label="Mai multe actiuni" title="Mai multe actiuni" className="flex min-h-11 min-w-11 cursor-pointer list-none items-center justify-center rounded-xl border border-slate-200 bg-white text-lg font-bold text-slate-500">•••</summary><div className="absolute bottom-12 right-0 z-20 w-44 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl">{!job.isApplication&&<button type="button" onClick={()=>onArchive(job)} className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-sm font-medium text-slate-600 hover:bg-slate-50"><Icon name="archive"/> Arhiveaza</button>}</div></details>;}
function displayJobDate(value){
  if(!value)return '—';
  if(/^\d{4}-\d{2}-\d{2}$/.test(value))return value.split('-').reverse().join('.');
  const date=new Date(value);
  return Number.isFinite(date.getTime())?date.toLocaleString('ro-RO',{dateStyle:'short',timeStyle:'short'}):'—';
}
function JobTable({rows,threshold,onDetails,onArchive,onApply,hasMore=false,loadingMore=false,loading=false,paginate=false,page=1,onPrevious=null,onNext=null,pageSize=20,onPageSize=null,totalPages=null,sort='fit-desc',onSort=null,orderStatus=null,pending=null}) {
  if(!rows.length&&!loading&&!paginate)return<div className="rounded-2xl border border-slate-200 bg-white px-6 py-14 text-center text-sm text-slate-500 shadow-sm">Niciun rezultat.</div>;
  const controls=(position)=><nav aria-label={'Navigare pagini joburi '+position} className="flex flex-wrap items-center justify-between gap-2 border-y border-slate-100 bg-slate-50 px-4 py-2 text-xs text-slate-600">
    <label>Inregistrari/pagina <select aria-label={'Inregistrari pe pagina '+position} value={pageSize} disabled={loading||loadingMore} onChange={e=>onPageSize?.(Number(e.target.value))} className="ml-1 rounded-md border border-slate-200 bg-white p-2">{JOBS_PAGE_SIZES.map(n=><option key={n} value={n}>{n}</option>)}</select></label>
    <div className="flex items-center gap-2"><button type="button" disabled={loading||loadingMore||page===1} onClick={onPrevious} className="min-h-11 rounded-xl border border-slate-200 bg-white px-3 font-semibold disabled:opacity-50">Anterioara</button>
    <span title={totalPages==null?'Totalul global nu este inca disponibil':undefined}>{page}/{totalPages??'?'}</span>
    <button type="button" disabled={loading||loadingMore||!hasMore} onClick={onNext} className="min-h-11 rounded-xl border border-slate-200 bg-white px-3 font-semibold disabled:opacity-50">Urmatoarea</button></div>
  </nav>;
  return <div data-testid="job-table" className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
    {paginate&&controls("sus")}
    <div className="hidden xl:grid-cols-[minmax(10rem,1fr)_90px_55px_75px_112px_112px_180px] 2xl:grid-cols-[minmax(10rem,1fr)_90px_56px_80px_112px_112px_400px] gap-3 border-b border-slate-100 bg-slate-50 px-5 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400 xl:grid">{[['title','Rol'],['country','Tara'],['fit','Fit'],['work_mode','Mod lucru'],['publication','Publication Date'],['retrieve','Retrieve Date']].map(([key,label])=><div key={key} role="columnheader" aria-sort={sort===key+'-asc'?'ascending':sort===key+'-desc'?'descending':'none'}><button type="button" disabled={!paginate} onClick={()=>onSort?.(key+(sort===key+'-asc'?'-desc':'-asc'))} className="text-left">{label}{sort===key+'-asc'?' ↑':sort===key+'-desc'?' ↓':''}</button></div>)}<span className="text-right">Actiuni</span></div>
    {paginate&&<div className="border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs text-slate-600"><label className="xl:hidden block">Sortare globala <select value={sort} onChange={e=>onSort?.(e.target.value)}>{[['title','Rol'],['country','Tara'],['fit','FIT'],['work_mode','Mod lucru'],['publication','Publicare'],['retrieve','Retrieve']].flatMap(([key,label])=>['asc','desc'].map(dir=><option key={key+'-'+dir} value={key+'-'+dir}>{label} {dir==='asc'?'↑':'↓'}</option>))}</select></label><p>Filtrele se aplica tuturor rezultatelor.</p>{orderStatus==='PROVISIONAL'&&<p role="status">Se actualizeaza ordonarea. {pending??'—'} evaluari in asteptare; totalul nu este inca disponibil.</p>}</div>}
    {!rows.length&&!loading&&<div role="status" className="px-4 py-10 text-center text-sm text-slate-600">Nicio potrivire pe aceasta pagina. Verifica filtrele sau navigheaza la alta pagina.</div>}
    <div>{rows.map((job,index)=><article data-testid="job-row" key={jobKey(job)} className={cx('border-b border-slate-100 px-3 py-3 transition last:border-b-0 xl:grid xl:grid-cols-[minmax(10rem,1fr)_90px_55px_75px_112px_112px_180px] 2xl:grid-cols-[minmax(10rem,1fr)_90px_56px_80px_112px_112px_400px] xl:items-center xl:gap-3 xl:px-5 xl:py-3',index%2===0?'bg-white':'bg-slate-100','hover:bg-blue-50')}>
      <button data-testid="job-role" type="button" onClick={()=>onDetails(job)} className="block w-full min-w-0 overflow-hidden text-left xl:flex xl:items-start xl:gap-3">
        <span className="hidden h-10 w-10 shrink-0 place-items-center rounded-xl bg-slate-100 text-xs font-bold text-slate-600 xl:grid">{job.initial}</span>
        <span className="block min-w-0">
          <span className="flex items-start justify-between gap-3"><span className="line-clamp-2 text-[15px] font-semibold leading-5 text-slate-950 xl:block xl:truncate xl:text-sm">{job.title}{job.quality&&job.quality.verdict!=='VALID'&&job.quality.issues?.length>0&&<span className="ml-1 text-amber-700" title={job.quality.issues.join(", ")} aria-label={"Atentie: "+job.quality.issues.join(", ")}> ⚠</span>}</span><span className="shrink-0 xl:hidden"> <FitBadge fit={job.fit} threshold={threshold}/></span></span>
          <span className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 overflow-hidden text-xs text-slate-600"><span className="truncate">{knownCompact(job.company)||'Companie'}</span>{knownCompact(job.location)&&<><span>·</span><span className="truncate">{job.location}</span></>}{knownCompact(job.mode)&&<><span>·</span><span>{job.mode==='Hybrid'?'Hibrid':job.mode}</span></>}<span>·</span><span>{job.isApplication?publishedLabel(job):"Publicat: "+displayJobDate(job.publicationDate)}</span>{!job.isApplication&&<span>Retrieve: {displayJobDate(job.retrieveDate)}</span>}{job.repost&&<span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-amber-700">Repost</span>}</span>
        </span>
      </button>
      <div className="hidden min-w-0 text-xs xl:contents"><div className="min-w-0 truncate font-medium text-slate-600" title={countryCompact(job)}>{countryCompact(job)}</div><div><FitBadge fit={job.fit} threshold={threshold}/></div><div>{knownCompact(job.mode)?<ModeBadge mode={job.mode}/>:<span className="text-slate-300">—</span>}</div><div data-testid="job-published" className="min-w-0 truncate font-medium text-slate-600" title={publishedLabel(job)}>{job.isApplication?publishedLabel(job):displayJobDate(job.publicationDate)}</div><div data-testid="job-retrieved" className="min-w-0 truncate text-slate-600" title={displayJobDate(job.retrieveDate)}>{displayJobDate(job.retrieveDate)}</div></div>
      <div data-testid="job-card-actions" className="mt-3 flex min-w-0 items-center gap-2 xl:hidden" onClick={event=>event.stopPropagation()}>
        
        {job.url&&<a role="button" title="Aplica la job" aria-label="Aplica la job" href={job.url} target="_blank" rel="noopener noreferrer" onClick={()=>onApply(job)} className="inline-flex min-h-11 min-w-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-blue-600 px-3 text-xs font-semibold text-white md:flex-none md:px-2"><Icon name="external"/><span className="md:hidden">Aplica</span></a>}
        {!job.isApplication&&<MobileOverflow job={job} onArchive={onArchive}/>}
      </div>
      <div data-testid="job-actions" className="hidden min-w-0 items-center justify-end gap-1 xl:flex 2xl:gap-2" onClick={event=>event.stopPropagation()}>
        <button type="button" title="Detalii job" aria-label="Detalii job" onClick={()=>onDetails(job)} className="inline-flex min-h-10 min-w-10 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-slate-200 px-2 text-xs font-semibold text-slate-600 2xl:px-3"><Icon name="eye"/><span className="hidden 2xl:inline">Detalii</span></button>
        
        {job.url&&<a role="button" title="Aplica la job" aria-label="Aplica la job" href={job.url} target="_blank" rel="noopener noreferrer" onClick={()=>onApply(job)} className="inline-flex min-h-10 min-w-10 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-blue-600 px-2 text-xs font-semibold text-white 2xl:px-3"><Icon name="external"/><span className="hidden 2xl:inline">Aplica</span></a>}
        {!job.isApplication&&<button type="button" title="Arhiveaza job" aria-label="Arhiveaza job" onClick={()=>onArchive(job)} className="inline-flex min-h-10 min-w-10 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-slate-200 px-2 text-xs font-semibold text-slate-600 2xl:px-3"><Icon name="archive"/><span className="hidden 2xl:inline">Arhiveaza</span></button>}
      </div>
    </article>)}</div>
    <div className="flex flex-col gap-2 border-t border-slate-100 bg-slate-50 px-4 py-3 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
      <span aria-live="polite">{loading?'Se actualizeaza lista...':paginate?rows.length+' rezultate pe pagina '+page:rows.length+' rezultate'}</span>

    </div>
    {paginate&&controls('jos')}
  </div>;
}
function ErrorPanel({error,onRetry}){return<div className="rounded-2xl border border-red-200 bg-white p-6 shadow-sm"><div className="flex items-start gap-4"><span className="grid h-10 w-10 place-items-center rounded-xl bg-red-50 text-red-600"><Icon name="alert"/></span><div><h2 className="font-display font-bold text-slate-900">Datele nu au putut fi incarcate</h2><p className="mt-1 text-sm text-slate-600">{error?.message||'Eroare necunoscuta'}</p><button onClick={onRetry} className="mt-4 inline-flex h-9 items-center gap-2 rounded-xl border border-slate-200 px-3 text-sm font-semibold"><Icon name="retry"/> Reincearca</button></div></div></div>;}
function LoadingPanel(){return<div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><div className="flex items-center gap-3 text-sm text-slate-500"><span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-blue-600"/> Se incarca datele protejate...</div></div>;}
function DetailDrawer({job,threshold,onClose,onApply}) {
  if(!job)return null;
  return <><button className="fixed inset-0 z-50 bg-slate-950/25" onClick={onClose} aria-label="Inchide detaliile"/><aside className="fixed inset-0 z-[60] overflow-y-auto bg-white shadow-2xl md:inset-y-0 md:left-auto md:right-0 md:w-full md:max-w-xl md:border-l md:border-slate-200">
    <div className="safe-top sticky top-0 flex items-center justify-between border-b border-slate-100 bg-white px-3 py-2 sm:px-6 sm:py-3"><button type="button" onClick={onClose} className="inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"><span aria-hidden="true">←</span><span className="md:hidden">Inapoi</span><span className="hidden text-xs uppercase tracking-wide text-slate-400 md:inline">Detalii job</span></button><button onClick={onClose} aria-label="Inchide detaliile" className="hidden min-h-11 min-w-11 place-items-center rounded-lg hover:bg-slate-100 md:grid"><Icon name="close"/></button></div>
    <div className="space-y-6 p-4 pb-24 sm:p-6"><div><h2 className="font-display text-2xl font-bold text-slate-950">{job.url?<a href={job.url} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline">{job.title} ↗</a>:job.title}</h2>{!job.isApplication&&<FitMatrix matrix={job.fitMatrix} fit={job.fit}/>}<p className="mt-1 text-sm text-slate-500">{job.company}</p></div><div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><div className="rounded-xl bg-slate-50 p-3"><div className="text-xs text-slate-400">Mod lucru</div><div className="mt-1"><ModeBadge mode={job.mode}/></div></div><div className="rounded-xl bg-slate-50 p-3"><div className="text-xs text-slate-400">Locatie</div><div className="mt-1 text-sm font-medium text-slate-700">{job.location}</div></div><div className="rounded-xl bg-slate-50 p-3"><div className="text-xs text-slate-400">Tara / tari</div><div className="mt-1 text-sm font-medium text-slate-700">{job.countries?.length?job.countries.join(', '):'Nespecificat'}</div></div><div className="rounded-xl bg-slate-50 p-3"><div className="text-xs text-slate-400">Tip contract</div><div className="mt-1 text-sm font-medium text-slate-700">{job.type||'Nespecificat'}</div></div><div className="rounded-xl bg-slate-50 p-3"><div className="text-xs text-slate-400">Sursa</div><div className="mt-1 text-sm font-medium text-slate-700">{job.source}</div></div>{!job.isApplication&&<><div className="rounded-xl bg-slate-50 p-3"><div className="text-xs text-slate-400">Publication Date</div><div>{displayJobDate(job.publicationDate)}</div></div><div className="rounded-xl bg-slate-50 p-3"><div className="text-xs text-slate-400">Retrieve Date</div><div>{displayJobDate(job.retrieveDate)}</div></div></>}{job.remote&&<div className="rounded-xl bg-slate-50 p-3"><div className="text-xs text-slate-400">Scope Remote</div><div className="mt-1 text-sm font-medium text-slate-700">{job.remoteScope}</div></div>}</div>{!job.isApplication&&job.eligibilityState&&<p className="rounded border p-3 text-sm text-slate-600">Eligibilitate: {job.eligibilityState}{job.eligibilityReason?' · '+job.eligibilityReason:''} (informativ)</p>} {job.pros?.length>0&&<div><h3 className="text-sm font-semibold text-slate-900">Puncte forte</h3><ul className="mt-2 space-y-2 text-sm text-slate-600">{job.pros.map((x,i)=><li key={i}>• {x}</li>)}</ul></div>}{job.risks?.length>0&&<div><h3 className="text-sm font-semibold text-slate-900">Riscuri</h3><ul className="mt-2 space-y-2 text-sm text-slate-600">{job.risks.map((x,i)=><li key={i}>• {x}</li>)}</ul></div>}<div><h3 className="text-sm font-semibold text-slate-900">Descriere</h3><div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-600">{job.description||'Descriere indisponibila.'}</div></div>{job.url&&<a role="button" href={job.url} target="_blank" rel="noopener noreferrer" onClick={()=>onApply?.(job)} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white">Deschide jobul <Icon name="external"/></a>}</div>
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
const FIT_LABELS={compensation:'Compensatie',work_mode:'Mod de lucru',contract_type:'Tip contract',industry:'Industrie',career:'Oportunitati de cariera',company:'Companie / mediu'};
function FitProfileEditor({value,onChange}){
  const update=(key,patch)=>onChange({...value,[key]:{...value[key],...patch}});
  const total=value?FIT_CRITERIA.reduce((n,key)=>n+(value[key]?.weight||0),0):0;
  return <CriteriaCard title="FIT profesional" scope="PROFIL" note="Ponderi total 100%. Note 0–5. Date lipsa: 0. Fara configuratie, FIT nu se calculeaza.">
    {!value?<button type="button" className="rounded-xl border px-3 py-2" onClick={()=>onChange(Object.fromEntries(FIT_CRITERIA.map(key=>[key,{weight:0}])))}>Configureaza FIT</button>:<>
      {FIT_CRITERIA.map(key=><div key={key} className="rounded-xl border p-3 space-y-2"><label className="flex items-center justify-between gap-2"><span>{FIT_LABELS[key]}</span><input aria-label={'Pondere '+FIT_LABELS[key]} type="range" min="0" max="100" step="5" value={value[key]?.weight??0} onChange={e=>update(key,{weight:Number(e.target.value)})} className="w-32 accent-blue-600"/><output className="w-12 text-right">{value[key]?.weight??0}%</output></label>{(value[key]?.weight??0)%5!==0&&<p className="text-xs text-amber-700">{value[key].weight}% — ajusteaza la multiplu de 5</p>}
      {key==='compensation'?<p className="text-xs text-slate-500">5 daca suma este specificata; altfel 0.</p>:value[key]?.weight>0&&<FitRatingsEditor ratings={value[key]?.ratings||{}} onChange={ratings=>update(key,{ratings})} criterion={key}/>}</div>)}
      <p role="status" className={total===100?'text-green-700':'text-red-700'}>Total ponderi: {total}%</p><button type="button" className="rounded border px-3 py-2" onClick={()=>onChange(null)}>Dezactiveaza FIT</button>
    </>}
  </CriteriaCard>;
}
function FitRatingsEditor({ratings,onChange,criterion}){
  const [label,setLabel]=useState(''),[grade,setGrade]=useState(5);
  const choices=criterion==='work_mode'?['remote','hybrid','onsite']:criterion==='contract_type'?['permanent','temporary','contract','freelance']:null;
  return <div className="space-y-2">{Object.entries(ratings).map(([key,score])=><div key={key} className="flex items-center gap-2"><span className="flex-1 break-all">{key}</span><input type="range" min="0" max="5" step="1" aria-label={'Nota '+key} value={score} onChange={e=>onChange({...ratings,[key]:Number(e.target.value)})}/><output>{score}/5</output><button type="button" aria-label={'Elimina '+key} onClick={()=>onChange(Object.fromEntries(Object.entries(ratings).filter(([k])=>k!==key)))}>×</button></div>)}
  <div className="flex flex-wrap gap-2">{choices?<select aria-label="Preferinta" value={label} onChange={e=>setLabel(e.target.value)}><option value="">Selecteaza</option>{choices.map(x=><option key={x}>{x}</option>)}</select>:<input aria-label="Preferinta" value={label} maxLength={160} placeholder="Valoare exacta din anunt" onChange={e=>setLabel(e.target.value)} className="min-w-0 flex-1 rounded border p-2"/>}<select aria-label="Nota preferintei" value={grade} onChange={e=>setGrade(Number(e.target.value))}>{[0,1,2,3,4,5].map(n=><option key={n}>{n}</option>)}</select><button type="button" disabled={!label.trim()} onClick={()=>{onChange({...ratings,[label.normalize('NFKC').trim().toLowerCase()]:grade});setLabel('');}} className="rounded border px-2">Adauga</button></div></div>;
}
function FitMatrix({matrix,fit}){
  if(!Array.isArray(matrix)||matrix.length===0)return <section className="rounded-xl border p-3" aria-label="Matrice FIT"><h3 className="font-semibold">Matrice FIT</h3><p className="mt-2 text-sm">FIT necalculat.</p></section>;
  const rows=FIT_CRITERIA.map(key=>matrix.find(row=>row.criterion===key)).filter(Boolean);
  const totalWeight=rows.reduce((sum,row)=>sum+(Number(row.weight)||0),0);
  const reasonLabel={MISSING_DATA:'Date lipsa',NO_MATCH:'Nu corespunde',MATCH:'Preferinta confirmata',DISABLED:'Criteriu dezactivat'};
  return <section className="rounded-xl border p-3" aria-label="Matrice FIT">
    <h3 className="font-semibold">Matrice FIT</h3>
    <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {rows.map(row=><div key={row.criterion} className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm"><strong className="block text-slate-800">{FIT_LABELS[row.criterion]||row.criterion}</strong><p className="mt-1">Pondere {row.weight}% · Nota {row.grade}/5 · {row.points} puncte</p><meter className="mt-2 w-full" min={0} max={5} value={row.grade} aria-label={FIT_LABELS[row.criterion]||row.criterion}/><p className="mt-1 text-xs text-slate-600">{reasonLabel[row.reason]||row.reason}</p></div>)}
      <div className="rounded-lg border border-slate-200 p-3 text-sm"><strong>FIT total</strong><p>{fit==null?'—':fit+'%'}</p></div>
      <div className="rounded-lg border border-slate-200 p-3 text-sm"><strong>Total ponderi</strong><p>{totalWeight}%</p></div>
      <div className="rounded-lg border border-slate-200 p-3 text-sm"><strong>Stare evaluare</strong><p>{fit==null?'Necalculat':'Calculat'}</p></div>
    </div>
  </section>;
}

function CriteriaPage({draft,setDraft,saved,onSave,onReset,saving}){
  const dirty=JSON.stringify(draft)!==JSON.stringify(saved);
  const update=(key,value)=>setDraft(v=>({...v,[key]:value}));
  const addExclusion=value=>{if(value&&!draft.exclusions.includes(value))update('exclusions',[...draft.exclusions,value])};
  const removeExclusion=value=>update('exclusions',draft.exclusions.filter(x=>x!==value));
  const conflict=geographyConflicts(draft);
  const missingTarget=!hasTargetGeography(draft);
  const missingRole=!hasSelectedRole(draft);
  const tooManyRoleFamilies=(draft.roleFamilies||[]).length>2;
  let invalidFit=false;try{normalizeFitConfig(draft.fitConfig??null);}catch{invalidFit=true;}
  const invalidRetrieve=conflict||missingTarget||missingRole||tooManyRoleFamilies;
  return <div className="space-y-5">
    <section className="rounded-2xl border border-blue-200 bg-blue-50 p-4">
      <div className="flex flex-wrap items-center gap-2"><h2 className="font-display text-base font-bold text-slate-900">Criterii Retrieve</h2><ScopeBadge scope="RETRIEVE"/></div>
      <p className="mt-1 text-sm text-slate-600">Aceste criterii definesc urmatorul Retrieve bounded, fara a ascunde joburi deja colectate. Modul de lucru, contractul si compania se configureaza in FIT. Salvarea singura nu porneste Retrieve.</p>
    </section>
    <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
      <CriteriaCard title="Jobs Families" scope="RETRIEVE" note="Selecteaza familia de joburi si subfamiliile care definesc scope-ul de cautare.">
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
      <CriteriaCard title="Excluderi" scope="RETRIEVE">
        <select defaultValue="" onChange={e=>{addExclusion(e.target.value);e.target.value='';}} className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"><option value="">Adauga excludere</option>{EXCLUSION_SUGGESTIONS.map(x=><option key={x}>{x}</option>)}</select>
        <div className="flex flex-wrap gap-2">{draft.exclusions.map(x=><button key={x} onClick={()=>removeExclusion(x)} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs">{x} ×</button>)}</div>
        <RegionSelector label="Regiuni excluse" values={draft.excludedRegions} onChange={v=>update('excludedRegions',v)}/>
        <ChipsSelector label="Tari excluse" values={draft.excludedCountries} onChange={v=>update('excludedCountries',v)} options={COUNTRY_OPTIONS} placeholder="Adauga tara exclusa"/>
      </CriteriaCard>
    </div>
    <FitProfileEditor value={draft.fitConfig} onChange={v=>update('fitConfig',v)}/>
    {invalidFit&&<p role="alert" className="text-red-700">Completeaza ponderile si preferintele FIT sau dezactiveaza FIT.</p>}
    <section className="rounded-2xl border border-violet-200 bg-violet-50 p-4">
      <div className="flex flex-wrap items-center gap-2"><h2 className="font-display text-base font-bold text-slate-900">Preferinte de afisare</h2><ScopeBadge scope="GUI"/></div>
      <p className="mt-1 text-sm text-slate-600">Nu elimina joburi din dataset si nu apeleaza provideri. Pragul FIT reclasifica instant High FIT / De evaluat in interfata.</p>
      <div className="mt-4 max-w-sm"><label className="block text-sm text-slate-700">Prag High FIT<input type="number" min="50" max="100" value={draft.fitThreshold} onChange={e=>update('fitThreshold',Number(e.target.value))} className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 bg-white px-3"/></label></div>
    </section>
    <section className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600 shadow-sm">
      <strong className="text-slate-800">Controale scoase din Criterii:</strong> JobsPipe/providerii se administreaza in Administrare. Rate si Disponibilitate imediata nu sunt afisate ca filtre active deoarece motorul curent nu le aplica.
    </section>
    <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-20 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white/95 px-4 py-3 shadow-lg backdrop-blur sm:flex-row sm:items-center sm:justify-between md:static md:bg-white md:px-5 md:py-4 md:shadow-sm"><span className={cx('text-sm font-medium',dirty?'text-amber-600':'text-slate-500')}>{dirty?'Modificari nesalvate':'Preferinte salvate'}</span><div className="flex gap-2"><button type="button" onClick={onReset} disabled={!dirty||saving} className="min-h-11 flex-1 rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-600 disabled:opacity-50 sm:flex-none">Reseteaza</button><button onClick={onSave} disabled={!dirty||saving||invalidRetrieve||invalidFit} className="min-h-11 flex-1 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold disabled:opacity-50 sm:flex-none">{saving?'Se salveaza...':'Salveaza preferintele'}</button></div></div>
  </div>;
}

function OnboardingPanel({onStart}) {
  return <section className="rounded-2xl border border-blue-200 bg-white p-6 shadow-sm"><div className="max-w-2xl"><span className="inline-flex rounded-full bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700">Configurare initiala</span><h2 className="mt-3 font-display text-xl font-bold text-slate-950">Defineste Search Profile-ul inainte de prima lista de joburi</h2><p className="mt-2 text-sm leading-6 text-slate-600">JSCC nu porneste automat un Retrieve pentru un profil nou. Alege familia de joburi, geografia, modul de lucru si tipul de contract; apoi sistemul va reutiliza mai intai corpusul partajat existent.</p><button type="button" onClick={onStart} className="mt-5 min-h-11 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white">Configureaza criteriile</button></div></section>;
}

function App(){
  const initialUiRef=useRef(readUiState()),initialUi=initialUiRef.current;
  const[clientId,setClientId]=useState(null),[environment,setEnvironment]=useState(null),[auth,setAuth]=useState({status:'signed-out',token:null,email:null,role:null,error:null}),[dataState,setDataState]=useState({status:'idle',error:null});
  const[loginHint,setLoginHint]=useState(()=>readGoogleLoginHint()),[allowAutoRestore,setAllowAutoRestore]=useState(true);
  const[jobs,setJobs]=useState([]),[applications,setApplications]=useState([]),[sources,setSources]=useState([]),[sourceCategories,setSourceCategories]=useState([]),[runStatus,setRunStatus]=useState(null),[runHistory,setRunHistory]=useState([]),[promotionStatus,setPromotionStatus]=useState(null),[canonicalConfig,setCanonicalConfig]=useState(null);
  const[savedCriteria,setSavedCriteria]=useState(criteriaFromConfig({})),[draftCriteria,setDraftCriteria]=useState(criteriaFromConfig({})),[view,setView]=useState(initialUi.view||'jobs');
  const[filters,setFilters]=useState(()=>({...initialUi.filters,quick:'all',workModes:[...(initialUi.filters?.workModes||ALL_WORK_MODES)]})),[kpiFilter,setKpiFilter]=useState('all'),[detailJob,setDetailJob]=useState(null),[running,setRunning]=useState(false),[saving,setSaving]=useState(false),[toast,setToast]=useState(null);
  const[deleteAccountOpen,setDeleteAccountOpen]=useState(false),[deleteAccountConfirmation,setDeleteAccountConfirmation]=useState(''),[deletingAccount,setDeletingAccount]=useState(false);
  const[jobPage,setJobPage]=useState({nextCursor:null,loading:false,loadingMore:false,results:0});
  const[pageNumber,setPageNumber]=useState(1),[resultTotal,setResultTotal]=useState(null);
  const pageCursorHistory=useRef([null]),pageRequestSerialRef=useRef(0),pageNavigationPendingRef=useRef(false),countAbortRef=useRef(null);
  const activeViewRef=useRef(view),activeKpiRef=useRef(kpiFilter);
  const[archivedKeys,setArchivedKeys]=useState([]);
  const sessionGenerationRef=useRef(0),pollGenerationRef=useRef(0),filtersRef=useRef(filters),jobQueryRef=useRef(''),serverQueryRef=useRef(''),restoredScrollRef=useRef(false),restoredJobRef=useRef(false),detailScrollRef=useRef(0);
  const notify=useCallback((message,type='info')=>{const id=Date.now();setToast({id,message,type});window.setTimeout(()=>setToast(current=>current?.id===id?null:current),3500);},[]);

  useEffect(()=>{filtersRef.current=filters;activeViewRef.current=view;activeKpiRef.current=kpiFilter;},[filters,view,kpiFilter]);
  useEffect(()=>{registerPwa().catch(error=>{console.warn('[JSCC PWA] Service Worker registration failed:', error);});},[]);
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

  const clearData=useCallback(()=>{
    sessionGenerationRef.current+=1; // invalidate every older account's async work immediately
    countAbortRef.current?.abort();
    // Also used by account deletion: do not leak this tab's GUI context to another login.
    clearUiState();
    const defaultUi=sanitizeUiState();
    initialUiRef.current=defaultUi;
    filtersRef.current=defaultUi.filters;
    setView(defaultUi.view);
    setFilters(defaultUi.filters);
    setKpiFilter('all');
    setDetailJob(null);
    restoredScrollRef.current=true;
    restoredJobRef.current=true;
    detailScrollRef.current=0;
    setResultTotal(null);
    setSaving(false);
    setSavedCriteria(criteriaFromConfig({}));
    setDraftCriteria(criteriaFromConfig({}));
    pageRequestSerialRef.current++;pageCursorHistory.current=[null];pageNavigationPendingRef.current=false;setPageNumber(1);setJobs([]);setArchivedKeys([]);setApplications([]);setSources([]);setSourceCategories([]);setRunStatus(null);setRunHistory([]);setPromotionStatus(null);setCanonicalConfig(null);setJobPage({nextCursor:null,loading:false,loadingMore:false,results:0});jobQueryRef.current='';serverQueryRef.current='';
  },[]);

  const loadJobsPage=useCallback(async(token,criteria,filterState,{cursor=null,append=false,generation=sessionGenerationRef.current}={})=>{
    if(generation!==sessionGenerationRef.current)return {ignored:true};
    if(!isSearchProfileConfigured(criteria)){
      pageRequestSerialRef.current++;pageCursorHistory.current=[null];setPageNumber(1);
      setJobs([]);setJobPage({nextCursor:null,loading:false,loadingMore:false,results:0});jobQueryRef.current='';return null;
    }
    const requestSerial=++pageRequestSerialRef.current;
    if(!append){countAbortRef.current?.abort();setResultTotal(null);}
    const size=jobPageSize(filterState.pageSize);
    const viewScope=activeViewRef.current,kpiScope=activeKpiRef.current;
    const pathFor=(nextCursor,limit,prefetch)=>buildJobsPath({filters:filterState,cursor:nextCursor,limit,prefetch,view:viewScope,kpiFilter:kpiScope});
    const navigationContext=append?pageRequestKey({filters:filterState,view:activeViewRef.current,kpiFilter:activeKpiRef.current}):null;
    setJobPage(current=>({...current,loading:!append,loadingMore:append}));
    try{
      const payload=validateJobsPage(await fetchJson(pathFor(cursor,size,0),token));
      if(generation!==sessionGenerationRef.current)return {ignored:true};
      let batch=payload,next=payload.next_cursor;const collected=[...payload.jobs];
      for(let i=1;payload.schema_version==='2.0'&&collected.length<size&&next&&i<32;i++){
        if(requestSerial!==pageRequestSerialRef.current)return {ignored:true};
        const previous=next;
        batch=validateJobsPage(await fetchJson(pathFor(next,size-collected.length,0),token));
        if(generation!==sessionGenerationRef.current)return {ignored:true};
        if(batch.generated_at!==payload.generated_at||batch.profile_version!==payload.profile_version||batch.count_basis!==payload.count_basis||batch.next_cursor===previous)throw Object.assign(new Error('STALE_CURSOR: result scope changed'),{status:400});
        collected.push(...batch.jobs);next=batch.next_cursor;
      }
      if(payload.schema_version==='2.0'&&collected.length<size&&next)throw new Error('Limita de scanare a paginii a fost atinsa. Restrange filtrele.');
      payload.jobs=collected;payload.next_cursor=next;payload.results=collected.length;
      if(generation!==sessionGenerationRef.current)return {ignored:true};
      if(ignorePageResponse({requestSerial,currentSerial:pageRequestSerialRef.current,append,navigationContext,currentContext:pageRequestKey({filters:filtersRef.current,view:activeViewRef.current,kpiFilter:activeKpiRef.current})},setJobPage))return {ignored:true};
      const normalized=(payload.jobs||[]).map(normalizeJob);
      if(!append){pageCursorHistory.current=[null];setPageNumber(1);}
      // Navigation replaces the visible page; append would exceed the 20-row UI contract.
      setJobs(normalized);
      setArchivedKeys(current=>[...new Set([...current,...normalized.filter(job=>job.archivedAt).map(jobKey)])]);
      setJobPage({nextCursor:payload.next_cursor||null,loading:false,loadingMore:false,results:Number(payload.results??normalized.length),orderStatus:payload.order_status||null,pending:payload.pending??null,totals:payload.count_status==='EXACT'?payload.totals:null,countBasis:payload.count_basis||null,generatedAt:payload.generated_at,scope:pageRequestKey({filters:filterState,view:viewScope,kpiFilter:kpiScope})});
      if(!append){jobQueryRef.current=pageRequestKey({filters:filterState,view:activeViewRef.current,kpiFilter:activeKpiRef.current});serverQueryRef.current=buildJobsPath({filters:filterState,view:viewScope,kpiFilter:kpiScope});}
      return payload;
    }catch(error){
      if(generation!==sessionGenerationRef.current)return {ignored:true};
      if(ignorePageResponse({requestSerial,currentSerial:pageRequestSerialRef.current,append,navigationContext,currentContext:pageRequestKey({filters:filtersRef.current,view:activeViewRef.current,kpiFilter:activeKpiRef.current})},setJobPage))return {ignored:true};
      if(append && error.status===400 && /^STALE_CURSOR/.test(error.message||'')){
        // One restart on stale cursor; never attempt another continuation with that cursor.
        const restarted=await loadJobsPage(token,criteria,filterState,{cursor:null,append:false});
        return {...restarted,restarted:true};
      }
      setJobPage(current=>({...current,loading:false,loadingMore:false}));
      throw error;
    }
  },[]);

  // Epoch is client-session identity; the cookie bearer is intentionally the same for all accounts.
  const loadData=useCallback(async(token,role,generation=sessionGenerationRef.current)=>{
    if(generation!==sessionGenerationRef.current)return null;
    setDataState({status:'loading',error:null});
    try{
      const[applicationPayload,configPayload]=await Promise.all([fetchJson('/applications',token),fetchJson('/me/preferences',token)]);
      if(generation!==sessionGenerationRef.current)return null;
      for(const [payload,name] of [[applicationPayload,'applications'],[configPayload,'me/preferences']])validateContract(payload,name);
      const criteria=criteriaFromConfig(configPayload);
      const currentFilters=filtersRef.current;
      const nextFilters={...currentFilters,freshness:currentFilters.freshness??criteria.freshness??24,workModes:Array.isArray(currentFilters.workModes)?currentFilters.workModes:[...ALL_WORK_MODES]};
      let statusPayload=null,historyPayload={runs:[]},sourcePayload={sources:[]},categoryPayload={categories:[]};
      if(role==='ADMIN'){
        [statusPayload,historyPayload,sourcePayload,categoryPayload]=await Promise.all([fetchJson('/data/run-status.json',token),fetchJson('/data/run-history.json',token),fetchJson('/data/sources.json',token),fetchJson('/data/source-categories.json',token)]);
        if(generation!==sessionGenerationRef.current)return null;
        for(const [payload,name] of [[statusPayload,'run-status.json'],[historyPayload,'run-history.json'],[sourcePayload,'sources.json'],[categoryPayload,'source-categories.json']])validateContract(payload,name);
      }
      if(generation!==sessionGenerationRef.current)return null;
      setApplications((applicationPayload.applications||[]).map(normalizeApplication));
      setSources((sourcePayload.sources||[]).map(normalizeSource));setSourceCategories(categoryPayload.categories||[]);
      setRunStatus(statusPayload);setRunHistory(historyPayload.runs||[]);
      setCanonicalConfig(configPayload);setSavedCriteria(criteria);setDraftCriteria(criteria);setFilters(nextFilters);
      await loadJobsPage(token,criteria,nextFilters,{generation});
      if(generation!==sessionGenerationRef.current)return null;
      setDataState({status:'ready',error:null});return statusPayload;
    }catch(error){
      if(generation!==sessionGenerationRef.current)return null;
      setDataState({status:'error',error});throw error;
    }
  },[loadJobsPage]);

  const handleCredential=useCallback(async credential=>{
    const generation=++sessionGenerationRef.current;
    pollGenerationRef.current+=1;
    setAuth({status:'authenticating',token:null,email:null,role:null,error:null});
    try{
      const session=await commandApi('/auth/session',credential,{method:'POST'});
      if(generation!==sessionGenerationRef.current)return;
      const email=session?.email||null,role=session?.role||'USER';
      if(email){const remembered=rememberGoogleLoginHint(email);if(remembered)setLoginHint(remembered);}
      setAllowAutoRestore(true);
      setAuth({status:'authenticated',token:COOKIE_SESSION_BEARER,email,role,error:null});
      try{
        await loadData(COOKIE_SESSION_BEARER,role,generation);
        if(generation===sessionGenerationRef.current)notify('Autentificare Google reusita.','success');
      }catch(error){
        if(generation===sessionGenerationRef.current)notify('Autentificarea a reusit, dar datele nu s-au incarcat: '+error.message,'error');
      }
    }catch(error){
      if(generation!==sessionGenerationRef.current)return;
      const message=error.status===403?'Contul este dezactivat sau nu are acces.':'Autentificare esuata: '+error.message;
      setAuth({status:'signed-out',token:null,email:null,role:null,error:message});
    }
  },[loadData,notify]);

  const logout=useCallback(async()=>{
    pollGenerationRef.current+=1;
    setAllowAutoRestore(false);
    clearData(); // synchronous invalidation; never wait for network logout
    const generation=sessionGenerationRef.current;
    setAuth({status:'authenticating',token:null,email:null,role:null,error:null});
    setDataState({status:'idle',error:null});
    try{await commandApi('/auth/logout',COOKIE_SESSION_BEARER,{method:'POST'});}catch{}
    if(generation!==sessionGenerationRef.current)return;
    try{window.google?.accounts?.id?.disableAutoSelect();}catch{}
    setAuth({status:'signed-out',token:null,email:null,role:null,error:null});
    setRunning(false);
    notify('Contul Google a fost deconectat.','info');
  },[clearData,notify]);

  const deleteCurrentAccount=useCallback(async()=>{
    if(deletingAccount||deleteAccountConfirmation!=='STERGE')return;
    const generation=++sessionGenerationRef.current;
    setDeletingAccount(true);
    try{
      await commandApi('/me/account',auth.token,{method:'DELETE'});
      if(generation!==sessionGenerationRef.current)return;
      pollGenerationRef.current+=1;setAllowAutoRestore(false);
      try{window.google?.accounts?.id?.disableAutoSelect();}catch{}
      clearData();
      setAuth({status:'signed-out',token:null,email:null,role:null,error:null});
      setDataState({status:'idle',error:null});setRunning(false);
      setDeleteAccountOpen(false);setDeleteAccountConfirmation('');
      notify('Contul si datele personale au fost sterse definitiv.','success');
    }catch(error){
      if(generation===sessionGenerationRef.current)notify('Contul nu a putut fi sters: '+error.message,'error');
    }finally{
      setDeletingAccount(false);
    }
  },[auth.token,deletingAccount,deleteAccountConfirmation,clearData,notify]);

  const retryData=useCallback(()=>{if(!auth.token)return;const generation=sessionGenerationRef.current;loadData(auth.token,auth.role,generation).then(()=>{if(generation===sessionGenerationRef.current)notify('Datele au fost reincarcate.','success');}).catch(error=>{if(generation===sessionGenerationRef.current)notify('Incarcarea a esuat: '+error.message,'error');});},[auth.token,auth.role,loadData,notify]);

  const profileConfigured=isSearchProfileConfigured(savedCriteria);
  useEffect(()=>{
    if(auth.status!=='authenticated'||dataState.status!=='ready'||!profileConfigured||!['jobs','review','unclassified'].includes(view))return undefined;
    const key=pageRequestKey({filters,view,kpiFilter});
    if(key===jobQueryRef.current)return undefined;
    // Don't trigger another lazy/cached evaluation for GUI-only filter changes on page 1.
    const serverPath=buildJobsPath({filters,view,kpiFilter});
    if(!needsPageReload({page:pageNumber,loadedServerPath:serverQueryRef.current,nextServerPath:serverPath})){
      jobQueryRef.current=key;return undefined;
    }
    const timer=setTimeout(()=>loadJobsPage(auth.token,savedCriteria,filters).catch(error=>notify('Lista de joburi nu a putut fi actualizata: '+error.message,'error')),250);
    return()=>clearTimeout(timer);
  },[auth.status,auth.token,dataState.status,profileConfigured,view,filters.search,filters.freshness,filters.workModes.join('|'),(filters.roleSubfamilies||[]).join('|'),(filters.contractTypes||[]).join('|'),filters.roleSubfamiliesNone,filters.contractTypesNone,filters.minFit,filters.pageSize,filters.quick,filters.sort,kpiFilter,pageNumber,savedCriteria,loadJobsPage,notify]);

  useEffect(()=>{
    setResultTotal(null);
    if(dataState.status!=='ready'||!['jobs','review','unclassified'].includes(view)||!auth.token||!jobPage.countBasis||jobPage.loading||jobPage.loadingMore)return;
    const scope=pageRequestKey({filters,view,kpiFilter});
    if(scope!==jobPage.scope)return;
    let current=true;
    const controller=new AbortController();countAbortRef.current=controller;
    const basis=jobPage.countBasis,anchor=jobPage.generatedAt;
    // Keep the first render off the count-scan critical path; cancel stale scans immediately.
    const timer=setTimeout(()=>scanResultCount({basis,anchor,isCurrent:()=>current&&!controller.signal.aborted,load:cursor=>fetchJson(buildJobsPath({filters,view,kpiFilter,cursor,countOnly:true,asOf:anchor,countBasis:basis,prefetch:0}),auth.token,controller.signal)})
      .then(total=>{if(current&&!controller.signal.aborted&&total!==null)setResultTotal({scope,basis,anchor,total});}).catch(()=>{}),300);
    return()=>{current=false;clearTimeout(timer);controller.abort();if(countAbortRef.current===controller)countAbortRef.current=null;};
  },[dataState.status,view,auth.token,jobPage.countBasis,jobPage.generatedAt,jobPage.scope,filters.search,filters.freshness,filters.workModes.join('|'),(filters.roleSubfamilies||[]).join('|'),(filters.contractTypes||[]).join('|'),filters.roleSubfamiliesNone,filters.contractTypesNone,filters.minFit,filters.pageSize,filters.quick,filters.sort,kpiFilter]);

  useEffect(()=>{
    if(auth.status!=='authenticated'||!auth.token||dataState.status!=='ready'||jobPage.orderStatus!=='PROVISIONAL'||!['jobs','review','unclassified'].includes(view))return;
    let active=true;let timer=null,scanCursor=null;const controller=new AbortController();
    const step=async()=>{try{
      const path='/me/evaluation/advance'+(scanCursor?'?scan_cursor='+encodeURIComponent(scanCursor):'');
      const result=await commandApi(path,auth.token,{method:'POST',signal:controller.signal});
      if(!active)return;
      if(result.status==='COMPLETE'){await loadJobsPage(auth.token,savedCriteria,filtersRef.current);return;}
      if(result.status==='INCOMPLETE'){scanCursor=result.scan_cursor??null;setJobPage(current=>({...current,pending:result.pending}));}
      if(result.status==='INVALIDATED')scanCursor=null;
      timer=setTimeout(step,result.status==='INCOMPLETE'?150:1200);
    }catch(error){if(active)notify('Evaluarea FIT a fost intrerupta: '+error.message,'error');}};
    timer=setTimeout(step,150);return()=>{active=false;clearTimeout(timer);controller.abort();};
  },[auth.status,auth.token,dataState.status,jobPage.orderStatus,view,savedCriteria,loadJobsPage,notify]);
  useEffect(()=>{if(dataState.status!=='ready'||restoredScrollRef.current)return;restoredScrollRef.current=true;requestAnimationFrame(()=>window.scrollTo({top:initialUi.scrollY||0,behavior:'auto'}));},[dataState.status,initialUi.scrollY]);
  useEffect(()=>{if(restoredJobRef.current||!initialUi.selectedJobId||!jobs.length)return;const found=jobs.find(job=>String(job.id)===String(initialUi.selectedJobId));if(found)setDetailJob(found);restoredJobRef.current=true;},[jobs,initialUi.selectedJobId]);

  const activeJobs=useMemo(()=>jobs.filter(job=>!archivedKeys.includes(jobKey(job))),[jobs,archivedKeys]);
  const threshold=savedCriteria.fitThreshold||80;
  const jobPopulation=useMemo(()=>jobViewPopulation(activeJobs,filters,ageHours),[activeJobs,filters.freshness,filters.workModes]);
  const reviewRows=useMemo(()=>reviewRowsForFilters(activeJobs,filters,ageHours,threshold),[activeJobs,filters.freshness,filters.workModes,threshold]);
  const baseRows=useMemo(()=>view==='applications'?applications:activeJobs,[view,applications,activeJobs]);
  const filteredRows=useMemo(()=>view==='applications'?filterAndSortJobRows(baseRows,{view,filters:{...filters,quick:'all',search:''},threshold,kpiFilter:'all',ageHours}):baseRows,[view,baseRows,filters.quick,filters.search,filters.sort,threshold,kpiFilter]);
  const canonicalCounts=useMemo(()=>jobPage.orderStatus?{all:jobPage.totals?.all??null,high:jobPage.totals?.high??null,b2b:jobPage.totals?.b2b??null,new24h:jobPage.totals?.new24h??null,reposts:jobPage.totals?.repost??null,remote:jobPage.totals?.remote??null}:jobViewCounts(jobPopulation,threshold,ageHours),[jobPage.orderStatus,jobPage.totals,jobPopulation,threshold]);
  const metrics=useMemo(()=>({jobs:canonicalCounts.new24h,high:canonicalCounts.high,reposts:canonicalCounts.reposts,remote:canonicalCounts.remote,threshold,scope:jobCountScopeLabel(filters.freshness)}),[canonicalCounts,threshold,filters.freshness]);
  const counts=useMemo(()=>({jobs:canonicalCounts.all,review:reviewRows.length,applications:applications.length}),[canonicalCounts,reviewRows,applications]);

  const archiveJob=useCallback(async job=>{const generation=sessionGenerationRef.current;try{await commandApi('/me/jobs/'+job.id+'/state',auth.token,{method:'PUT',body:JSON.stringify({archived:true})});if(generation!==sessionGenerationRef.current)return;setArchivedKeys(current=>[...new Set([...current,jobKey(job)])]);if(detailJob?.id===job.id)setDetailJob(null);setResultTotal(null);await loadJobsPage(auth.token,savedCriteria,filtersRef.current,{generation});if(generation===sessionGenerationRef.current)notify('Job arhivat pentru profilul curent.','success');}catch(error){if(generation===sessionGenerationRef.current)notify('Arhivarea a esuat: '+error.message,'error');}},[auth.token,detailJob,notify,loadJobsPage,savedCriteria]);

  const applyJob=useCallback(job=>{writeUiState({view,filters,selectedJobId:job?.id||null,scrollY:window.scrollY});},[view,filters]);

  const pollRun=useCallback(async(previousRunId,previousCompletedAt,targetRunId=null)=>{const generation=++pollGenerationRef.current,sessionEpoch=sessionGenerationRef.current;const baseline={runId:previousRunId??null,completedAt:previousCompletedAt??null};const deadline=Date.now()+60*60*1000;for(let attempt=0;generation===pollGenerationRef.current&&Date.now()<deadline;attempt+=1){await new Promise(resolve=>setTimeout(resolve,pollingDelayMs(attempt)));if(generation!==pollGenerationRef.current)return null;try{const status=await fetchJson('/data/run-status.json?t='+Date.now(),auth.token);if(generation!==pollGenerationRef.current)return null;if(['idle','unavailable'].includes(status?.status)){setRunStatus(status);notify('Starea finala a rularii nu a putut fi confirmata.','info');return null;}if(targetRunId&&!statusForTrackedRun(status,targetRunId))continue;setRunStatus(status);if(!terminalForBaseline(status,baseline))continue;await loadData(auth.token,auth.role,sessionEpoch);if(generation!==pollGenerationRef.current||sessionEpoch!==sessionGenerationRef.current)return null;const notice=completionNotice(status);notify(notice.message,notice.type);return status;}catch(error){if(error?.status===401||error?.status===403){if(generation===pollGenerationRef.current)setRunStatus({status:'unavailable'});notify('Urmarirea rularii s-a oprit deoarece sesiunea nu mai este autorizata.','error');return null;}}}if(generation===pollGenerationRef.current){setRunStatus({status:'unavailable'});notify('Starea finala a rularii nu a putut fi confirmata.','error');}return null;},[auth.token,auth.role,loadData,notify]);
  useEffect(()=>{if(auth.status!=='authenticated'||auth.role!=='ADMIN'||!auth.token||dataState.status!=='ready'||running||!isActiveRunStatus(runStatus?.status))return undefined;const sessionEpoch=sessionGenerationRef.current;setRunning(true);pollRun(runStatus?.run_id??null,runStatus?.completed_at??null,runStatus?.run_id??null).finally(()=>{if(sessionEpoch===sessionGenerationRef.current)setRunning(false);});return undefined;},[auth.status,auth.role,auth.token,dataState.status,runStatus?.status,runStatus?.run_id,runStatus?.completed_at,running,pollRun]);

  const pollOwnRefresh=useCallback(async(id)=>{
    const generation=++pollGenerationRef.current,sessionEpoch=sessionGenerationRef.current;
    const deadline=Date.now()+60*60*1000;
    for(let attempt=0;generation===pollGenerationRef.current&&Date.now()<deadline;attempt+=1){
      await new Promise(resolve=>setTimeout(resolve,pollingDelayMs(attempt)));
      if(generation!==pollGenerationRef.current)return;
      try{
        const status=await commandApi('/me/refresh/'+encodeURIComponent(id),auth.token);
        if(generation!==pollGenerationRef.current)return;
        if(!status.terminal)continue;
        if(status.status==='completed'||status.status==='completed_with_errors'){
          await loadJobsPage(auth.token,savedCriteria,filtersRef.current,{generation:sessionEpoch});
          if(generation!==pollGenerationRef.current||sessionEpoch!==sessionGenerationRef.current)return;
          notify(status.status==='completed'?'Actualizare finalizata.':'Actualizare finalizata cu erori partiale.',status.status==='completed'?'success':'info');
        }else notify('Actualizarea nu a putut fi confirmata ca finalizata.','error');
        return;
      }catch(error){
        if([401,403,404].includes(error?.status)){notify('Urmarirea solicitarii nu mai este disponibila.','error');return;}
      }
    }
    if(generation===pollGenerationRef.current)notify('Statusul final al solicitarii nu a fost confirmat.','info');
  },[auth.token,savedCriteria,loadJobsPage,notify]);

  const runSearch=useCallback(async()=>{
    if(!auth.token||running)return;
    const sessionEpoch=sessionGenerationRef.current;
    if(!isSearchProfileConfigured(savedCriteria)){setView('criteria');notify('Configureaza familia, subfamilia si restul Search Profile-ului inainte de actualizare.','error');return;}
    setRunning(true);
    const previousRunId=runStatus?.run_id||null,previousCompletedAt=runStatus?.completed_at||null;
    try{
      const result=await commandApi(auth.role==='ADMIN'?'/admin/refresh?intent=manual':'/me/refresh?intent=manual',auth.token,{method:'POST'});
      if(sessionEpoch!==sessionGenerationRef.current)return;
      const notice=refreshOutcomeNotice(result);notify(notice.message,notice.type);
      if(result.outcome==='REUSED_CORPUS'){await loadJobsPage(auth.token,savedCriteria,filtersRef.current,{generation:sessionEpoch});}
      else if(auth.role==='ADMIN'&&['STARTED_RUN','JOINED_EXISTING_RUN'].includes(result.outcome)){
        const target=result.run_id;
        if(target)setRunStatus(initialTrackedRun(target));
        try{const currentStatus=await fetchJson('/data/run-status.json?t='+Date.now(),auth.token);if(sessionEpoch!==sessionGenerationRef.current)return;if(target?statusForTrackedRun(currentStatus,target):isActiveRunStatus(currentStatus?.status))setRunStatus(currentStatus);}catch(statusError){notify('Actualizarea a fost acceptata; astept statusul live al executiei.','info');}
        await pollRun(previousRunId,previousCompletedAt,target||null);
      }else if(auth.role==='USER'&&result.request_id&&['STARTED_RUN','JOINED_EXISTING_RUN'].includes(result.outcome)){
        await pollOwnRefresh(result.request_id);
      }
    }catch(error){if(sessionEpoch===sessionGenerationRef.current)notify('Nu am putut actualiza joburile: '+error.message,'error');}
    finally{if(sessionEpoch===sessionGenerationRef.current)setRunning(false);}
  },[auth.token,auth.role,running,savedCriteria,runStatus,notify,loadJobsPage,pollRun,pollOwnRefresh]);

  const saveCriteria=useCallback(async()=>{if(!auth.token||saving)return;if(geographyConflicts(draftCriteria)){notify('Rezolva conflictul dintre includerile si excluderile teritoriale.','error');return;}if(!hasTargetGeography(draftCriteria)){notify('Selecteaza cel putin o tara sau regiune tinta.','error');return;}if(!hasSelectedRole(draftCriteria)){notify('Selecteaza cel putin o familie si o subfamilie pentru Retrieve.','error');return;}if(!hasSelectedWorkMode(draftCriteria)){notify('Selecteaza cel putin un mod de lucru pentru Retrieve.','error');return;}if(!hasSelectedContractType(draftCriteria)){notify('Selecteaza cel putin un tip de contract pentru Retrieve.','error');return;}const generation=sessionGenerationRef.current;setSaving(true);try{const result=await commandApi('/me/preferences',auth.token,{method:'PUT',body:JSON.stringify(preferencePatchFromCriteria(draftCriteria))});if(generation!==sessionGenerationRef.current)return;setSavedCriteria(draftCriteria);setCanonicalConfig(result?.preferences||canonicalConfig);const nextFilters={...filtersRef.current,freshness:filtersRef.current.freshness??draftCriteria.freshness};setFilters(nextFilters);await loadJobsPage(auth.token,draftCriteria,nextFilters,{generation});if(generation!==sessionGenerationRef.current)return;notify('Preferintele au fost salvate. Nu a fost pornit niciun Retrieve.','success');}catch(error){if(generation===sessionGenerationRef.current)notify('Preferintele nu au putut fi salvate: '+error.message,'error');}finally{if(generation===sessionGenerationRef.current)setSaving(false);}},[auth.token,saving,draftCriteria,notify,loadJobsPage,canonicalConfig]);

  const loadMoreJobs=useCallback(async()=>{
    if(!auth.token||!jobPage.nextCursor||jobPage.loading||jobPage.loadingMore||pageNavigationPendingRef.current)return;
    const generation=sessionGenerationRef.current;
    pageNavigationPendingRef.current=true;
    try{
      const transition=await navigateJobPage({
        direction:'next',page:pageNumber,history:pageCursorHistory.current,nextCursor:jobPage.nextCursor,
        load:cursor=>loadJobsPage(auth.token,savedCriteria,filtersRef.current,{cursor,append:true,generation}),
      });
      if(generation!==sessionGenerationRef.current)return;
      if(transition.outcome==='restarted'){notify('Cursorul a expirat; lista a fost reluata de la pagina 1.','info');return;}
      if(transition.outcome!=='loaded')return;
      pageCursorHistory.current=transition.history;
      setPageNumber(transition.page);
      document.querySelector('[data-testid="job-table"]')?.scrollIntoView({block:'start',behavior:'auto'});
    }catch(error){if(generation===sessionGenerationRef.current)notify('Pagina urmatoare nu a putut fi incarcata: '+error.message,'error');}
    finally{if(generation===sessionGenerationRef.current)pageNavigationPendingRef.current=false;}
  },[auth.token,jobPage.nextCursor,jobPage.loading,jobPage.loadingMore,pageNumber,savedCriteria,loadJobsPage,notify]);
  const previousJobsPage=useCallback(async()=>{
    if(!auth.token||pageNumber<=1||jobPage.loading||jobPage.loadingMore||pageNavigationPendingRef.current)return;
    const generation=sessionGenerationRef.current;
    pageNavigationPendingRef.current=true;
    try{
      const transition=await navigateJobPage({
        direction:'previous',page:pageNumber,history:pageCursorHistory.current,
        load:cursor=>loadJobsPage(auth.token,savedCriteria,filtersRef.current,{cursor,append:true,generation}),
      });
      if(generation!==sessionGenerationRef.current)return;
      if(transition.outcome==='restarted'){notify('Cursorul a expirat; lista a fost reluata de la pagina 1.','info');return;}
      if(transition.outcome!=='loaded')return;
      pageCursorHistory.current=transition.history;
      setPageNumber(transition.page);
      document.querySelector('[data-testid="job-table"]')?.scrollIntoView({block:'start',behavior:'auto'});
    }catch(error){if(generation===sessionGenerationRef.current)notify('Pagina anterioara nu a putut fi incarcata: '+error.message,'error');}
    finally{if(generation===sessionGenerationRef.current)pageNavigationPendingRef.current=false;}
  },[auth.token,jobPage.loading,jobPage.loadingMore,pageNumber,savedCriteria,loadJobsPage,notify]);
  const changeView=useCallback(next=>{setView(next);if(next!=='jobs')setKpiFilter('all');},[]);
  const openDetails=useCallback(job=>{detailScrollRef.current=window.scrollY;setDetailJob(job);},[]);
  const closeDetails=useCallback(()=>{setDetailJob(null);requestAnimationFrame(()=>window.scrollTo({top:detailScrollRef.current,behavior:'auto'}));},[]);

  if(auth.status!=='authenticated')return<><SignedOutScreen clientId={clientId} loginHint={loginHint} allowAutoRestore={allowAutoRestore} authError={auth.error} authStatus={auth.status} onCredential={handleCredential}/><EnvironmentMarker environment={environment} className="fixed left-4 top-4 z-50"/><Toast toast={toast}/></>;
  const onboarding=!profileConfigured&&['jobs','review','unclassified'].includes(view);
  const countMatches=resultTotal?.scope===pageRequestKey({filters,view,kpiFilter})&&resultTotal?.basis===jobPage.countBasis&&resultTotal?.anchor===jobPage.generatedAt;
  const exactTotal=jobPage.scope===pageRequestKey({filters,view,kpiFilter})?jobPage.totals?.all:null;
  const totalPages=Number.isSafeInteger(exactTotal)?Math.max(1,Math.ceil(exactTotal/jobPageSize(filters.pageSize))):countMatches?Math.max(1,Math.ceil(resultTotal.total/jobPageSize(filters.pageSize))):null;
  return<div className="min-h-screen bg-slate-50"><ApplicationHeader email={auth.email} onLogout={logout} onDeleteAccount={()=>{setDeleteAccountConfirmation('');setDeleteAccountOpen(true);}} environment={environment}/><div className="md:flex"><Sidebar view={view} onView={changeView} counts={counts} runStatus={runStatus} role={auth.role} filters={filters} setFilters={setFilters} defaultFreshness={savedCriteria.freshness}/><main className="min-w-0 flex-1 pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-0"><div className="mx-auto w-full max-w-[1400px] space-y-3 px-3 py-3 sm:space-y-5 sm:px-6 lg:px-8 lg:py-6"><Header view={view} running={running} onRun={runSearch} refreshDisabled={!profileConfigured} metrics={metrics}/>{auth.role==='ADMIN'&&<PromotionStatusPanel status={promotionStatus}/>} {auth.role==='ADMIN'&&<RunProgressPanel status={runStatus}/>} {dataState.status==='loading'&&<LoadingPanel/>}{dataState.status==='error'&&<ErrorPanel error={dataState.error} onRetry={retryData}/>} {dataState.status==='ready'&&<>{onboarding&&<OnboardingPanel onStart={()=>changeView('criteria')}/>} {!onboarding&&view==='jobs'&&<KPIGrid metrics={metrics} selected={kpiFilter} onSelect={setKpiFilter}/>} {!onboarding&&['jobs','review','unclassified'].includes(view)&&<Filters filters={filters} setFilters={setFilters} defaultFreshness={savedCriteria.freshness} onResetKpi={()=>setKpiFilter('all')}/>} {(!onboarding&&['jobs','review','unclassified'].includes(view)||view==='applications')&&<JobTable rows={filteredRows} threshold={threshold} onDetails={openDetails} onArchive={archiveJob} onApply={applyJob} hasMore={view!=='applications'&&Boolean(jobPage.nextCursor)&&(totalPages==null||pageNumber<totalPages)} loadingMore={jobPage.loadingMore} loading={jobPage.loading} paginate={view!=='applications'} page={pageNumber} onNext={loadMoreJobs} onPrevious={previousJobsPage} pageSize={jobPageSize(filters.pageSize)} onPageSize={value=>{pageRequestSerialRef.current++;pageCursorHistory.current=[null];setPageNumber(1);setResultTotal(null);setJobPage(current=>({...current,nextCursor:null,loading:true}));setFilters(current=>({...current,pageSize:jobPageSize(value)}));}} totalPages={totalPages} sort={filters.sort} orderStatus={jobPage.orderStatus} pending={jobPage.pending} onSort={sort=>{pageRequestSerialRef.current++;setFilters(current=>({...current,sort}));}}/>} {view==='criteria'&&<CriteriaPage draft={draftCriteria} setDraft={setDraftCriteria} saved={savedCriteria} onSave={saveCriteria} onReset={()=>setDraftCriteria(savedCriteria)} saving={saving}/>} {view==='admin'&&auth.role==='ADMIN'&&<AdminShell sources={sources} setSources={setSources} sourceCategories={sourceCategories} setSourceCategories={setSourceCategories} runStatus={runStatus} runHistory={runHistory} running={running} onRun={runSearch} notify={notify} token={auth.token} environment={environment} onPurged={async()=>{setDetailJob(null);setArchivedKeys([]);await loadData(auth.token,auth.role);}}/>}</>}</div></main></div><BottomNav view={view} onView={changeView} counts={counts} role={auth.role} onLogout={logout}/><DetailDrawer job={detailJob} threshold={threshold} onClose={closeDetails} onApply={applyJob}/>{deleteAccountOpen&&<ActionDialog title="Sterge definitiv contul" description="Aceasta actiune este ireversibila. Sesiunile si toate datele personale JSCC vor fi sterse; corpusul partajat de joburi ramane intact." fields={[{name:'confirmation',label:'Scrie STERGE pentru confirmare',autoFocus:true}]} values={{confirmation:deleteAccountConfirmation}} onChange={(name,value)=>{if(name==='confirmation')setDeleteAccountConfirmation(value);}} confirmLabel="Sterge definitiv" danger busy={deletingAccount} confirmDisabled={deleteAccountConfirmation!=='STERGE'} onCancel={()=>{setDeleteAccountOpen(false);setDeleteAccountConfirmation('');}} onConfirm={deleteCurrentAccount}/>}<Toast toast={toast}/></div>;
}

createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);