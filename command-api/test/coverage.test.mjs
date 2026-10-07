import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyCoverageObservation,
  coveragePolicy,
  coverageStateForScopes,
} from '../src/coverage.js';
import { coverageScopeKey } from '../src/retrieve-scope.js';

const pm = {
  role_family:'PROJECT_MANAGEMENT',
  target_regions:['EU'],
  target_country_codes:['RO'],
  remote_eligible_country_codes:['RO'],
  work_modes:['remote','hybrid'],
  contract_types:['contract'],
};

const delivery = {
  role_family:'DELIVERY',
  target_regions:['EU'],
  target_country_codes:['RO'],
  remote_eligible_country_codes:['RO'],
  work_modes:['remote','hybrid'],
  contract_types:['contract'],
};

test('coverage policy is bounded and configuration driven', () => {
  const policy = coveragePolicy({
    collection_freshness_hours:48,
    coverage_min_corpus_volume:12,
    coverage_max_corpus_volume:300,
    coverage_min_source_diversity:4,
    coverage_refresh_cooldown_hours:2,
  });
  assert.deepEqual(policy, {
    collection_freshness_hours:48,
    coverage_min_corpus_volume:12,
    coverage_max_corpus_volume:300,
    coverage_min_source_diversity:4,
    coverage_refresh_cooldown_hours:2,
  });
});

test('coverage state derives SUFFICIENT STALE and INSUFFICIENT dynamically', () => {
  const now = new Date('2026-10-07T12:00:00Z');
  const policy = {
    collection_freshness_hours:24,
    coverage_min_corpus_volume:5,
    coverage_min_source_diversity:2,
  };
  const sufficient = classifyCoverageObservation(pm, {
    last_usable_at:'2026-10-07T10:00:00Z',
    corpus_volume:10,
    source_diversity:3,
    source_ids:['a','b','c'],
  }, policy, now);
  assert.equal(sufficient.state, 'SUFFICIENT');

  const stale = classifyCoverageObservation(pm, {
    last_usable_at:'2026-10-05T10:00:00Z',
    corpus_volume:10,
    source_diversity:3,
  }, policy, now);
  assert.equal(stale.state, 'STALE');
  assert.equal(stale.reason, 'FRESHNESS_EXPIRED');

  const insufficient = classifyCoverageObservation(pm, {
    last_usable_at:'2026-10-07T10:00:00Z',
    corpus_volume:2,
    source_diversity:3,
  }, policy, now);
  assert.equal(insufficient.state, 'INSUFFICIENT');
  assert.equal(insufficient.reason, 'CORPUS_VOLUME_BELOW_MINIMUM');
});

test('two Role Families can have different coverage and only stale slice is planned', async () => {
  const pmKey = coverageScopeKey(pm);
  const deliveryKey = coverageScopeKey(delivery);
  const db = {
    async query(sql, params) {
      if (sql.includes('FROM collection_policy')) {
        return { rows:[{ policy:{
          collection_freshness_hours:24,
          coverage_min_corpus_volume:5,
          coverage_min_source_diversity:2,
        } }] };
      }
      assert.deepEqual(new Set(params[0]), new Set([pmKey, deliveryKey]));
      return { rows:[
        {
          scope_key:pmKey,
          role_family:'PROJECT_MANAGEMENT',
          scope:pm,
          last_usable_run_id:'run-pm',
          last_usable_at:new Date('2026-10-07T10:00:00Z'),
          corpus_volume:20,
          source_diversity:5,
          source_ids:['a','b','c','d','e'],
        },
        {
          scope_key:deliveryKey,
          role_family:'DELIVERY',
          scope:delivery,
          last_usable_run_id:'run-delivery-old',
          last_usable_at:new Date('2026-10-05T10:00:00Z'),
          corpus_volume:20,
          source_diversity:5,
          source_ids:['a','b','c','d','e'],
        },
      ] };
    },
  };

  const result = await coverageStateForScopes(
    [pm, delivery],
    {},
    { db, now:new Date('2026-10-07T12:00:00Z') },
  );

  assert.equal(result.state_counts.SUFFICIENT, 1);
  assert.equal(result.state_counts.STALE, 1);
  assert.equal(result.refresh_scopes.length, 1);
  assert.equal(result.refresh_scopes[0].role_family, 'DELIVERY');
  assert.equal(result.all_sufficient, false);
});

test('scope key is deterministic across ordering noise', () => {
  assert.equal(
    coverageScopeKey(pm),
    coverageScopeKey({
      ...pm,
      target_regions:['EU','EU'],
      target_country_codes:['RO','RO'],
      work_modes:['hybrid','remote'],
    }),
  );
});
