import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const main = await readFile(new URL('../src/main.jsx', import.meta.url), 'utf8');
const promotion = await readFile(new URL('../src/promotion-status.jsx', import.meta.url), 'utf8');

function slice(start, end) {
  const a = main.indexOf(start);
  const b = main.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, `missing block ${start}`);
  return main.slice(a, b);
}

test('shared application header keeps environment and profile permanently visible', () => {
  const block = slice('function ApplicationHeader', 'function Header');
  assert.match(block, /sticky top-0/);
  assert.match(block, /Job Search/);
  assert.match(block, /EnvironmentMarker/);
  assert.match(block, /ProfileMenu/);
});

test('mobile bottom navigation exposes three primary destinations plus More', () => {
  const block = slice('function BottomNav', 'function ProfileMenu');
  assert.match(block, /grid-cols-4/);
  assert.match(block, /Joburi/);
  assert.match(block, /Review/);
  assert.match(block, /Aplicari/);
  assert.match(block, /Mai multe/);
  assert.match(block, /Criterii de selectie/);
  assert.match(block, /role==='ADMIN'/);
});

test('mobile filters keep search visible and move secondary controls to a bottom sheet', () => {
  const block = slice('function Filters', 'function FitBadge');
  assert.match(block, /sticky top-14/);
  assert.match(block, /Cauta joburi/);
  assert.match(block, /role="dialog"/);
  assert.match(block, /aria-label="Filtre joburi"/);
  assert.match(block, /Vechime/);
  assert.match(block, /Mod de lucru/);
  assert.match(block, /Sortare/);
  assert.match(block, />Aplica</);
});

test('mobile job cards are scan-first, alternating, and have no dedicated Details button', () => {
  const block = slice('function MobileJobCard', 'function JobTable');
  assert.match(block, /index%2===0\?'bg-white':'bg-slate-50'/);
  assert.match(block, /Review/);
  assert.match(block, /Aplica/);
  assert.match(block, /Mai multe actiuni/);
  assert.doesNotMatch(block, />Detalii</);
  assert.doesNotMatch(block, /job\.initial/);
  assert.match(block, /compactKnown/);
});

test('mobile details remain full-screen and provide explicit back navigation', () => {
  const block = slice('function DetailDrawer', 'function ScopeBadge');
  assert.match(block, /fixed inset-0/);
  assert.match(block, /← Inapoi/);
  assert.match(block, /md:max-w-xl/);
});

test('PASS promotion and terminal run states compact on browsing surfaces', () => {
  assert.match(promotion, /compactPass/);
  assert.match(promotion, /data-compact="pass"/);
  assert.match(main, /compactTerminal=\{view!=='admin'\}/);
  assert.match(main, /Rezumat ultima actualizare/);
});

test('existing bounded jobs pagination remains the only incremental loading path', () => {
  assert.match(main, /limit:25,prefetch:25/);
  assert.match(main, /nextCursor/);
  assert.match(main, /Incarca mai multe/);
});
