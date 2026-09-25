import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const shell = readFileSync(new URL('../src/admin-shell.jsx', import.meta.url), 'utf8');

test('source run table has explicit sortable headers', () => {
  for (const [key,label] of [
    ['source','Sursa'],
    ['status','Stare'],
    ['records','Joburi'],
    ['diagnostic','Diagnostic'],
  ]) {
    assert.match(shell, new RegExp("toggleSourceSort\\('"+key+"'\\)"));
    assert.match(shell, new RegExp(label));
  }
  assert.match(shell, /sortMark\('source'\)/);
  assert.match(shell, /sourceDiagnosticText\(item\)/);
});
