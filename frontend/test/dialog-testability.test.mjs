import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const admin = readFileSync(resolve(ROOT, 'src/admin-shell.jsx'), 'utf8');
const nomenclatures = readFileSync(resolve(ROOT, 'src/nomenclatures-admin.jsx'), 'utf8');
const dialog = readFileSync(resolve(ROOT, 'src/action-dialog.jsx'), 'utf8');

test('autonomous Admin/Nomenclature paths contain no browser-native dialogs', () => {
  for (const [name,source] of [['admin-shell.jsx',admin],['nomenclatures-admin.jsx',nomenclatures]]) {
    assert.doesNotMatch(source, /window\.(?:confirm|prompt|alert)\s*\(/, name);
  }
});

test('in-app action dialog is DOM addressable and has independent cancel/confirm controls', () => {
  assert.match(dialog, /role="dialog"/);
  assert.match(dialog, /aria-modal="true"/);
  assert.match(dialog, /onClick=\{onCancel\}/);
  assert.match(dialog, /onClick=\{onConfirm\}/);
  assert.match(dialog, /fields\.map/);
});

test('optional source-governance reason is an explicit DOM input and can be empty', () => {
  assert.match(admin, /Motiv \(optional\)/);
  assert.match(admin, /current\.reason\.trim\(\) \|\| null/);
});
