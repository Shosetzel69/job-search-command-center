import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
const admin = readFileSync(new URL('../src/admin-shell.jsx', import.meta.url), 'utf8');
const staticFrontend = readFileSync(new URL('../../command-api/src/static-frontend.js', import.meta.url), 'utf8');

test('ATC-489-06 frontend uses canonical profile APIs instead of legacy job/run adapters', () => {
  assert.match(main, /\/me\/preferences/);
  assert.match(main, /\/me\/refresh/);
  assert.match(main, /\/admin\/refresh/);
  assert.match(main, /buildJobsPath/);
  assert.doesNotMatch(main, /fetchJson\('\/data\/jobs\.json/);
  assert.doesNotMatch(main, /commandApi\('\/commands\/run/);
});

test('profile jobs are bounded and paginated in the UI', () => {
  assert.match(main, /nextCursor/);
  assert.match(main, /loadMoreJobs/);
  assert.match(main, /Navigare pagini joburi/);
  assert.match(main, /Anterioara/);
  assert.match(main, /Urmatoarea/);
  assert.match(main, /rezultate pe pagina/);
});

test('page-local filters never hide next/previous pagination on empty matches', () => {
  assert.match(main, /Filtrele rapide, indicatoarele si sortarea FIT se aplica doar joburilor din pagina curenta/);
  assert.match(main, /Nicio potrivire pe aceasta pagina/);
  assert.match(main, /navigate?aza|navigheaza/);
  assert.match(main, /paginate&&<nav aria-label="Navigare pagini joburi"/);
  assert.doesNotMatch(main, /Incarca mai multe/);
});

test('N2/N4: stale cursor is announced once and page has one live region', () => {
  const table=main.slice(main.indexOf('function JobTable('),main.indexOf('function ErrorPanel('));
  assert.ok(table.length>0);
  assert.equal((table.match(/aria-live="polite"/g)||[]).length,1);
  assert.match(table, /<span>Pagina \{page\}<\/span>/);
  assert.equal((main.match(/notify\('Cursorul a expirat; lista a fost reluata de la pagina 1\.'\,'info'\)/g)||[]).length,2);
  assert.equal((main.match(/const transition=await navigateJobPage\(/g)||[]).length,2);
});

test('new profiles receive onboarding without forced Retrieve', () => {
  assert.match(main, /OnboardingPanel/);
  assert.match(main, /nu porneste automat un Retrieve/);
  assert.match(main, /isSearchProfileConfigured/);
});

test('Mobile V1 keeps one responsive React product with compact navigation and full-screen details', () => {
  assert.match(main, /BottomNav/);
  assert.match(main, /md:hidden/);
  assert.match(main, /fixed inset-0 z-\[60\]/);
  assert.match(main, /Detalii/);
  assert.match(main, /Review/);
  assert.match(main, /Aplica/);
  assert.match(main, /Arhiveaza/);
});

test('Admin compact logs use cards instead of horizontal scrolling as the primary compact interaction', () => {
  assert.match(admin, /space-y-2 md:hidden/);
  assert.match(admin, /hidden overflow-hidden rounded-xl border border-slate-200 bg-white md:block/);
});

test('static frontend leaves canonical multiuser endpoints to Command API', () => {
  assert.match(staticFrontend, /'\/me\/'/);
  assert.match(staticFrontend, /'\/admin\/'/);
  assert.match(staticFrontend, /'\/applications\/'/);
});
