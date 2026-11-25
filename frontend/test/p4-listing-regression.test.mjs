import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const main=await readFile(new URL('../src/main.jsx',import.meta.url),'utf8');

function section(start,end){
  const from=main.indexOf(start);
  assert.notEqual(from,-1,start);
  const to=main.indexOf(end,from+start.length);
  assert.notEqual(to,-1,end);
  return main.slice(from,to);
}
function requireSource(source,fragment,id){
  assert.ok(source.includes(fragment),id+': '+fragment);
}

test('G1 S2: first page and navigation capture the actual request scope and guard publication',()=>{
  const load=section('const loadJobsPage=useCallback(','const loadData=useCallback(');
  requireSource(load,'const viewScope=activeViewRef.current,kpiScope=activeKpiRef.current;','S2');
  requireSource(load,'const navigationContext=pageRequestKey({filters:filterState,view:viewScope,kpiFilter:kpiScope});','S2');
  const guard='if(ignorePageResponse({requestSerial,currentSerial:pageRequestSerialRef.current,append,navigationContext,currentContext:pageRequestKey({filters:filtersRef.current,view:activeViewRef.current,kpiFilter:activeKpiRef.current})},setJobPage))return {ignored:true};';
  assert.equal(load.split(guard).length-1,2,'success and failure must reject stale scope');
  assert.ok(load.indexOf(guard)<load.indexOf('setJobs(normalized)'),'guard before rows publish');
  requireSource(load,'if(!append){jobQueryRef.current=navigationContext;','first-page scope');
});

test('G1 S3/S4/S7/S8: stale rows, counts and pagination are never presented under a different scope',()=>{
  requireSource(main,'const listingScope=pageRequestKey({filters,view,kpiFilter});','S3');
  requireSource(main,'const listingScopeMatches=jobPage.scope===listingScope;','S3');
  const rows=section('const filteredRows=useMemo(','const canonicalCounts=useMemo(');
  requireSource(rows,'):listingScopeMatches?baseRows:[],','S3');
  const counts=section('const canonicalCounts=useMemo(','const metrics=useMemo(');
  requireSource(counts,'!listingScopeMatches?{all:null,high:null,b2b:null,new24h:null,reposts:null,remote:null}:','S4');
  const table=section('<JobTable rows={filteredRows}','{view===\'criteria\'');
  requireSource(table,"hasMore={view!=='applications'&&listingScopeMatches&&Boolean(jobPage.nextCursor)","S7");
  requireSource(table,'page={listingScopeMatches?pageNumber:1}','S8');
  requireSource(table,"scopePending={view!=='applications'&&!listingScopeMatches}",'stale scope indication');
  requireSource(main,'const exactTotal=jobPage.scope===pageRequestKey({filters,view,kpiFilter})?jobPage.totals?.all:null;','exact total scope');
});

test('G1 S5/S6: both navigation callbacks reject stale scope before issuing any request',()=>{
  const next=section('const loadMoreJobs=useCallback(','const previousJobsPage=useCallback(');
  const previous=section('const previousJobsPage=useCallback(','const changeView=useCallback(');
  for(const [id,body,guard] of [
    ['S5',next,'if(!auth.token||!listingScopeMatches||!jobPage.nextCursor||jobPage.loading||jobPage.loadingMore||pageNavigationPendingRef.current)return;'],
    ['S6',previous,'if(!auth.token||!listingScopeMatches||pageNumber<=1||jobPage.loading||jobPage.loadingMore||pageNavigationPendingRef.current)return;'],
  ]){
    requireSource(body,guard,id);
    assert.ok(body.indexOf(guard)<body.indexOf('navigateJobPage('),id+': guard before navigation');
    requireSource(body,'[auth.token,listingScopeMatches,',id+' dependency');
  }
});

test('G1 S9/S10/S11/S12: committed refs and reused result scope are synchronized',()=>{
  requireSource(main,'useLayoutEffect(()=>{filtersRef.current=filters;activeViewRef.current=view;activeKpiRef.current=kpiFilter;},[filters,view,kpiFilter]);','S9');
  const loadData=section('const loadData=useCallback(','const handleCredential=useCallback(');
  const save=section('const saveCriteria=useCallback(','const loadMoreJobs=useCallback(');
  for(const [id,body,request] of [
    ['S10',loadData,'await loadJobsPage(token,criteria,nextFilters,{generation});'],
    ['S11',save,'await loadJobsPage(auth.token,draftCriteria,nextFilters,{generation});'],
  ]){
    const sync='filtersRef.current=nextFilters;setFilters(nextFilters);';
    requireSource(body,sync,id);
    requireSource(body,request,id);
    assert.ok(body.indexOf(sync)<body.indexOf(request),id+': sync before request');
  }
  requireSource(main,'jobQueryRef.current=key;setJobPage(current=>({...current,scope:key}));return undefined;','S12');
});

const mobile=section('function Filters(','function FitBadge(');
function handlerLine(name){
  const line=mobile.split('\n').find(line=>line.trimStart().startsWith('const '+name+'='));
  assert.ok(line,'missing mobile '+name+' handler');
  return line;
}

test('G2 R1/R2: backdrop and X both bind to discard, not Apply',()=>{
  const dismiss=Array.from(mobile.matchAll(/<button\b[^>]*aria-label="Inchide filtrele"[^>]*>/g),match=>match[0]);
  assert.equal(dismiss.length,2,'backdrop and X');
  for(const button of dismiss){
    requireSource(button,'onClick={close}','R1/R2');
    assert.ok(!button.includes('onClick={apply}'));
  }
  requireSource(mobile,'onClick={reset} className="min-h-11 rounded-xl border border-slate-200 font-semibold text-slate-600">Reseteaza</button>','Reset binding');
  requireSource(mobile,'onClick={apply} className="min-h-11 rounded-xl bg-blue-600 font-semibold text-white">Aplica</button>','Apply binding');
});

test('G2 R3/R5: actual mobile handlers discard, stage reset, and commit only on Apply',()=>{
  const initial={search:'architect',minFit:'50',sort:'title-asc',pageSize:30,workModes:['Remote']};
  const commits=[];
  let kpiResets=0;
  const context={
    filters:initial,draftFilters:null,resetKpi:false,mobileOpen:false,defaultFreshness:24,
    ALL_WORK_MODES:['Remote','Hybrid','Onsite'],jobPageSize:value=>value,
    setDraftFilters:value=>{context.draftFilters=value;},
    setMobileOpen:value=>{context.mobileOpen=value;},
    setResetKpi:value=>{context.resetKpi=value;},
    setFilters:value=>{commits.push(value);context.filters=value;},
    onResetKpi:()=>{kpiResets++;},
  };
  const actions=runInNewContext(['open','close','reset','apply'].map(handlerLine).join('\n')+'\n({open,close,reset,apply})',context);
  actions.open();
  context.draftFilters={...context.draftFilters,minFit:'75'};
  actions.close();
  assert.equal(commits.length,0);
  assert.equal(context.filters.minFit,'50');
  assert.equal(context.draftFilters,null);
  assert.equal(context.mobileOpen,false);
  actions.open();
  actions.reset();
  assert.equal(commits.length,0,'R5: Reset must not commit');
  assert.equal(kpiResets,0,'R3: Reset must not change KPI before Apply');
  assert.equal(context.draftFilters.sort,'fit-desc');
  assert.equal(context.draftFilters.pageSize,30);
  actions.close();
  assert.equal(commits.length,0);
  assert.equal(kpiResets,0);
  actions.open();
  context.draftFilters={...context.draftFilters,minFit:'75'};
  actions.apply();
  assert.equal(commits.length,1);
  assert.equal(commits[0].minFit,'75');
  assert.equal(kpiResets,0,'normal Apply preserves KPI');
  actions.open();
  actions.reset();
  actions.apply();
  assert.equal(commits.length,2);
  assert.equal(commits[1].minFit,'');
  assert.equal(commits[1].sort,'fit-desc');
  assert.equal(commits[1].pageSize,30);
  assert.equal(kpiResets,1);
  assert.equal(context.mobileOpen,false);
});

test('G3 R6/R7: unknown family counts as active and desktop Reset clears KPI',()=>{
  requireSource(mobile,'(filters.unknownFamily||filters.roleSubfamilies?.length||filters.roleSubfamiliesNone?1:0)','R6');
  const listing=section('function ListingFilters(','function Filters(');
  requireSource(listing,"search:'',quick:'all'}));onReset?.();}} className=\"text-xs underline\">Reseteaza filtrele</button>",'R7');
  const sidebar=section('function Sidebar(','function BottomNav(');
  requireSource(sidebar,'<ListingFilters filters={filters} setFilters={setFilters} defaultFreshness={defaultFreshness} onReset={onResetKpi}/>','R7 sidebar');
  requireSource(main,"defaultFreshness={savedCriteria.freshness} onResetKpi={()=>setKpiFilter('all')}/><main",'R7 App');
  requireSource(mobile,'<ListingFilters filters={draftFilters} setFilters={setDraftFilters} defaultFreshness={defaultFreshness} onReset={()=>setResetKpi(true)}/>','mobile inner Reset stages KPI');
});
