import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildRetrieveRequest,
  canonicalizeRefreshScopes,
  effectiveSourceIds,
  equivalentActiveRun,
  userRefreshScopes,
} from '../src/retrieve-scope.js';

test('USER scope is bounded to at most two role families and contains no identity fields', () => {
  const scopes = userRefreshScopes({
    target_role_families:['PROJECT_MANAGEMENT','DELIVERY','SERVICE_MANAGEMENT'],
    target_regions:['eu'],
    target_country_codes:['ro'],
    remote_eligible_country_codes:['ro'],
    work_modes:{remote:true,hybrid:true,onsite:false},
    contract_types:['contract'],
  });
  assert.equal(scopes.length, 2);
  assert.deepEqual(scopes.map(x => x.role_family), ['PROJECT_MANAGEMENT','DELIVERY']);
  assert.deepEqual(scopes[0].target_regions, ['EU']);
  assert.deepEqual(scopes[0].target_country_codes, ['RO']);
  assert.deepEqual(scopes[0].work_modes, ['hybrid','remote']);
  const serialized = JSON.stringify(scopes);
  assert.equal(/tenant_id|user_id|profile_id|search_profile_id/i.test(serialized), false);
});

test('legacy role groups derive only explicitly enabled USER families', () => {
  const scopes = userRefreshScopes({
    role_groups:{
      pm:{enabled:true},
      delivery:{enabled:false},
      service:{enabled:true},
      scrum:{enabled:true},
    },
  });
  assert.deepEqual(scopes.map(x => x.role_family), ['PROJECT_MANAGEMENT','SERVICE_MANAGEMENT']);
});

test('request signature is deterministic across equivalent scope ordering', () => {
  const a = buildRetrieveRequest({
    collectionFreshnessHours:24,
    scopes:[
      {role_family:'DELIVERY',target_country_codes:['RO'],work_modes:['remote']},
      {role_family:'PROJECT_MANAGEMENT',target_country_codes:['RO'],work_modes:['remote']},
    ],
  });
  const b = buildRetrieveRequest({
    collectionFreshnessHours:24,
    scopes:[
      {role_family:'PROJECT_MANAGEMENT',target_country_codes:['ro'],work_modes:['REMOTE']},
      {role_family:'DELIVERY',target_country_codes:['RO'],work_modes:['remote']},
    ],
  });
  assert.equal(a.request_signature, b.request_signature);
  assert.match(a.request_signature, /^[0-9a-f]{64}$/);
  assert.ok(a.scope_summary.source_count > 0);
  assert.deepEqual(a.retrieve_scope.effective_source_ids, effectiveSourceIds());
});

test('signature changes when bounded scope or freshness changes', () => {
  const pm = buildRetrieveRequest({collectionFreshnessHours:24,scopes:[{role_family:'PROJECT_MANAGEMENT'}]});
  const delivery = buildRetrieveRequest({collectionFreshnessHours:24,scopes:[{role_family:'DELIVERY'}]});
  const fresher = buildRetrieveRequest({collectionFreshnessHours:12,scopes:[{role_family:'PROJECT_MANAGEMENT'}]});
  assert.notEqual(pm.request_signature, delivery.request_signature);
  assert.notEqual(pm.request_signature, fresher.request_signature);
});

test('active run coalesces only when request signatures are identical', () => {
  const request = buildRetrieveRequest({collectionFreshnessHours:24,scopes:[{role_family:'PROJECT_MANAGEMENT'}]});
  assert.equal(equivalentActiveRun({request_signature:request.request_signature}, request), true);
  assert.equal(equivalentActiveRun({request_signature:'0'.repeat(64)}, request), false);
  assert.equal(equivalentActiveRun({request_signature:null}, request), false);
});

test('canonical scope excludes arbitrary unsupported family names', () => {
  const scopes = canonicalizeRefreshScopes([
    {role_family:'PROJECT_MANAGEMENT'},
    {role_family:'INJECTED_PROVIDER_SCOPE'},
  ]);
  assert.deepEqual(scopes.map(x => x.role_family), ['PROJECT_MANAGEMENT']);
});
