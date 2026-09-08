import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { validateEffectiveSearchConfig } from '../src/index.js';
import { assertNomenclatures, activeCodes } from '../../shared/nomenclatures.mjs';

const root = resolve(process.cwd(), '..');
const readJson = path => JSON.parse(readFileSync(resolve(root, path), 'utf8'));

const nomenclatures = assertNomenclatures(readJson('data/nomenclatures.json'));
const searchConfig = readJson('data/search-config.json');
const applications = readJson('data/applications.json');

test('persisted search config is accepted without semantic mutation', () => {
  const input = structuredClone(searchConfig);
  const result = validateEffectiveSearchConfig(input, nomenclatures);
  assert.deepEqual(result, searchConfig);
  assert.equal(result.work_modes.remote, true);
  assert.equal(result.work_modes.hybrid, true);
  assert.equal(typeof result.work_modes.onsite, 'boolean');
});

test('persisted configuration references only active canonical values', () => {
  const regions = activeCodes(nomenclatures, 'regions');
  const countries = activeCodes(nomenclatures, 'countries');
  const contractTypes = activeCodes(nomenclatures, 'contract_types');
  for (const value of [...(searchConfig.target_regions || []), ...(searchConfig.excluded_regions || [])]) assert.ok(regions.has(value), `region ${value}`);
  for (const value of [...(searchConfig.target_country_codes || []), ...(searchConfig.excluded_country_codes || [])]) assert.ok(countries.has(value), `country ${value}`);
  for (const value of searchConfig.contract_types || []) assert.ok(contractTypes.has(value), `contract type ${value}`);
});

test('application history references valid active application statuses', () => {
  const statuses = activeCodes(nomenclatures, 'application_statuses');
  assert.ok(statuses.has('applied'));
  for (const application of applications.applications || []) {
    assert.ok(statuses.has(application.status), `invalid application status: ${application.status}`);
  }
});

test('technical unknown values are not canonical selectable values', () => {
  assert.deepEqual([...activeCodes(nomenclatures, 'work_modes')].sort(), ['hybrid','onsite','remote']);
  assert.equal(activeCodes(nomenclatures, 'work_modes').has('unknown'), false);
  assert.equal(activeCodes(nomenclatures, 'contract_types').has('unknown'), false);
});

test('nomenclature admin module cannot dispatch a full search', () => {
  const source = readFileSync(resolve(root, 'command-api/src/nomenclature-api.js'), 'utf8');
  assert.doesNotMatch(source, /actions\/workflows|workflow_dispatch|dispatchRun|commands\/run/);
});
