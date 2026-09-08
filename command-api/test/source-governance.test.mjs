import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applySourceAction,
  newPendingSource,
  normalizeCategoryCatalog,
  normalizeSource,
} from '../src/source-governance.js';

test('category catalog rejects labels duplicated after trim/case normalization', () => {
  assert.throws(() => normalizeCategoryCatalog({
    schema_version: '1.0',
    categories: [
      { id:'a', label:'Banking si enterprise', active:true, order:10 },
      { id:'b', label:' banking SI enterprise ', active:true, order:20 },
    ],
  }), /Categorie duplicata/);
});

test('new source starts pending and inactive even when connector is detectable', () => {
  const source = newPendingSource({
    name:'Greenhouse tenant',
    url:'https://boards.greenhouse.io/example',
    category:'ATS publice',
  }, 'src-test');
  assert.equal(source.id, 'src-test');
  assert.equal(source.validation_status, 'pending');
  assert.equal(source.approval_status, 'pending');
  assert.equal(source.active, false);
});

test('approval is blocked before technical validation', () => {
  const source = newPendingSource({
    name:'Example',
    url:'https://example.com/jobs',
    category:'ATS publice',
  }, 'src-test');
  assert.throws(() => applySourceAction(source, 'approve'), /Doar o sursa validata poate fi aprobata/);
});

test('validation, approval and activation are distinct transitions', () => {
  let source = newPendingSource({
    name:'Example',
    url:'https://example.com/jobs',
    category:'ATS publice',
  }, 'src-test');
  source = applySourceAction(source, 'submit_validation');
  assert.equal(source.validation_status, 'validating');
  assert.equal(source.active, false);
  source = applySourceAction(source, 'mark_validated', { now:'2026-09-08T18:00:00Z' });
  assert.equal(source.validation_status, 'validated');
  assert.equal(source.approval_status, 'pending');
  assert.equal(source.active, false);
  source = applySourceAction(source, 'approve');
  assert.equal(source.approval_status, 'approved');
  assert.equal(source.active, false);
  source = applySourceAction(source, 'activate');
  assert.equal(source.active, true);
});

test('requires connector cannot be activated', () => {
  let source = newPendingSource({
    name:'Example',
    url:'https://example.com/jobs',
    category:'ATS publice',
  }, 'src-test');
  source = applySourceAction(source, 'submit_validation');
  source = applySourceAction(source, 'mark_requires_connector', { reason:'Connector lipsa' });
  assert.equal(source.validation_status, 'requires_connector');
  assert.throws(() => applySourceAction(source, 'activate'), /Sursa trebuie validata si aprobata/);
});

test('legacy executable source is normalized as approved/validated', () => {
  const source = normalizeSource({
    id:'src-jobicy',
    name:'Jobicy',
    url:'https://jobicy.com/',
    category:'Job boards si agregatoare',
    active:true,
  });
  assert.equal(source.validation_status, 'validated');
  assert.equal(source.approval_status, 'approved');
  assert.equal(source.active, true);
});
