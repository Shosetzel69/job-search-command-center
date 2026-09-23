import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CANDIDATE_MANAGED_PATHS,
  planCandidateManagedReconciliation,
  prepareAcceptanceState,
  sha256Text,
} from './environment/reconciliation.mjs';
import {
  createProdMigrationAwarePlanner,
  planProdBaselineMigration,
  validateProdBaselineMigrationManifest,
} from './environment/prod-baseline-migration.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const HIST = 'a'.repeat(40);
const TARGET = 'b'.repeat(40);
const CONTROL = 'c'.repeat(40);
const HEAD = 'd'.repeat(40);
const PROMOTION = 'e'.repeat(40);

function baseCatalogs() {
  return {
    categories: readFileSync(resolve(ROOT, 'data/source-categories.json'), 'utf8'),
    nomenclatures: readFileSync(resolve(ROOT, 'data/nomenclatures.json'), 'utf8'),
  };
}

function monsterLegacy() {
  return {
    id:'src-362eebc4',
    category:'Job boards si agregatoare',
    name:'Monster',
    url:'https://www.monster.com/jobs/',
    active:true,
    connector_available:true,
  };
}

function monsterOverlay() {
  return {
    id:'src-362eebc4',
    category:'Job boards si agregatoare',
    name:'Monster',
    url:'https://www.monster.com/jobs/',
    active:false,
    collection_method:'web',
    connector_available:true,
    validation_status:'validated',
    approval_status:'approved',
    last_validated_at:null,
    validation_reason:'Exclus operational conform politicii curente.',
    policy_excluded:true,
  };
}

function linkedin() {
  return {
    id:'src-db8da20e',
    category:'Job boards si agregatoare',
    name:'LinkedIn Jobs',
    url:'https://www.linkedin.com/jobs/',
    active:true,
    collection_method:'web',
    connector_available:true,
    validation_status:'validated',
    approval_status:'approved',
    last_validated_at:null,
    validation_reason:null,
    policy_excluded:false,
  };
}

function text(payload) { return `${JSON.stringify(payload, null, 2)}\n`; }

function managed(sources) {
  const { categories, nomenclatures } = baseCatalogs();
  return {
    'data/sources.json': text({ schema_version:'1.0', count:sources.length, sources }),
    'data/source-categories.json': categories,
    'data/nomenclatures.json': nomenclatures,
  };
}

function digests(contents) {
  return Object.fromEntries(CANDIDATE_MANAGED_PATHS.map(path => [path, sha256Text(contents[path])]));
}

function fixture() {
  const historical = managed([monsterLegacy()]);
  const runtime = managed([monsterOverlay()]);
  const candidate = managed([monsterLegacy(), linkedin()]);
  const resolved = managed([monsterOverlay(), linkedin()]);
  const h=digests(historical), r=digests(runtime), c=digests(candidate), t=digests(resolved);
  const manifest={
    schema_version:'1.0',
    migration_id:'prod-baseline-332-v1',
    migration_version:'1.0',
    environment:'prod',
    single_use:true,
    historical_candidate_sha:HIST,
    target_candidate_sha:TARGET,
    expected_pre_migration_runtime_head:HEAD,
    files:Object.fromEntries(CANDIDATE_MANAGED_PATHS.map(path=>[path,{
      historical_digest:h[path],
      target_candidate_digest:c[path],
      expected_pre_migration_digest:r[path],
      resolved_target_digest:t[path],
    }])),
    approved_overlay:{
      path:'data/sources.json',
      source_id:'src-362eebc4',
      source_name:'Monster',
      historical_record:monsterLegacy(),
      runtime_record:monsterOverlay(),
    },
    provenance:{architecture_issue:332},
  };
  return {historical,runtime,candidate,resolved,manifest,h,r,c,t};
}

function planFixture(overrides={}) {
  const f=fixture();
  return planProdBaselineMigration({
    environment:'prod',
    candidateSha:TARGET,
    controlPlaneSha:CONTROL,
    runtimeHead:HEAD,
    candidateContents:f.candidate,
    runtimeContents:f.runtime,
    metadata:null,
    historicalContents:f.historical,
    manifest:f.manifest,
    now:'2026-09-23T17:00:00.000Z',
    ...overrides,
  });
}

test('approved one-time migration plans resolved target and target candidate baseline',()=>{
  const f=fixture();
  const p=planFixture();
  assert.equal(p.migration.migration_id,'prod-baseline-332-v1');
  assert.equal(p.files['data/sources.json'].action,'migration_apply_resolved');
  assert.equal(p.files['data/sources.json'].runtime_after_digest,f.t['data/sources.json']);
  assert.equal(p.files['data/sources.json'].next_baseline_digest,f.c['data/sources.json']);
  assert.equal(JSON.parse(p.target_contents['data/sources.json']).count,2);
  assert.equal(JSON.parse(p.target_contents['data/sources.json']).sources.some(x=>x.name==='NTT RO'),false);
  assert.equal(JSON.parse(p.target_contents['data/sources.json']).sources.find(x=>x.name==='Monster').active,false);
});

test('migration is PROD-only and requires absent metadata',()=>{
  assert.throws(()=>planFixture({environment:'test'}),/PROD-only/);
  assert.throws(()=>planFixture({metadata:{schema_version:'1.0'}}),/requires release-control metadata to be absent/);
});

test('wrong target candidate fails closed',()=>{
  assert.throws(()=>planFixture({candidateSha:'f'.repeat(40)}),/does not match approved/);
});

test('historical digest mismatch fails closed',()=>{
  const f=fixture();
  const bad=structuredClone(f.manifest);
  bad.files['data/sources.json'].historical_digest='sha256:'+'0'.repeat(64);
  assert.throws(()=>planFixture({manifest:bad}),/Historical candidate digest mismatch/);
});

test('changed pre-state and extra runtime delta fail closed',()=>{
  const f=fixture();
  const changed=managed([monsterOverlay(), linkedin()]);
  assert.throws(()=>planFixture({runtimeContents:changed}),/PROD pre-migration digest mismatch/);

  const manifest=structuredClone(f.manifest);
  manifest.files['data/sources.json'].expected_pre_migration_digest=sha256Text(changed['data/sources.json']);
  assert.throws(()=>planFixture({runtimeContents:changed,manifest}),/sources add\/remove/);
});

test('wrong Monster overlay fails closed',()=>{
  const f=fixture();
  const wrong=managed([{...monsterOverlay(),url:'https://www.monster.com/jobs/changed'}]);
  const manifest=structuredClone(f.manifest);
  manifest.files['data/sources.json'].expected_pre_migration_digest=sha256Text(wrong['data/sources.json']);
  assert.throws(()=>planFixture({runtimeContents:wrong,manifest}),/Monster overlay/);
});

test('resolved target digest mismatch fails closed',()=>{
  const f=fixture();
  const bad=structuredClone(f.manifest);
  bad.files['data/sources.json'].resolved_target_digest='sha256:'+'1'.repeat(64);
  assert.throws(()=>planFixture({manifest:bad}),/Resolved PROD target digest mismatch/);
});

test('accepted migration advances baseline to exact candidate digests and later uses normal reconciliation',()=>{
  const f=fixture();
  const p=planFixture();
  p.promotion_runtime_sha=PROMOTION;
  const prepared=prepareAcceptanceState({
    environment:'prod',
    currentHead:PROMOTION,
    reconciliation:p,
    metadata:p.pending_metadata,
    snapshotVerification:'PASS',
    functionalVisibility:{status:'PASS'},
    now:'2026-09-23T17:01:00.000Z',
  });
  assert.equal(prepared.status,'READY');
  assert.deepEqual(prepared.accepted_metadata.accepted_baselines,f.c);

  const planner=createProdMigrationAwarePlanner({manifest:f.manifest,historicalContents:f.historical});
  const next=planner({
    environment:'prod',
    candidateSha:TARGET,
    controlPlaneSha:CONTROL,
    runtimeHead:PROMOTION,
    candidateContents:f.candidate,
    runtimeContents:f.resolved,
    metadata:prepared.accepted_metadata,
    now:'2026-09-23T17:02:00.000Z',
  });
  assert.equal(next.migration,undefined);
  assert.equal(next.files['data/sources.json'].action,'preserve_runtime');
});

test('failed verification cannot prepare accepted baseline',()=>{
  const p=planFixture();
  p.promotion_runtime_sha=PROMOTION;
  assert.throws(()=>prepareAcceptanceState({
    environment:'prod',
    currentHead:PROMOTION,
    reconciliation:p,
    metadata:p.pending_metadata,
    snapshotVerification:'PASS',
    functionalVisibility:{status:'FAIL'},
  }),/Protected functional visibility must PASS/);
});

test('checked-in #332 manifest has frozen approved identities and digests',()=>{
  const manifest=JSON.parse(readFileSync(resolve(ROOT,'config/prod-baseline-migration-332.json'),'utf8'));
  validateProdBaselineMigrationManifest(manifest);
  assert.equal(manifest.historical_candidate_sha,'aed15600a96b7da365e060212612dea0115f0d00');
  assert.equal(manifest.target_candidate_sha,'09a522d5a2217dd6039fe08430fe7c4137c2a9e3');
  assert.equal(manifest.files['data/sources.json'].historical_digest,'sha256:4cfb3cbf471a81b3eb7f1f6fa01a973c6a1019fef6161bf7f34c96f3504a40a0');
  assert.equal(manifest.files['data/sources.json'].expected_pre_migration_digest,'sha256:e646b3baf6a181e5c3e9692f1a7e33518fdc8c9ff7082a2c52559b62ef3a8ec3');
  assert.equal(manifest.files['data/sources.json'].resolved_target_digest,'sha256:f8fe93bebd1460d632ff6959f786e379948a1d99b5f3b387ef957367a5001482');
});
