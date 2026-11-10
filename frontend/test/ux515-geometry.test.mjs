import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {evaluateJobGeometry} from './ux515-geometry.mjs';

const main = await readFile(new URL('../src/main.jsx', import.meta.url), 'utf8');
const box = (left, top, width, height) => ({
  left, top, right: left + width, bottom: top + height, width, height,
});

// 25 long-publication rows, mirroring the populated DEV regression reported in #515.
// Fixtures are geometry snapshots. Actual CSS geometry must ALSO be checked in a
// browser after an authorized DEV deployment using captureJobGeometry().
function fixture(viewportWidth) {
  const left = viewportWidth >= 768 ? 278 : 12; // desktop sidebar / mobile gutter
  const right = viewportWidth - 24;
  const width = right - left;
  const wide = viewportWidth >= 1280;
  const labelled = viewportWidth >= 1536;
  const rows = Array.from({length: 25}, (_, i) => {
    const y = 120 + i * 74;
    const rowRect = box(left, y, width, 68);
    const roleRect = box(left + 12, y + 8, wide ? 220 : width - 24, 46);
    const actionsWidth = labelled ? 390 : wide ? 185 : 176;
    const actionsLeft = wide ? right - 12 - actionsWidth : left + 12;
    const actionsRect = box(actionsLeft, wide ? y + 12 : y + 22, actionsWidth, 44);
    const widths = labelled ? [81, 88, 84, 105] : wide ? [40, 40, 40, 40] : [44, 44, 44];
    let x = actionsLeft + 4;
    const controls = widths.map((w, idx) => {
      const item = {rect: box(x, actionsRect.top + 2, w, 40), label: `Actiune ${idx}`, title: `Actiune ${idx}`};
      x += w + (labelled ? 8 : 4);
      return item;
    });
    return {
      id: i + 1, rowRect, roleRect, actionsRect, controls,
      publication: 'data publicării necunoscută',
      publishedRect: wide ? box(actionsLeft - 125, y + 20, 112, 20) : null,
    };
  });
  return {viewportWidth, tableRect: box(left, 90, width, 25 * 74 + 40), rows};
}

test('25 populated rows meet responsive geometry contract at six widths', () => {
  for (const width of [375, 390, 768, 1024, 1280, 1536]) {
    const snapshot = fixture(width);
    const result = evaluateJobGeometry(snapshot);
    assert.deepEqual(result.failures, [], `width ${width}: ${result.failures.join('; ')}`);
    assert.equal(result.checkedRows, 25);
    assert.equal(result.pass, true);
  }
});

test('detects the original #515 PUBLICAT/action overlap in actual rectangle coordinates', () => {
  const snapshot = fixture(1536);
  const row = snapshot.rows[4];
  row.publishedRect = box(row.actionsRect.left + 14, row.actionsRect.top + 8, 120, 24);
  const result = evaluateJobGeometry(snapshot);
  assert.equal(result.pass, false);
  assert.match(result.failures.join('\n'), /row 5: PUBLICAT overlaps action group/);
});

test('detects zero-width ROL at tablet widths and clipped actions', () => {
  const snapshot = fixture(768);
  snapshot.rows[0].roleRect = box(280, 128, 0, 46);
  snapshot.rows[1].controls[2].rect = box(751, 225, 50, 40);
  const failures = evaluateJobGeometry(snapshot).failures.join('\n');
  assert.match(failures, /row 1: ROL not readable/);
  assert.match(failures, /row 2: action 3 clipped\/off-screen/);
});

test('detects missing icon-only aria-label/title and absent real job data', () => {
  const snapshot = fixture(1024);
  snapshot.rows[0].controls[0].label = '';
  snapshot.rows[1].controls[0].title = '';
  const failures = evaluateJobGeometry(snapshot).failures.join('\n');
  assert.match(failures, /row 1: action 1 missing accessible name\/title/);
  assert.match(failures, /row 2: action 1 missing accessible name\/title/);
  const empty = evaluateJobGeometry({...snapshot, rows: []});
  assert.match(empty.failures.join('\n'), /Expected at least 25 populated/);
});

test('source geometry aligns with tested xl/2xl breakpoints and real DOM markers', () => {
  const table = main.slice(main.indexOf('function JobTable('), main.indexOf('function ErrorPanel('));
  assert.match(table, /xl:grid-cols-\[minmax\(12rem,1fr\)_110px_64px_90px_105px_200px\]/);
  assert.match(table, /2xl:grid-cols-\[minmax\(12rem,1fr\)_120px_72px_100px_125px_400px\]/);
  assert.match(table, /data-testid="job-row"/);
  assert.match(table, /data-testid="job-role"/);
  assert.match(table, /data-testid="job-published"/);
  assert.match(table, /data-testid="job-actions"/);
  assert.match(table, /data-testid="job-card-actions"/);
  assert.match(table, /xl:hidden/); // under 1280 -> card, not zero-width desktop grid
  for (const action of ['Detalii job', 'Review job', 'Aplica la job', 'Arhiveaza job']) {
    assert.ok(table.includes(`title="${action}" aria-label="${action}"`));
  }
  assert.match(table, /hidden 2xl:inline/); // wide text, intermediate icon-only
});

test('D515-01/D515-03 use named, expandable and keyboard-operable controls', () => {
  const profile = main.slice(main.indexOf('function ProfileMenu('), main.indexOf('function EnvironmentMarker('));
  assert.match(profile, /aria-label="Meniu cont" title="Meniu cont"/);
  assert.match(profile, /aria-haspopup="dialog"/);
  assert.match(profile, /aria-expanded=\{open\}/);
  assert.match(profile, /event\.key==='Escape'/);
  const filters = main.slice(main.indexOf('function Filters('), main.indexOf('function FitBadge('));
  assert.match(filters, /aria-expanded=\{mobileOpen\}/);
  assert.match(filters, /id="jscc-mobile-filters"/);
  assert.match(filters, /aria-label="Inchide filtrele" title="Inchide filtrele"/);
});
