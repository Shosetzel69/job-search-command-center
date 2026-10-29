import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { ROLE_FAMILIES } from '../../shared/role-taxonomy-runtime.mjs';
import { selectRoleFamily } from '../src/role-family-selection.mjs';

test('Criteria preserves 3 migrated families until explicit deselection and enforces 2-family limit', () => {
  const before = { roleFamilies:['PROJECT_DELIVERY_MANAGEMENT','SERVICE_OPERATIONS_MANAGEMENT','PRODUCT_AGILE'],
    roleSubfamilies:['project_management','service_management','agile_scrum'], targetCountries:['RO'] };
  const service = ROLE_FAMILIES.find(x => x.code==='SERVICE_OPERATIONS_MANAGEMENT');
  const technical = ROLE_FAMILIES.find(x => x.code==='TECHNICAL_LEADERSHIP_ARCHITECTURE');
  assert.equal(before.roleFamilies.length, 3);
  const after = selectRoleFamily(before,service,false);
  assert.deepEqual(after.roleFamilies,['PROJECT_DELIVERY_MANAGEMENT','PRODUCT_AGILE']);
  assert.deepEqual(after.roleSubfamilies,['project_management','agile_scrum']);
  assert.deepEqual(before.roleFamilies,['PROJECT_DELIVERY_MANAGEMENT','SERVICE_OPERATIONS_MANAGEMENT','PRODUCT_AGILE']);
  assert.deepEqual(after.targetCountries,['RO']);
  assert.equal(selectRoleFamily(after,technical,true),after,'3rd family cannot be re-added');
  assert.deepEqual(selectRoleFamily(after,service,false),after,'deselection is idempotent');
});
test('real UI wires checked migrated families to the tested Criteria transition and warning', async () => {
  const src=await readFile(new URL('../src/main.jsx',import.meta.url),'utf8');
  assert.match(src,/ROLE_FAMILIES\.map\(family=>/);
  assert.match(src,/checked=\{familySelected\}/);
  assert.match(src,/setDraft\(current=>selectRoleFamily\(current,family,checked\)\)/);
  assert.match(src,/tooManyRoleFamilies=\(draft\.roleFamilies\|\|\[\]\)\.length>2/);
  assert.match(src,/Pastreaza maximum doua familii pentru Retrieve/);
});
