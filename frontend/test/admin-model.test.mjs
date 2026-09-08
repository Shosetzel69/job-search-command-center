import test from 'node:test';
import assert from 'node:assert/strict';
import { adminSourceSummary, categoryDuplicate, sortCategories, sourceGovernanceActions } from '../src/admin-model.mjs';

test('admin source summary separates active, validation and problem states', () => {
  const summary = adminSourceSummary([
    { active:true, validationStatus:'validated', approvalStatus:'approved' },
    { active:false, validationStatus:'pending', approvalStatus:'pending' },
    { active:false, validationStatus:'validating', approvalStatus:'pending' },
    { active:false, validationStatus:'requires_connector', approvalStatus:'pending' },
    { active:false, validationStatus:'validated', approvalStatus:'approved' },
  ]);
  assert.deepEqual(summary, { active:1, validating:2, problems:1, approvedInactive:1 });
});

test('category duplicate detection is trim/case insensitive', () => {
  const categories = [{ id:'banking', label:'Banking si enterprise' }];
  assert.equal(categoryDuplicate(categories, ' banking SI enterprise '), true);
  assert.equal(categoryDuplicate(categories, 'Agentii si recrutare'), false);
});

test('categories are ordered by canonical order then label', () => {
  const rows = sortCategories([
    { id:'b', label:'B', order:20 },
    { id:'c', label:'C', order:10 },
    { id:'a', label:'A', order:10 },
  ]);
  assert.deepEqual(rows.map(row => row.id), ['a','c','b']);
});

test('governance actions keep validation approval activation and disable distinct', () => {
  assert.deepEqual(sourceGovernanceActions({ active:false, validationStatus:'pending', approvalStatus:'pending' }), ['submit_validation','reject']);
  assert.deepEqual(sourceGovernanceActions({ active:false, validationStatus:'validating', approvalStatus:'pending' }), ['mark_validated','mark_requires_connector','reject']);
  assert.deepEqual(sourceGovernanceActions({ active:false, validationStatus:'validated', approvalStatus:'pending' }), ['approve','reject']);
  assert.deepEqual(sourceGovernanceActions({ active:false, validationStatus:'validated', approvalStatus:'approved' }), ['activate','reject']);
  assert.deepEqual(sourceGovernanceActions({ active:true, validationStatus:'validated', approvalStatus:'approved' }), ['disable','reject']);
});
