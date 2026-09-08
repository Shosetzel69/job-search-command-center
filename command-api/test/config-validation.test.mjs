import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyUserConfigPatch,
  validateEffectiveSearchConfig,
  validateUserConfigPatch,
} from '../src/index.js';

function baseConfig() {
  return {
    schema_version: '1.0',
    role_groups: {},
    work_modes: { remote: true, hybrid: true },
    rate_min_eur_day: 250,
    rate_max_eur_day: 650,
    target_regions: [],
    target_country_codes: ['RO', 'BE', 'LU'],
    search_country_codes: ['RO', 'BE', 'LU'],
    excluded_regions: [],
    excluded_country_codes: [],
    jobspipe_mode: 'disabled',
  };
}

test('valid configuration keeps explicit target geography', () => {
  const config = validateEffectiveSearchConfig(baseConfig());
  assert.deepEqual(config.target_country_codes, ['RO', 'BE', 'LU']);
});

test('empty target geography is rejected', () => {
  const config = { ...baseConfig(), target_country_codes: [], search_country_codes: [], target_regions: [] };
  assert.throws(() => validateEffectiveSearchConfig(config), /cel putin o tara sau regiune/i);
});

test('country inclusion and exclusion conflict is rejected', () => {
  const config = { ...baseConfig(), excluded_country_codes: ['RO'] };
  assert.throws(() => validateEffectiveSearchConfig(config), /inclusa si exclusa/i);
});

test('region-country overlap is rejected', () => {
  const config = {
    ...baseConfig(),
    target_regions: ['EU'],
    target_country_codes: [],
    search_country_codes: [],
    excluded_country_codes: ['RO'],
  };
  assert.throws(() => validateEffectiveSearchConfig(config), /conflict/i);
});

test('patch applies geography canonically to both target fields', () => {
  const patch = validateUserConfigPatch({ targetCountries: ['RO', 'BE'], targetRegions: [] });
  const config = applyUserConfigPatch(baseConfig(), patch);
  validateEffectiveSearchConfig(config);
  assert.deepEqual(config.target_country_codes, ['RO', 'BE']);
  assert.deepEqual(config.search_country_codes, ['RO', 'BE']);
});

test('patch cannot turn effective target into implicit worldwide', () => {
  const patch = validateUserConfigPatch({ targetCountries: [], targetRegions: [] });
  const config = applyUserConfigPatch(baseConfig(), patch);
  assert.throws(() => validateEffectiveSearchConfig(config), /cel putin o tara sau regiune/i);
});
