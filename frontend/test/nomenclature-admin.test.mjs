import test from 'node:test';
import assert from 'node:assert/strict';

import nomenclatures from '../../data/nomenclatures.json' with { type:'json' };
import {
  NOMENCLATURE_DOMAIN_ORDER,
  domainIsExtensible,
  domainLabel,
  domainNote,
  errorMessageWithReferences,
  sortedDomainValues,
} from '../src/nomenclature-admin-model.mjs';

test('all canonical nomenclature domains have admin labels', () => {
  assert.deepEqual(NOMENCLATURE_DOMAIN_ORDER, ['regions','countries','work_modes','contract_types','application_statuses','seniority']);
  for (const name of NOMENCLATURE_DOMAIN_ORDER) assert.notEqual(domainLabel(name), name);
});

test('application statuses are extensible while semantic domains are system controlled', () => {
  assert.equal(domainIsExtensible(nomenclatures.domains.application_statuses), true);
  for (const name of ['regions','countries','work_modes','contract_types','seniority']) {
    assert.equal(domainIsExtensible(nomenclatures.domains[name]), false, name);
  }
});

test('work mode admin values expose only Remote Hibrid Onsite and not N/A', () => {
  const values = sortedDomainValues(nomenclatures.domains.work_modes);
  assert.deepEqual(values.map(item => item.code), ['remote','hybrid','onsite']);
  assert.equal(values.some(item => /N\/A/i.test(item.label)), false);
  assert.match(domainNote('work_modes', nomenclatures.domains.work_modes), /Unknown.*tehnica/i);
});

test('seniority is explicitly infrastructure-only', () => {
  assert.deepEqual(nomenclatures.domains.seniority.values, []);
  assert.match(domainNote('seniority', nomenclatures.domains.seniority), /nu este filtru functional/i);
});

test('409 references are rendered in an actionable error message', () => {
  const error = Object.assign(new Error('Valoarea este folosita.'), { references:['search-config.target_regions','applications.status'] });
  const text = errorMessageWithReferences(error);
  assert.match(text, /search-config\.target_regions/);
  assert.match(text, /applications\.status/);
});
