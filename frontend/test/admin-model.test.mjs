import test from 'node:test';
import assert from 'node:assert/strict';
import { adminSourceSummary, approvalSourceRows, categoryDuplicate, sortCategories, sortSources, sourceGovernanceActions, sourceNeedsGovernanceAttention, sourcePolicyExcluded } from '../src/admin-model.mjs';

test('admin source summary separates active, validation and problem states', () => {
  const summary = adminSourceSummary([
    { active:true, validationStatus:'validated', approvalStatus:'approved' },
    { active:false, validationStatus:'pending', approvalStatus:'pending' },
    { active:false, validationStatus:'validating', approvalStatus:'pending' },
    { active:false, validationStatus:'requires_connector', approvalStatus:'pending' },
    { active:false, validationStatus:'validated', approvalStatus:'approved' },
  ]);
  assert.deepEqual(summary, { total:5, active:1, inactive:4, pendingApproval:3, validated:2, validating:2, problems:1, approvedInactive:1, policyExcluded:0 });
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

test('Monster is displayed as policy excluded and cannot expose activation actions', () => {
  const monster = { name:'Monster', active:true, validationStatus:'validated', approvalStatus:'approved' };
  assert.equal(sourcePolicyExcluded(monster), true);
  assert.deepEqual(sourceGovernanceActions(monster), []);
  assert.deepEqual(adminSourceSummary([monster]), { total:1, active:0, inactive:1, pendingApproval:0, validated:1, validating:0, problems:0, approvedInactive:1, policyExcluded:1 });
});


test('sources use one canonical alphabetical ordering', () => {
  const rows = sortSources([{name:'Zulu'},{name:'Alpha'},{name:'beta'}]);
  assert.deepEqual(rows.map(row => row.name), ['Alpha','beta','Zulu']);
});

test('approval default exposes only governance attention and all mode remains inspectable', () => {
  const rows = [
    {name:'Approved active',active:true,validationStatus:'validated',approvalStatus:'approved'},
    {name:'Pending approval',active:false,validationStatus:'validated',approvalStatus:'pending'},
    {name:'Needs connector',active:false,validationStatus:'requires_connector',approvalStatus:'pending'},
    {name:'Monster',active:false,validationStatus:'validated',approvalStatus:'approved'},
  ];
  assert.equal(sourceNeedsGovernanceAttention(rows[0]), false);
  assert.equal(sourceNeedsGovernanceAttention(rows[1]), true);
  assert.deepEqual(approvalSourceRows(rows).map(row => row.name), ['Needs connector','Pending approval']);
  assert.deepEqual(approvalSourceRows(rows,{mode:'all'}).map(row => row.name), ['Approved active','Monster','Needs connector','Pending approval']);
});