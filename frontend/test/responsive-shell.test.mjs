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

test('PASS promotion state is compact while non-PASS states retain checklist', () => {
  assert.match(promotion, /status\.status === 'PASS'/);
  assert.match(promotion, /Promotion PASS/);
  assert.match(promotion, /Checklist promovare/);
});

test('P4 FIT details render as a compact grid with one six-criterion matrix',()=>{
  const start=main.indexOf('function FitMatrix(');
  const block=main.slice(start,main.indexOf('function CriteriaPage(',start));
  assert.match(block,/lg:grid-cols-3/);
  assert.match(block,/FIT_CRITERIA\.map/);
  assert.match(block,/FIT total/);
  assert.match(block,/Total ponderi/);
  assert.match(block,/Stare evaluare/);
  assert.doesNotMatch(main,/aria-label="Rezumat FIT"/);
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
