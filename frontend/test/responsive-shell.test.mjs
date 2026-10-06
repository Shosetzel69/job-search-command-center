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

test('mobile navigation exposes Jobs Review Applications and More', () => {
  const start = main.indexOf('function BottomNav(');
  const end = main.indexOf('function ProfileMenu', start);
  const block = main.slice(start, end);
  assert.match(block, /\['jobs','Joburi'/);
  assert.match(block, /\['review','Review'/);
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
  assert.match(block, /index%2===0\?'bg-white':'bg-slate-50\/70'/);
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
  assert.match(main, /buildJobsPath\(\{filters:filterState,cursor,limit:25,prefetch:25\}\)/);
  assert.match(main, /mergeJobPages/);
});

test('PASS promotion state is compact while non-PASS states retain checklist', () => {
  assert.match(promotion, /status\.status === 'PASS'/);
  assert.match(promotion, /Promotion PASS/);
  assert.match(promotion, /Checklist promovare/);
});
