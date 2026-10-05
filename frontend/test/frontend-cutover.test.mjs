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
  assert.match(main, /Incarca mai multe/);
  assert.match(main, /rezultate de profil incarcate/);
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
