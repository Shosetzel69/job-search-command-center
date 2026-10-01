import test from 'node:test';
import assert from 'node:assert/strict';

import nomenclatures from '../../data/nomenclatures.json' with { type:'json' };
import {
  addNomenclatureValue,
  deleteNomenclatureValue,
  nomenclatureReferences,
  updateNomenclatureValue,
} from '../src/nomenclature-governance.js';

function catalog() {
  return structuredClone(nomenclatures);
}

const baseContext = {
  searchConfig: {
    target_regions:['EU'],
    target_country_codes:[],
    search_country_codes:[],
    excluded_regions:[],
    excluded_country_codes:['AF'],
    work_modes:{ remote:true, hybrid:true, onsite:false },
    contract_types:['permanent','temporary','contract','freelance'],
  },
  applications: {
    schema_version:'1.0',
    applications:[{ id:'a1', status:'applied' }],
  },
};

test('system nomenclature does not allow arbitrary add or delete', () => {
  assert.throws(() => addNomenclatureValue(catalog(), 'regions', { code:'EUROPE', label:'Europa' }), /controlat de sistem/i);
  assert.throws(() => deleteNomenclatureValue(catalog(), 'work_modes', 'remote', baseContext), /controlate de sistem/i);
});

test('system code is immutable while label and order can change', () => {
  const value = catalog();
  updateNomenclatureValue(value, 'regions', 'EU', { label:'UE', sort_order:5 }, baseContext);
  const eu = value.domains.regions.values.find(item => item.code === 'EU');
  assert.equal(eu.label, 'UE');
  assert.equal(eu.sort_order, 5);
  assert.throws(() => updateNomenclatureValue(value, 'regions', 'EU', { code:'EUROPE' }, baseContext), /nu poate fi modificat/i);
});

test('referenced region cannot be deactivated and references are preserved', () => {
  assert.throws(
    () => updateNomenclatureValue(catalog(), 'regions', 'EU', { active:false }, baseContext),
    error => error.status === 409 && error.references.includes('search-config.target_regions'),
  );
});

test('country used by active region membership cannot be deactivated', () => {
  assert.throws(
    () => updateNomenclatureValue(catalog(), 'countries', 'RO', { active:false }, baseContext),
    error => error.status === 409 && error.references.includes('nomenclatures.regions.EU.country_codes'),
  );
});

test('configured work mode and contract type cannot be deactivated', () => {
  assert.throws(
    () => updateNomenclatureValue(catalog(), 'work_modes', 'remote', { active:false }, baseContext),
    error => error.status === 409 && error.references.includes('search-config.work_modes.remote'),
  );
  assert.throws(
    () => updateNomenclatureValue(catalog(), 'contract_types', 'contract', { active:false }, baseContext),
    error => error.status === 409 && error.references.includes('search-config.contract_types'),
  );
});

test('applied application status is protected by application history', () => {
  const refs = nomenclatureReferences('application_statuses', 'applied', { ...baseContext, nomenclatures:catalog(), dbReferenceCount:2 });
  assert.deepEqual(refs, ['applications.status', 'database.application_statuses']);
  assert.throws(
    () => deleteNomenclatureValue(catalog(), 'application_statuses', 'applied', baseContext),
    error => error.status === 409 && error.references.includes('applications.status'),
  );
});

test('extensible application statuses allow add edit deactivate and unreferenced delete', () => {
  const value = catalog();
  addNomenclatureValue(value, 'application_statuses', { code:'interview', label:'Interviu' });
  updateNomenclatureValue(value, 'application_statuses', 'interview', { label:'Interviu programat', active:false, sort_order:20 }, baseContext);
  const item = value.domains.application_statuses.values.find(entry => entry.code === 'interview');
  assert.deepEqual(item, { code:'interview', label:'Interviu programat', active:false, sort_order:20 });
  deleteNomenclatureValue(value, 'application_statuses', 'interview', baseContext);
  assert.equal(value.domains.application_statuses.values.some(entry => entry.code === 'interview'), false);
});

test('duplicate labels are rejected case and trim insensitive', () => {
  const value = catalog();
  assert.throws(
    () => addNomenclatureValue(value, 'application_statuses', { code:'another', label:'  APLICAT  ' }),
    /exista deja valoarea/i,
  );
});
