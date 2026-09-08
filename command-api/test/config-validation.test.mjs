import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  applyUserConfigPatch,
  validateEffectiveSearchConfig,
  validateUserConfigPatch,
} from '../src/index.js';

const nomenclatures = JSON.parse(readFileSync(resolve(process.cwd(), '../data/nomenclatures.json'), 'utf8'));

function baseConfig() {
  return {
    schema_version: '1.0',
    role_groups: {},
    work_modes: { remote: true, hybrid: true, onsite: false },
    contract_types: ['permanent', 'temporary', 'contract', 'freelance'],
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
  const config = validateEffectiveSearchConfig(baseConfig(), nomenclatures);
  assert.deepEqual(config.target_country_codes, ['RO', 'BE', 'LU']);
});

test('empty target geography is rejected', () => {
  const config = { ...baseConfig(), target_country_codes: [], search_country_codes: [], target_regions: [] };
  assert.throws(() => validateEffectiveSearchConfig(config, nomenclatures), /cel putin o tara sau regiune/i);
});

test('country inclusion and exclusion conflict is rejected', () => {
  const config = { ...baseConfig(), excluded_country_codes: ['RO'] };
  assert.throws(() => validateEffectiveSearchConfig(config, nomenclatures), /inclusa si exclusa/i);
});

test('region-country overlap is rejected from canonical membership', () => {
  const config = {
    ...baseConfig(),
    target_regions: ['EU'],
    target_country_codes: [],
    search_country_codes: [],
    excluded_country_codes: ['RO'],
  };
  assert.throws(() => validateEffectiveSearchConfig(config, nomenclatures), /conflict/i);
});

test('Asia canonical membership includes Pakistan', () => {
  const config = {
    ...baseConfig(),
    target_regions: ['ASIA'],
    target_country_codes: [],
    search_country_codes: [],
    excluded_country_codes: ['PK'],
  };
  assert.throws(() => validateEffectiveSearchConfig(config, nomenclatures), /conflict/i);
});

test('unsupported country code is rejected even when syntactically valid', () => {
  assert.throws(
    () => validateUserConfigPatch({ targetCountries:['ZZ'], targetRegions:[] }, nomenclatures),
    /unsupported country code/i,
  );
});

test('patch applies geography canonically to both target fields', () => {
  const patch = validateUserConfigPatch({ targetCountries: ['RO', 'BE'], targetRegions: [] }, nomenclatures);
  const config = applyUserConfigPatch(baseConfig(), patch);
  validateEffectiveSearchConfig(config, nomenclatures);
  assert.deepEqual(config.target_country_codes, ['RO', 'BE']);
  assert.deepEqual(config.search_country_codes, ['RO', 'BE']);
});

test('patch cannot turn effective target into implicit worldwide', () => {
  const patch = validateUserConfigPatch({ targetCountries: [], targetRegions: [] }, nomenclatures);
  const config = applyUserConfigPatch(baseConfig(), patch);
  assert.throws(() => validateEffectiveSearchConfig(config, nomenclatures), /cel putin o tara sau regiune/i);
});

test('onsite is persisted independently from remote and hybrid', () => {
  const patch = validateUserConfigPatch({ workOnsite:true }, nomenclatures);
  const config = applyUserConfigPatch(baseConfig(), patch);
  assert.equal(config.work_modes.onsite, true);
});

test('contract types are validated against active canonical codes', () => {
  const patch = validateUserConfigPatch({ contractTypes:['contract','freelance'] }, nomenclatures);
  const config = applyUserConfigPatch(baseConfig(), patch);
  assert.deepEqual(config.contract_types, ['contract','freelance']);
  assert.throws(
    () => validateUserConfigPatch({ contractTypes:['internship'] }, nomenclatures),
    /unsupported contract type/i,
  );
});

test('legacy JobsPipe run budget maps to its own config field', () => {
  const patch = validateUserConfigPatch({ jobspipeDirectRunBudget:23 }, nomenclatures);
  const config = applyUserConfigPatch(baseConfig(), patch);
  assert.equal(config.jobspipe_credit_budget_per_run, 23);
});
