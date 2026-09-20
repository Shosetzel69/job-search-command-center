import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  assertNomenclatures,
  countryLabel,
  countryOptions,
  normalizeCountryNames,
  geographyConflicts,
  geographyIndex,
  regionOptions,
} from '../../shared/nomenclatures.mjs';

const payload = JSON.parse(readFileSync(resolve(process.cwd(), '../data/nomenclatures.json'), 'utf8'));

test('canonical nomenclatures expose geography used by UI', () => {
  assertNomenclatures(payload);
  assert.equal(countryLabel(payload, 'RO'), 'Romania');
  assert.ok(countryOptions(payload).some(([code]) => code === 'BE'));
  assert.deepEqual(regionOptions(payload).map(([code]) => code), ['EU', 'US', 'ASIA']);
});

test('canonical region membership drives conflict checks', () => {
  assert.equal(geographyConflicts({ targetRegions:['EU'], excludedCountries:['RO'] }, payload), true);
  assert.equal(geographyConflicts({ targetRegions:['US'], excludedCountries:['RO'] }, payload), false);
});

test('Asia membership includes Pakistan consistently with engine semantics', () => {
  const index = geographyIndex(payload);
  assert.equal(index.membership.get('ASIA').has('PK'), true);
});

test('country aliases collapse to one canonical display label', () => {
  assert.deepEqual(
    normalizeCountryNames(payload, { countries:['Belgium','Belgia'], countryCodes:['BE'] }),
    ['Belgia'],
  );
  assert.deepEqual(
    normalizeCountryNames(payload, { countries:['Unknownland','Unknownland'], countryCodes:[] }),
    ['Unknownland'],
  );
});
