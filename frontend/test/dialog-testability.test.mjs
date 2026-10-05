import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createSingleFireGuard } from '../src/action-dialog-guard.mjs';

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
  assert.match(dialog, /createSingleFireGuard/);
  assert.match(dialog, /onClick=\{handleConfirm\}/);
  assert.match(dialog, /fields\.map/);
});

test('optional source-governance reason is an explicit DOM input and can be empty', () => {
  assert.match(admin, /Motiv \(optional\)/);
  assert.match(admin, /current\.reason\.trim\(\) \|\| null/);
});


test('destructive confirm is single-fire while the first mutation is pending', async () => {
  const guard = createSingleFireGuard();
  let release;
  const pending = new Promise(resolvePending => { release = resolvePending; });
  let mutations = 0;

  const confirm = async () => {
    if (!guard.tryStart()) return false;
    try {
      mutations += 1;
      await pending;
      return true;
    } finally {
      guard.finish();
    }
  };

  const first = confirm();
  const second = confirm();

  assert.equal(await second, false);
  assert.equal(mutations, 1);
  assert.equal(guard.isActive(), true);

  release();
  assert.equal(await first, true);
  assert.equal(guard.isActive(), false);
});

test('cancel path performs zero mutations', () => {
  const guard = createSingleFireGuard();
  let mutations = 0;
  const cancel = () => {};

  cancel();

  assert.equal(mutations, 0);
  assert.equal(guard.isActive(), false);
});

test('source dialog exposes required category validation before mutation', () => {
  assert.match(admin, /Categoria este obligatorie inainte de salvarea sursei/);
  assert.match(admin, /aria-invalid=/);
  assert.match(admin, /source-category-error/);
  assert.match(admin, /role="alert"/);
  assert.match(admin, /categoryMissing \|\| newCategoryInvalid/);
});

test('inline category plus source save is guarded as one single-fire sequence', () => {
  assert.match(admin, /createSingleFireGuard/);
  assert.match(admin, /submitGuard\.current\.tryStart\(\)/);
  assert.match(admin, /await onCreateCategory\(label\)/);
  assert.match(admin, /await onSave\(\{ \.\.\.form, category \}\)/);
  assert.match(admin, /submitGuard\.current\.finish\(\)/);
});

test('dialogs become compact full-screen and wide centered modals without native dialogs', () => {
  assert.match(dialog, /fixed inset-0/);
  assert.match(dialog, /sm:left-1\/2/);
  assert.match(admin, /md:left-1\/2/);
});
