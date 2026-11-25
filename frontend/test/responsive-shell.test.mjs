import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const main = await readFile(new URL('../src/main.jsx', import.meta.url), 'utf8');
const promotion = await readFile(new URL('../src/promotion-status.jsx', import.meta.url), 'utf8');

test('global application header is sticky and keeps environment visible', () => {
  assert.match(main, /function ApplicationHeader/);
  assert.match(main, /sticky top-0 z-50 h-14/);
  assert.match(main, /<EnvironmentMarker environment=\{environment\}\/>/);
  assert.match(main, /\[\$\{label\}\]/);
});

test('P4 W2 mobile navigation exposes Jobs, manual analysis, applications, archived and More', () => {
  const start = main.indexOf('function BottomNav(');
  const end = main.indexOf('function ProfileMenu', start);
  const block = main.slice(start, end);
  assert.match(block, /\['jobs','Joburi'/);
  assert.match(block, /\['analysis','De analizat'/);
  assert.match(block, /\['archived','Arhivate'/);
  assert.match(block, /\['applications','Aplicari'/);
  assert.match(block, />More</);
  assert.match(block, /Criterii de selectie/);
  assert.match(block, /role==='ADMIN'/);
});

test('mobile filter surface uses sticky search and a bottom sheet', () => {
  const start = main.indexOf('function Filters(');
  const end = main.indexOf('function FitBadge', start);
  const block = main.slice(start, end);
  assert.match(block, /sticky top-14/);
  assert.match(block, /aria-label="Filtre afisare"/);
  assert.match(block, /role="dialog"/);
  assert.match(block, /ScopeBadge scope="GUI ONLY"/);
  assert.match(block, /mobileOpen&&/);
});

test('mobile job cards are alternating scan-first cards with overflow actions', () => {
  const start = main.indexOf('function MobileOverflow(');
  const end = main.indexOf('function ErrorPanel', start);
  const block = main.slice(start, end);
  assert.match(block, /index%2===0\?'bg-white':'bg-slate-100'/);
  assert.match(block, /md:hidden/);
  assert.match(block, /Mai multe actiuni/);
  assert.match(block, /knownCompact\(job\.mode\)/);
  assert.match(block, /onClick=\{\(\)=>onDetails\(job\)\}/);
});

test('mobile details are full-screen and list scroll is restored on close', () => {
  assert.match(main, /fixed inset-0 z-\[60\] overflow-y-auto bg-white/);
  assert.match(main, /detailScrollRef\.current=window\.scrollY/);
  assert.match(main, /window\.scrollTo\(\{top:detailScrollRef\.current,behavior:'auto'\}\)/);
});

test('bounded jobs pagination remains the only mobile list loading path', () => {
  assert.ok(main.includes('buildJobsPath({filters:filterState,cursor:nextCursor,limit,prefetch,view:viewScope,kpiFilter:kpiScope})'));
  assert.match(main,/const size=jobPageSize\(filterState.pageSize\)/);
  assert.match(main, /pageCursorHistory/);
  assert.match(main, /onPrevious=\{previousJobsPage\}/);
  assert.match(main, /onNext=\{loadMoreJobs\}/);
});

test('pagination arrows are shared by mobile and web, top and bottom, with accessible names', () => {
  const block = main.slice(main.indexOf('function JobTable('), main.indexOf('function ErrorPanel('));
  assert.match(block, /aria-label="Pagina anterioara" title="Pagina anterioara"/);
  assert.match(block, /aria-label="Pagina urmatoare" title="Pagina urmatoare"/);
  assert.match(block, />‹<\/button>/);
  assert.match(block, />›<\/button>/);
  assert.match(block, /min-h-11 min-w-11/);
  const previous = block.match(/<button\b[^>]*aria-label="Pagina anterioara"[^>]*>‹<\/button>/)?.[0];
  const next = block.match(/<button\b[^>]*aria-label="Pagina urmatoare"[^>]*>›<\/button>/)?.[0];
  assert.ok(previous, 'previous pagination button exists');
  assert.ok(next, 'next pagination button exists');
  for (const button of [previous, next]) {
    assert.match(button, /\bmin-h-11\b/);
    assert.match(button, /\bmin-w-11\b/);
  }
  assert.match(previous, /disabled=\{loading\|\|loadingMore\|\|page===1\}/);
  assert.match(previous, /onClick=\{onPrevious\}/);
  assert.match(next, /disabled=\{loading\|\|loadingMore\|\|!hasMore\}/);
  assert.match(next, /onClick=\{onNext\}/);

  assert.match(block, /paginate&&controls\("sus"\)/);
  assert.match(block, /paginate&&controls\('jos'\)/);
  assert.doesNotMatch(block, />Anterioara<\/button>|>Urmatoarea<\/button>/);
});

test('PASS promotion state is compact while non-PASS states retain checklist', () => {
  assert.match(promotion, /status\.status === 'PASS'/);
  assert.match(promotion, /Promotion PASS/);
  assert.match(promotion, /Checklist promovare/);
});

test('UX-U1-01: FIT summary is a single scrollable numeric line with explanations on demand',()=>{
  const start=main.indexOf('function FitMatrix(');
  const block=main.slice(start,main.indexOf('function CriteriaPage(',start));
  const summary=block.slice(block.indexOf('<div className="max-w-full'),block.indexOf('{expanded&&'));
  const details=block.slice(block.indexOf('{expanded&&'));
  assert.match(block,/useState\(false\)/);
  assert.match(block,/FIT necalculat/);
  assert.match(block,/FIT_CRITERIA\.map/);
  assert.match(summary,/overflow-x-auto whitespace-nowrap/);
  assert.match(summary,/tabIndex=\{0\}/);
  assert.match(summary,/'FIT '\+fit\+'%'/);
  assert.match(summary,/shortLabels\[row\.criterion\]/);
  assert.match(summary,/row\.grade/);
  assert.match(summary,/\{' · '\}/);
  assert.match(summary,/aria-expanded=\{expanded\}/);
  assert.match(summary,/setExpanded\(value=>!value\)/);
  assert.doesNotMatch(summary,/row\.weight|row\.points|row\.reason|flex-wrap|<p\b/);
  assert.doesNotMatch(block,/<h[1-6]\b|<dl\b|<meter|<input|grid-cols|flex-wrap/);
  assert.match(details,/\{expanded&&/);
  assert.match(details,/row\.weight/);
  assert.match(details,/row\.grade/);
  assert.match(details,/row\.points/);
  assert.match(details,/reasonLabel\[row\.reason\]/);
  assert.match(details,/Total ponderi/);
  assert.match(details,/Stare evaluare/);
});

test('P4 removes duplicate Review action but keeps Details and responsive filters',()=>{
  const block=main.slice(main.indexOf('function JobTable('),main.indexOf('function ErrorPanel('));
  assert.doesNotMatch(block,/title="Review job"/);
  assert.match(block,/title="Detalii job"/);
  const filters=main.slice(main.indexOf('function Filters('),main.indexOf('function FitBadge('));
  assert.doesNotMatch(filters,/<FilterButton active=/);
  assert.match(main,/Selecteaza toate/);
  assert.match(main,/Deselecteaza toate/);
});

test('P4 M1 reset runs for both logout and permanent account deletion',()=>{
 const reset=main.slice(main.indexOf('const clearData=useCallback('),main.indexOf('const loadJobsPage=useCallback('));
 assert.match(reset,/clearUiState\(\)/);
 assert.match(reset,/setFilters\(defaultUi\.filters\)/);
 assert.match(reset,/filtersRef\.current=defaultUi\.filters/);
 assert.match(reset,/initialUiRef\.current=defaultUi/);
 assert.match(reset,/setView\(defaultUi\.view\)/);
 assert.match(reset,/setResultTotal\(null\)/);
 const logout=main.slice(main.indexOf('const logout=useCallback('),main.indexOf('const deleteCurrentAccount=useCallback('));
 const deletion=main.slice(main.indexOf('const deleteCurrentAccount=useCallback('),main.indexOf('const retryData=useCallback('));
 assert.match(logout,/clearData\(\)/);
 assert.match(deletion,/clearData\(\)/);
 const persist=main.slice(main.indexOf('const rememberUi=useCallback('),main.indexOf('const clearData=useCallback('));
 assert.match(persist,/if\(auth\.status==='authenticated'\)rememberUi\(\)/);
});


test('mobile listing filters are staged until Apply; dismiss does not commit',()=>{
  const block=main.slice(main.indexOf('function Filters('),main.indexOf('function FitBadge('));
  assert.ok(block.includes('setDraftFilters({...filters})'));
  assert.ok(block.includes('filters={draftFilters} setFilters={setDraftFilters}'));
  assert.ok(block.includes('setFilters(draftFilters)'));
  assert.ok(block.includes('onClick={apply}'));
  assert.ok(block.includes('onClick={close}'));
  assert.ok(block.includes('if(resetKpi)onResetKpi?.()'));
});

test('A11Y-01: opening mobile filters focuses the close control and dismissal restores trigger focus',()=>{
  const block=main.slice(main.indexOf('function Filters('),main.indexOf('function FitBadge('));
  assert.match(block,/ref=\{filterTriggerRef\}[^>]*aria-haspopup="dialog"/);
  assert.match(block,/ref=\{filterCloseRef\}[^>]*aria-label="Inchide filtrele"/);
  assert.match(block,/useLayoutEffect\(\(\)=>\{\s*if\(!mobileOpen\)return;\s*const trigger=filterTriggerRef\.current;\s*filterCloseRef\.current\?\.focus\(\);\s*return\(\)=>\{if\(trigger\?\.isConnected\)trigger\.focus\(\);\};\s*\},\[mobileOpen\]\)/);
  assert.match(block,/event\.key==='Escape'.*close\(\)/);
});
