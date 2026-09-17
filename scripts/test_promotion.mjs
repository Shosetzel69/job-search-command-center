import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertDevPassRecord,
  assertTestPassRecord,
  createDevPassRecord,
  createProdReleaseRecord,
  createTestDeployedRecord,
  createTestPassRecord,
} from './environment/promotion.mjs';

const SHA = 'a'.repeat(40);
const OTHER_SHA = 'b'.repeat(40);
const DEV_RUNTIME_SHA = 'c'.repeat(40);
const TEST_RUNTIME_SHA = 'd'.repeat(40);
const PROD_RUNTIME_SHA = 'e'.repeat(40);
const PREVIOUS_PROD_SOURCE_SHA = 'f'.repeat(40);

function health(environment, sourceSha, runtimeSha) {
  const runtimeRepo = environment === 'dev'
    ? 'Shosetzel69/job-search-runtime-dev'
    : environment === 'test'
      ? 'Shosetzel69/job-search-runtime-test'
      : 'Shosetzel69/job-search-prod';
  const searchMode = environment === 'dev' ? 'disabled' : environment === 'test' ? 'smoke' : 'live';
  return {
    status: 'ok',
    environment,
    source_sha: sourceSha,
    runtime_repo: runtimeRepo,
    runtime_ref: 'main',
    runtime_data_sha: runtimeSha,
    search_mode: searchMode,
  };
}

function devRecord() {
  return createDevPassRecord({
    candidateSha: SHA,
    issuePr: '#198 / PR candidate',
    runId: '1001',
    runUrl: 'https://github.com/example/repo/actions/runs/1001',
    health: health('dev', SHA, DEV_RUNTIME_SHA),
    createdAt: '2026-09-18T00:00:00.000Z',
  });
}

function testDeployedRecord() {
  return createTestDeployedRecord({
    devRecord: devRecord(),
    candidateSha: SHA,
    runId: '1002',
    runUrl: 'https://github.com/example/repo/actions/runs/1002',
    health: health('test', SHA, TEST_RUNTIME_SHA),
    createdAt: '2026-09-18T00:01:00.000Z',
  });
}

function testPassRecord() {
  return createTestPassRecord({
    testDeployedRecord: testDeployedRecord(),
    candidateSha: SHA,
    qaEvidenceReference: 'QA issue #200 comment 123',
    runId: '1003',
    runUrl: 'https://github.com/example/repo/actions/runs/1003',
    createdAt: '2026-09-18T00:02:00.000Z',
  });
}

function prodArgs(overrides = {}) {
  return {
    testRecord: testPassRecord(),
    candidateSha: SHA,
    previousHealth: {
      source_sha: PREVIOUS_PROD_SOURCE_SHA,
      runtime_data_sha: PROD_RUNTIME_SHA,
    },
    expectedRuntimeSha: PROD_RUNTIME_SHA,
    rollbackReference: 'redeploy previous known-good PROD source/runtime pair',
    ownerGoReference: 'PROD_GO by owner',
    runId: '1004',
    runUrl: 'https://github.com/example/repo/actions/runs/1004',
    prodHealth: health('prod', SHA, PROD_RUNTIME_SHA),
    createdAt: '2026-09-18T00:03:00.000Z',
    ...overrides,
  };
}

test('DEV PASS freezes exact immutable candidate and Issue/PR evidence', () => {
  const record = devRecord();
  assert.equal(record.stage, 'dev_pass');
  assert.equal(record.candidate_sha, SHA);
  assert.equal(record.issue_pr, '#198 / PR candidate');
  assert.equal(record.dev_pass.source_sha, SHA);
  assert.equal(record.dev_pass.environment, 'dev');
  assert.doesNotThrow(() => assertDevPassRecord(record, SHA));
});

test('TEST deployment rejects any candidate different from DEV PASS', () => {
  assert.throws(() => createTestDeployedRecord({
    devRecord: devRecord(),
    candidateSha: OTHER_SHA,
    runId: '1002',
    runUrl: 'https://github.com/example/repo/actions/runs/1002',
    health: health('test', OTHER_SHA, TEST_RUNTIME_SHA),
  }), /candidate does not match requested CANDIDATE_SHA/);
});

test('TEST PASS is separate from deployment and requires independent QA evidence', () => {
  assert.throws(() => createTestPassRecord({
    testDeployedRecord: testDeployedRecord(),
    candidateSha: SHA,
    qaEvidenceReference: '',
    runId: '1003',
    runUrl: 'https://github.com/example/repo/actions/runs/1003',
  }), /test_evidence_reference is required/);

  const record = testPassRecord();
  assert.equal(record.stage, 'test_pass');
  assert.equal(record.test_pass.verdict, 'PASS');
  assert.equal(record.test_pass.source_sha, SHA);
  assert.doesNotThrow(() => assertTestPassRecord(record, SHA));
});

test('mutating candidate identity after TEST PASS invalidates promotion evidence', () => {
  assert.throws(() => assertTestPassRecord(testPassRecord(), OTHER_SHA), /candidate does not match requested CANDIDATE_SHA/);
});

test('PROD release rejects previous runtime anchor mismatch before acceptance', () => {
  assert.throws(() => createProdReleaseRecord(prodArgs({ expectedRuntimeSha: OTHER_SHA })), /does not match expected_runtime_sha/);
});

test('reversible DB change records migration version without destructive backup fields', () => {
  const record = createProdReleaseRecord(prodArgs({
    databaseChange: 'reversible',
    migrationVersion: '20260918_001',
  }));
  assert.equal(record.database_change.change_type, 'reversible');
  assert.equal(record.database_change.migration_schema_version, '20260918_001');
  assert.equal(record.database_change.backup_reference, undefined);
});

test('destructive DB change fails closed without verified backup and restore evidence', () => {
  assert.throws(() => createProdReleaseRecord(prodArgs({
    databaseChange: 'destructive',
    migrationVersion: '20260918_002',
  })), /db_backup_reference is required/);

  assert.throws(() => createProdReleaseRecord(prodArgs({
    databaseChange: 'destructive',
    migrationVersion: '20260918_002',
    backupReference: 'backup://prod/20260918',
    backupChecksumVerified: 'NO',
    restoreEvidence: 'TEST restore run 55',
  })), /db_backup_checksum_verified=YES/);

  const record = createProdReleaseRecord(prodArgs({
    databaseChange: 'destructive',
    migrationVersion: '20260918_002',
    backupReference: 'backup://prod/20260918',
    backupChecksumVerified: 'YES',
    restoreEvidence: 'TEST restore run 55',
  }));
  assert.equal(record.database_change.sha256_checksum_verified, 'YES');
  assert.equal(record.database_change.non_prod_restore_evidence, 'TEST restore run 55');
});

test('minimal PROD release record preserves candidate, TEST evidence, rollback and smoke verdict', () => {
  const record = createProdReleaseRecord(prodArgs());
  assert.equal(record.stage, 'prod_pass');
  assert.equal(record.candidate_sha, SHA);
  assert.equal(record.test_pass_evidence.verdict, 'PASS');
  assert.equal(record.previous_prod_source_sha, PREVIOUS_PROD_SOURCE_SHA);
  assert.equal(record.previous_prod_runtime_data_sha, PROD_RUNTIME_SHA);
  assert.equal(record.prod_deploy_evidence.source_sha, SHA);
  assert.equal(record.prod_smoke_verdict, 'PASS');
  assert.equal(record.final_state, 'ACCEPTED');
  assert.equal(record.database_change, undefined);
}
);
