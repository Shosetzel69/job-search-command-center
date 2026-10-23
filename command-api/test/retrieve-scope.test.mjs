import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildRetrieveRequest,
  canonicalizeRefreshScopes,
  effectiveSourceIds,
  equivalentActiveRun,
  userRefreshScopes,
} from '../src/retrieve-scope.js';

test('USER scope is bounded to at most two major families and carries selected subfamilies without identity fields', () => {
  const scopes = userRefreshScopes({
    target_role_families:[
      'PROJECT_DELIVERY_MANAGEMENT',
      'PRODUCT_AGILE',
      'SERVICE_OPERATIONS_MANAGEMENT',
    ],
    target_role_subfamilies:['project_management','product_owner','service_management'],
    target_regions:['eu'],
    target_country_codes:['ro'],
    remote_eligible_country_codes:['ro'],
    work_modes:{remote:true,hybrid:true,onsite:false},
    contract_types:['contract'],
  });
  assert.equal(scopes.length, 2);
  assert.deepEqual(scopes.map(x => x.role_family), [
    'PROJECT_DELIVERY_MANAGEMENT',
    'PRODUCT_AGILE',
  ]);
  assert.deepEqual(scopes[0].role_subfamilies, ['project_management']);
  assert.deepEqual(scopes[1].role_subfamilies, ['product_owner']);
  assert.deepEqual(scopes[0].target_regions, ['EU']);
  assert.deepEqual(scopes[0].target_country_codes, ['RO']);
  assert.deepEqual(scopes[0].work_modes, ['hybrid','remote']);
  const serialized = JSON.stringify(scopes);
  assert.equal(/tenant_id|user_id|profile_id|search_profile_id/i.test(serialized), false);
});

test('family without explicit subfamily expands to canonical subfamilies for that family', () => {
  const scopes = userRefreshScopes({
    target_role_families:['PRODUCT_AGILE'],
  });
  assert.equal(scopes.length, 1);
  assert.equal(scopes[0].role_family, 'PRODUCT_AGILE');
  assert.deepEqual(scopes[0].role_subfamilies, [
    'agile_scrum',
    'product_management',
    'product_owner',
  ]);
});

test('request signature is deterministic across equivalent scope ordering', () => {
  const a = buildRetrieveRequest({
    collectionFreshnessHours:24,
    scopes:[
      {
        role_family:'PRODUCT_AGILE',
        role_subfamilies:['product_owner','product_management'],
        target_country_codes:['RO'],
        work_modes:['remote'],
      },
      {
        role_family:'PROJECT_DELIVERY_MANAGEMENT',
        role_subfamilies:['project_management'],
        target_country_codes:['RO'],
        work_modes:['remote'],
      },
    ],
  });
  const b = buildRetrieveRequest({
    collectionFreshnessHours:24,
    scopes:[
      {
        role_family:'PROJECT_DELIVERY_MANAGEMENT',
        role_subfamilies:['project_management'],
        target_country_codes:['ro'],
        work_modes:['REMOTE'],
      },
      {
        role_family:'PRODUCT_AGILE',
        role_subfamilies:['product_management','product_owner'],
        target_country_codes:['RO'],
        work_modes:['remote'],
      },
    ],
  });
  assert.equal(a.request_signature, b.request_signature);
  assert.match(a.request_signature, /^[0-9a-f]{64}$/);
  assert.ok(a.scope_summary.source_count > 0);
  assert.deepEqual(a.retrieve_scope.effective_source_ids, effectiveSourceIds());
  assert.equal(a.retrieve_scope.schema_version, '1.1');
});

test('signature changes when family subfamily or freshness changes', () => {
  const project = buildRetrieveRequest({
    collectionFreshnessHours:24,
    scopes:[{role_family:'PROJECT_DELIVERY_MANAGEMENT',role_subfamilies:['project_management']}],
  });
  const delivery = buildRetrieveRequest({
    collectionFreshnessHours:24,
    scopes:[{role_family:'PROJECT_DELIVERY_MANAGEMENT',role_subfamilies:['delivery_management']}],
  });
  const product = buildRetrieveRequest({
    collectionFreshnessHours:24,
    scopes:[{role_family:'PRODUCT_AGILE',role_subfamilies:['product_owner']}],
  });
  const fresher = buildRetrieveRequest({
    collectionFreshnessHours:12,
    scopes:[{role_family:'PROJECT_DELIVERY_MANAGEMENT',role_subfamilies:['project_management']}],
  });
  assert.notEqual(project.request_signature, delivery.request_signature);
  assert.notEqual(project.request_signature, product.request_signature);
  assert.notEqual(project.request_signature, fresher.request_signature);
});

test('active run coalesces only when request signatures are identical', () => {
  const request = buildRetrieveRequest({
    collectionFreshnessHours:24,
    scopes:[{role_family:'PROJECT_DELIVERY_MANAGEMENT',role_subfamilies:['project_management']}],
  });
  assert.equal(equivalentActiveRun({request_signature:request.request_signature}, request), true);
  assert.equal(equivalentActiveRun({request_signature:'0'.repeat(64)}, request), false);
  assert.equal(equivalentActiveRun({request_signature:null}, request), false);
});

test('canonical scope excludes arbitrary family and requires a canonical subfamily', () => {
  const scopes = canonicalizeRefreshScopes([
    {role_family:'PROJECT_DELIVERY_MANAGEMENT',role_subfamilies:['project_management']},
    {role_family:'INJECTED_PROVIDER_SCOPE',role_subfamilies:['project_management']},
    {role_family:'PRODUCT_AGILE',role_subfamilies:['not_real']},
  ]);
  assert.deepEqual(scopes.map(x => x.role_family), ['PROJECT_DELIVERY_MANAGEMENT']);
});
