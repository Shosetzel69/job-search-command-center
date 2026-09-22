import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  applySourceAction,
  dedicatedRouteActivationGate,
  newPendingSource,
  normalizeCategoryCatalog,
  normalizeSource,
} from '../src/source-governance.js';

test('category catalog rejects labels duplicated after trim/case normalization', () => {
  assert.throws(() => normalizeCategoryCatalog({
    schema_version: '1.0',
    categories: [
      { id:'a', label:'Banking si enterprise', active:true, order:10 },
      { id:'b', label:' banking SI enterprise ', active:true, order:20 },
    ],
  }), /Categorie duplicata/);
});

test('new source starts pending and inactive even when connector is detectable', () => {
  const source = newPendingSource({
    name:'Greenhouse tenant',
    url:'https://boards.greenhouse.io/example',
    category:'ATS publice',
  }, 'src-test');
  assert.equal(source.id, 'src-test');
  assert.equal(source.validation_status, 'pending');
  assert.equal(source.approval_status, 'pending');
  assert.equal(source.active, false);
});

test('approval is blocked before technical validation', () => {
  const source = newPendingSource({
    name:'Example',
    url:'https://example.com/jobs',
    category:'ATS publice',
  }, 'src-test');
  assert.throws(() => applySourceAction(source, 'approve'), /Doar o sursa validata poate fi aprobata/);
});

test('validation, approval and activation are distinct transitions', () => {
  let source = newPendingSource({
    name:'Example',
    url:'https://example.com/jobs',
    category:'ATS publice',
  }, 'src-test');
  source = applySourceAction(source, 'submit_validation');
  assert.equal(source.validation_status, 'validating');
  assert.equal(source.active, false);
  source = applySourceAction(source, 'mark_validated', { now:'2026-09-08T18:00:00Z' });
  assert.equal(source.validation_status, 'validated');
  assert.equal(source.approval_status, 'pending');
  assert.equal(source.active, false);
  source = applySourceAction(source, 'approve');
  assert.equal(source.approval_status, 'approved');
  assert.equal(source.active, false);
  source = applySourceAction(source, 'activate');
  assert.equal(source.active, true);
});

test('requires connector cannot be activated', () => {
  let source = newPendingSource({
    name:'Example',
    url:'https://example.com/jobs',
    category:'ATS publice',
  }, 'src-test');
  source = applySourceAction(source, 'submit_validation');
  source = applySourceAction(source, 'mark_requires_connector', { reason:'Connector lipsa' });
  assert.equal(source.validation_status, 'requires_connector');
  assert.throws(() => applySourceAction(source, 'activate'), /Sursa trebuie validata si aprobata/);
});


test('disabled dedicated ATS route fails closed at activation', () => {
  const source = normalizeSource({
    id:'src-ntt',
    name:'NTT',
    url:'https://careers.services.global.ntt/',
    category:'Servicii IT si consultanta',
    active:true,
    validation_status:'validated',
    approval_status:'approved',
  });
  assert.equal(source.active, false);
  assert.deepEqual(dedicatedRouteActivationGate(source), {
    allowed:false,
    reason:'connector_requires_credentials',
  });
  assert.throws(
    () => applySourceAction({ ...source, active:false }, 'activate'),
    /connector_requires_credentials/
  );
});

test('live-unvalidated dedicated ATS route cannot be activated', () => {
  const source = normalizeSource({
    id:'src-clickhouse',
    name:'ClickHouse',
    url:'https://clickhouse.com/company/careers',
    category:'Servicii IT si consultanta',
    active:false,
    validation_status:'validated',
    approval_status:'approved',
  });
  assert.deepEqual(dedicatedRouteActivationGate(source), {
    allowed:false,
    reason:'live_api_route_not_validated',
  });
  assert.throws(
    () => applySourceAction(source, 'activate'),
    /live_api_route_not_validated/
  );
});

test('enabled validated ATS route may pass activation gate', () => {
  let source = normalizeSource({
    id:'src-endava',
    name:'Endava',
    url:'https://careers.endava.com/',
    category:'Servicii IT si consultanta',
    active:false,
    validation_status:'validated',
    approval_status:'approved',
  });
  assert.deepEqual(dedicatedRouteActivationGate(source), { allowed:true, reason:null });
  source = applySourceAction(source, 'activate');
  assert.equal(source.active, true);
});

test('physical source registry is canonical for all non-deferred sources', () => {
  const catalog = JSON.parse(readFileSync(resolve(process.cwd(), '../data/sources.json'), 'utf8'));
  assert.equal(catalog.schema_version, '1.0');
  assert.equal(catalog.count, catalog.sources.length);
  assert.ok(catalog.sources.length > 0);

  const required = [
    'id',
    'category',
    'name',
    'url',
    'active',
    'collection_method',
    'connector_available',
    'validation_status',
    'approval_status',
    'last_validated_at',
    'validation_reason',
    'policy_excluded',
  ];

  let deferredMonster = 0;
  for (const source of catalog.sources) {
    assert.equal('priority' in source, false, `${source.name} must not contain legacy priority`);

    if (source.name === 'Monster') {
      deferredMonster += 1;
      assert.equal(source.active, true, 'Monster physical legacy state remains deferred to #237');
      const normalized = normalizeSource(source);
      assert.equal(normalized.policy_excluded, true);
      assert.equal(normalized.active, false);
      continue;
    }

    for (const key of required) {
      assert.ok(key in source, `${source.name} is missing canonical field ${key}`);
    }
    assert.deepEqual(normalizeSource(source), source, `${source.name} must already be normalization-idempotent`);
  }

  assert.equal(deferredMonster, 1, 'Exactly one deferred Monster physical record is expected');
});

test('legacy executable source is normalized as approved/validated', () => {
  const source = normalizeSource({
    id:'src-jobicy',
    name:'Jobicy',
    url:'https://jobicy.com/',
    category:'Job boards si agregatoare',
    active:true,
  });
  assert.equal(source.validation_status, 'validated');
  assert.equal(source.approval_status, 'approved');
  assert.equal(source.active, true);
});

test('Monster stays operationally excluded even if legacy catalog says active', () => {
  const source = normalizeSource({
    id:'src-monster',
    name:'Monster',
    url:'https://www.monster.com/jobs/',
    category:'Job boards si agregatoare',
    active:true,
  });
  assert.equal(source.policy_excluded, true);
  assert.equal(source.active, false);
  assert.match(source.validation_reason, /Exclus operational/);
  assert.throws(() => applySourceAction(source, 'activate'), /exclusa operational/);
});
