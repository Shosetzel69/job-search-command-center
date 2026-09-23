import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SHA_RE } from './contract.mjs';

const SCHEMA_VERSION = '1.0';
const RECONCILIATION_SCHEMA_VERSION = '1.0';
const MANAGED_PATHS = Object.freeze(['data/sources.json','data/source-categories.json','data/nomenclatures.json']);
const RUN_ID_RE = /^\d+$/;
const DB_CHANGE_TYPES = new Set(['none', 'reversible', 'destructive']);

function requireText(value, name) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

function requireSha(value, name) {
  const normalized = requireText(value, name).toLowerCase();
  if (!SHA_RE.test(normalized)) throw new Error(`${name} must be a full immutable commit SHA`);
  return normalized;
}

function requireRunId(value, name = 'run_id') {
  const normalized = requireText(value, name);
  if (!RUN_ID_RE.test(normalized)) throw new Error(`${name} must be a numeric GitHub Actions run id`);
  return normalized;
}

function readJson(path, name) {
  try {
    return JSON.parse(readFileSync(resolve(path), 'utf8'));
  } catch (error) {
    throw new Error(`${name} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function normalizeHealth(health, environment, candidateSha) {
  if (!health || typeof health !== 'object' || Array.isArray(health)) {
    throw new Error(`${environment.toUpperCase()} health evidence is missing`);
  }
  if (health.status !== 'ok') throw new Error(`${environment.toUpperCase()} health status must be ok`);
  if (health.environment !== environment) throw new Error(`${environment.toUpperCase()} health environment mismatch`);

  const sourceSha = requireSha(health.source_sha, `${environment}.health.source_sha`);
  if (sourceSha !== candidateSha) {
    throw new Error(`${environment.toUpperCase()} health source_sha does not match CANDIDATE_SHA`);
  }

  return {
    environment,
    source_sha: sourceSha,
    runtime_repo: requireText(health.runtime_repo, `${environment}.health.runtime_repo`),
    runtime_ref: requireText(health.runtime_ref, `${environment}.health.runtime_ref`),
    runtime_data_sha: requireSha(health.runtime_data_sha, `${environment}.health.runtime_data_sha`),
    search_mode: requireText(health.search_mode, `${environment}.health.search_mode`),
  };
}

function normalizeReconciliationEvidence(evidence, environment, candidateSha, runtimeDataSha) {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    throw new Error(`${environment.toUpperCase()} reconciliation evidence is missing`);
  }
  if (evidence.schema_version !== RECONCILIATION_SCHEMA_VERSION) {
    throw new Error('Unsupported reconciliation evidence schema_version');
  }
  if (evidence.environment !== environment) throw new Error(`${environment.toUpperCase()} reconciliation environment mismatch`);
  if (requireSha(evidence.candidate_sha, `${environment}.reconciliation.candidate_sha`) !== candidateSha) {
    throw new Error(`${environment.toUpperCase()} reconciliation candidate_sha mismatch`);
  }
  if (requireSha(evidence.promotion_runtime_sha, `${environment}.reconciliation.promotion_runtime_sha`) !== runtimeDataSha) {
    throw new Error(`${environment.toUpperCase()} reconciliation runtime_data_sha mismatch`);
  }
  requireSha(evidence.control_plane_sha, `${environment}.reconciliation.control_plane_sha`);
  requireSha(evidence.runtime_head_before, `${environment}.reconciliation.runtime_head_before`);
  if (evidence.acceptance_runtime_head != null) requireSha(evidence.acceptance_runtime_head, `${environment}.reconciliation.acceptance_runtime_head`);
  if (requireText(evidence.allowlist_version, `${environment}.reconciliation.allowlist_version`) !== '1.0') {
    throw new Error('Unsupported reconciliation allowlist_version');
  }
  if (evidence.reconciliation_result !== 'PASS') throw new Error(`${environment.toUpperCase()} reconciliation must PASS`);
  if (evidence.validation_result !== 'PASS') throw new Error(`${environment.toUpperCase()} reconciliation validation must PASS`);
  if (evidence.snapshot_verification !== 'PASS') throw new Error(`${environment.toUpperCase()} runtime snapshot verification must PASS`);
  if (evidence.functional_visibility?.status !== 'PASS') {
    throw new Error(`${environment.toUpperCase()} protected functional visibility must PASS`);
  }
  if (requireText(evidence.functional_visibility.method, `${environment}.functional_visibility.method`) !== 'deployed-protected-data') {
    throw new Error(`${environment.toUpperCase()} functional visibility method is unsupported`);
  }
  if (!['ACCEPTED','NOT_REQUIRED'].includes(evidence.acceptance_result)) {
    throw new Error(`${environment.toUpperCase()} reconciliation baseline is not accepted`);
  }
  if (evidence.revert_result !== 'NOT_REQUIRED') {
    throw new Error(`${environment.toUpperCase()} reconciliation evidence contains a revert/degraded outcome`);
  }
  if (evidence.health?.source_sha !== candidateSha || evidence.health?.runtime_data_sha !== runtimeDataSha) {
    throw new Error(`${environment.toUpperCase()} reconciliation health identity mismatch`);
  }
  for (const path of MANAGED_PATHS) {
    const item = evidence.files?.[path];
    if (!item || typeof item !== 'object') throw new Error(`Missing reconciliation file evidence: ${path}`);
    for (const field of ['baseline_digest','candidate_digest','runtime_before_digest','runtime_after_digest','next_baseline_digest','functional_expected_digest']) {
      if (!/^sha256:[0-9a-f]{64}$/.test(String(item[field] || ''))) {
        throw new Error(`Invalid reconciliation digest ${path}.${field}`);
      }
    }
    if (!['noop_baseline','noop_runtime_already_candidate','apply_candidate','preserve_runtime'].includes(item.action)) {
      throw new Error(`Invalid reconciliation action for ${path}`);
    }
    const visible = evidence.functional_visibility.files?.[path];
    if (!visible || typeof visible !== 'object') throw new Error(`Missing functional visibility evidence: ${path}`);
    for (const field of ['expected_semantic_digest','visible_semantic_digest']) {
      if (!/^sha256:[0-9a-f]{64}$/.test(String(visible[field] || ''))) {
        throw new Error(`Invalid functional visibility digest ${path}.${field}`);
      }
    }
    if (visible.expected_semantic_digest !== item.functional_expected_digest
      || visible.visible_semantic_digest !== item.functional_expected_digest) {
      throw new Error(`Functional visibility digest mismatch for ${path}`);
    }
  }
  return evidence;
}

function normalizeDeploymentEvidence({ environment, candidateSha, runId, runUrl, health, reconciliation }) {
  const normalizedHealth = normalizeHealth(health, environment, candidateSha);
  const output = {
    verdict: 'PASS',
    run_id: requireRunId(runId),
    run_url: requireText(runUrl, 'run_url'),
    ...normalizedHealth,
  };
  if (environment !== 'prod' || reconciliation) {
    output.reconciliation = normalizeReconciliationEvidence(
      reconciliation,
      environment,
      candidateSha,
      normalizedHealth.runtime_data_sha,
    );
  }
  return output;
}

function assertBaseRecord(record, expectedStage, candidateSha) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new Error('Promotion evidence must be a JSON object');
  }
  if (record.schema_version !== SCHEMA_VERSION) throw new Error('Unsupported promotion evidence schema_version');
  if (record.stage !== expectedStage) throw new Error(`Promotion evidence must be ${expectedStage}`);

  const expectedSha = requireSha(candidateSha, 'CANDIDATE_SHA');
  if (requireSha(record.candidate_sha, 'record.candidate_sha') !== expectedSha) {
    throw new Error('Promotion evidence candidate does not match requested CANDIDATE_SHA');
  }
  requireText(record.issue_pr, 'record.issue_pr');
  return expectedSha;
}

function assertDeploymentEvidence(evidence, environment, candidateSha) {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    throw new Error(`${environment.toUpperCase()} deployment evidence is missing`);
  }
  if (evidence.verdict !== 'PASS') throw new Error(`${environment.toUpperCase()} deployment verdict must be PASS`);
  requireRunId(evidence.run_id, `${environment}.run_id`);
  requireText(evidence.run_url, `${environment}.run_url`);
  if (evidence.environment !== environment) throw new Error(`${environment.toUpperCase()} evidence environment mismatch`);
  if (requireSha(evidence.source_sha, `${environment}.source_sha`) !== candidateSha) {
    throw new Error(`${environment.toUpperCase()} evidence source_sha does not match CANDIDATE_SHA`);
  }
  const runtimeDataSha = requireSha(evidence.runtime_data_sha, `${environment}.runtime_data_sha`);
  if (environment !== 'prod' || evidence.reconciliation) {
    normalizeReconciliationEvidence(evidence.reconciliation, environment, candidateSha, runtimeDataSha);
  }
}

export function createDevPassRecord({ candidateSha, issuePr, runId, runUrl, health, reconciliation, createdAt = new Date().toISOString() }) {
  const sha = requireSha(candidateSha, 'CANDIDATE_SHA');
  return {
    schema_version: SCHEMA_VERSION,
    stage: 'dev_pass',
    issue_pr: requireText(issuePr, 'Issue / PR'),
    candidate_sha: sha,
    created_at: createdAt,
    dev_pass: normalizeDeploymentEvidence({ environment: 'dev', candidateSha: sha, runId, runUrl, health, reconciliation }),
  };
}

export function assertDevPassRecord(record, candidateSha) {
  const sha = assertBaseRecord(record, 'dev_pass', candidateSha);
  assertDeploymentEvidence(record.dev_pass, 'dev', sha);
  return record;
}

export function createTestDeployedRecord({ devRecord, candidateSha, runId, runUrl, health, reconciliation, createdAt = new Date().toISOString() }) {
  const sha = requireSha(candidateSha, 'CANDIDATE_SHA');
  assertDevPassRecord(devRecord, sha);
  return {
    ...devRecord,
    stage: 'test_deployed',
    created_at: createdAt,
    test_deploy: normalizeDeploymentEvidence({ environment: 'test', candidateSha: sha, runId, runUrl, health, reconciliation }),
  };
}

export function assertTestDeployedRecord(record, candidateSha) {
  const sha = assertBaseRecord(record, 'test_deployed', candidateSha);
  assertDeploymentEvidence(record.dev_pass, 'dev', sha);
  assertDeploymentEvidence(record.test_deploy, 'test', sha);
  return record;
}

export function createTestPassRecord({
  testDeployedRecord,
  candidateSha,
  qaEvidenceReference,
  runId,
  runUrl,
  createdAt = new Date().toISOString(),
}) {
  const sha = requireSha(candidateSha, 'CANDIDATE_SHA');
  assertTestDeployedRecord(testDeployedRecord, sha);
  return {
    ...testDeployedRecord,
    stage: 'test_pass',
    created_at: createdAt,
    test_pass: {
      verdict: 'PASS',
      evidence_reference: requireText(qaEvidenceReference, 'test_evidence_reference'),
      attestation_run_id: requireRunId(runId, 'attestation_run_id'),
      attestation_run_url: requireText(runUrl, 'attestation_run_url'),
      source_sha: sha,
    },
  };
}

export function assertTestPassRecord(record, candidateSha) {
  const sha = assertBaseRecord(record, 'test_pass', candidateSha);
  assertDeploymentEvidence(record.dev_pass, 'dev', sha);
  assertDeploymentEvidence(record.test_deploy, 'test', sha);
  if (!record.test_pass || typeof record.test_pass !== 'object' || Array.isArray(record.test_pass)) {
    throw new Error('TEST PASS attestation is missing');
  }
  if (record.test_pass.verdict !== 'PASS') throw new Error('TEST verdict must be PASS');
  if (requireSha(record.test_pass.source_sha, 'test_pass.source_sha') !== sha) {
    throw new Error('TEST PASS source_sha does not match CANDIDATE_SHA');
  }
  requireText(record.test_pass.evidence_reference, 'test_pass.evidence_reference');
  requireRunId(record.test_pass.attestation_run_id, 'test_pass.attestation_run_id');
  requireText(record.test_pass.attestation_run_url, 'test_pass.attestation_run_url');
  return record;
}

function normalizeDatabaseEvidence({ databaseChange = 'none', migrationVersion, backupReference, backupChecksumVerified, restoreEvidence }) {
  const type = String(databaseChange || 'none').trim().toLowerCase();
  if (!DB_CHANGE_TYPES.has(type)) throw new Error('database_change must be none, reversible or destructive');
  if (type === 'none') return null;

  const evidence = {
    change_type: type,
    migration_schema_version: requireText(migrationVersion, 'migration_version'),
  };
  if (type === 'destructive') {
    evidence.backup_reference = requireText(backupReference, 'db_backup_reference');
    if (String(backupChecksumVerified || '').trim().toUpperCase() !== 'YES') {
      throw new Error('Destructive DB change requires db_backup_checksum_verified=YES');
    }
    evidence.sha256_checksum_verified = 'YES';
    evidence.non_prod_restore_evidence = requireText(restoreEvidence, 'db_restore_evidence');
  }
  return evidence;
}

export function createProdReleaseRecord({
  testRecord,
  candidateSha,
  previousHealth,
  expectedRuntimeSha,
  expectedRuntimeHead,
  rollbackReference,
  ownerGoReference,
  runId,
  runUrl,
  prodHealth,
  reconciliation,
  action = 'deploy',
  configRollbackReference,
  databaseChange = 'none',
  migrationVersion,
  backupReference,
  backupChecksumVerified,
  restoreEvidence,
  createdAt = new Date().toISOString(),
}) {
  const sha = requireSha(candidateSha, 'CANDIDATE_SHA');
  assertTestPassRecord(testRecord, sha);

  const previousSourceSha = requireSha(previousHealth?.source_sha, 'previous PROD source_sha');
  const previousRuntimeDataSha = requireSha(previousHealth?.runtime_data_sha, 'previous PROD runtime_data_sha');
  const expectedRuntime = requireSha(expectedRuntimeSha, 'expected_runtime_sha');
  const expectedHead = requireSha(expectedRuntimeHead, 'expected_runtime_head');
  if (previousRuntimeDataSha !== expectedRuntime) {
    throw new Error('Previous PROD /health runtime_data_sha does not match prior promotion_runtime_sha');
  }

  if (!reconciliation) throw new Error('PROD reconciliation evidence is missing');
  if (requireSha(reconciliation.runtime_head_before, 'prod.reconciliation.runtime_head_before') !== expectedHead) {
    throw new Error('PROD reconciliation runtime_head_before does not match prior acceptance_runtime_head');
  }
  const prodPass = normalizeDeploymentEvidence({
    environment: 'prod',
    candidateSha: sha,
    runId,
    runUrl,
    health: prodHealth,
    reconciliation,
  });
  const record = {
    schema_version: SCHEMA_VERSION,
    stage: 'prod_pass',
    issue_pr: testRecord.issue_pr,
    candidate_sha: sha,
    created_at: createdAt,
    dev_pass_evidence: testRecord.dev_pass,
    test_deploy_evidence: testRecord.test_deploy,
    test_pass_evidence: testRecord.test_pass,
    previous_prod_source_sha: previousSourceSha,
    previous_prod_runtime_data_sha: previousRuntimeDataSha,
    previous_prod_runtime_head: expectedHead,
    previous_prod_runtime_anchor: {
      promotion_runtime_sha: previousRuntimeDataSha,
      acceptance_runtime_head: expectedHead,
    },
    prod_runtime_anchor: {
      promotion_runtime_sha: prodPass.runtime_data_sha,
      acceptance_runtime_head: prodPass.reconciliation.acceptance_runtime_head,
    },
    rollback_action_reference: requireText(rollbackReference, 'rollback_reference'),
    owner_go: requireText(ownerGoReference, 'owner_go_reference'),
    prod_deploy_evidence: prodPass,
    prod_smoke_verdict: 'PASS',
    final_state: 'ACCEPTED',
  };

  if (action === 'bootstrap-deploy') {
    record.configuration_change = {
      rollback_reference: requireText(configRollbackReference, 'config_rollback_reference'),
    };
  }

  const dbEvidence = normalizeDatabaseEvidence({
    databaseChange,
    migrationVersion,
    backupReference,
    backupChecksumVerified,
    restoreEvidence,
  });
  if (dbEvidence) record.database_change = dbEvidence;
  return record;
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      args._.push(token);
      continue;
    }
    const key = token.slice(2).replaceAll('-', '_');
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${token} requires a value`);
    args[key] = value;
    i += 1;
  }
  return args;
}

function writeRecord(path, record) {
  writeFileSync(resolve(requireText(path, 'output')), `${JSON.stringify(record, null, 2)}\n`, 'utf8');
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const command = args._[0];
  if (command === 'create-dev') {
    writeRecord(args.output, createDevPassRecord({
      candidateSha: args.candidate_sha,
      issuePr: args.issue_pr,
      runId: args.run_id,
      runUrl: args.run_url,
      health: readJson(args.health_file, 'DEV health evidence'),
      reconciliation: readJson(args.reconciliation_file, 'DEV reconciliation evidence'),
    }));
    return;
  }
  if (command === 'verify-dev') {
    assertDevPassRecord(readJson(args.file, 'DEV promotion evidence'), args.candidate_sha);
    return;
  }
  if (command === 'create-test-deployed') {
    writeRecord(args.output, createTestDeployedRecord({
      devRecord: readJson(args.dev_file, 'DEV promotion evidence'),
      candidateSha: args.candidate_sha,
      runId: args.run_id,
      runUrl: args.run_url,
      health: readJson(args.health_file, 'TEST health evidence'),
      reconciliation: readJson(args.reconciliation_file, 'TEST reconciliation evidence'),
    }));
    return;
  }
  if (command === 'verify-test-deployed') {
    assertTestDeployedRecord(readJson(args.file, 'TEST deployment evidence'), args.candidate_sha);
    return;
  }
  if (command === 'create-test-pass') {
    writeRecord(args.output, createTestPassRecord({
      testDeployedRecord: readJson(args.test_deployed_file, 'TEST deployment evidence'),
      candidateSha: args.candidate_sha,
      qaEvidenceReference: args.test_evidence_reference,
      runId: args.run_id,
      runUrl: args.run_url,
    }));
    return;
  }
  if (command === 'verify-test-pass') {
    assertTestPassRecord(readJson(args.file, 'TEST PASS evidence'), args.candidate_sha);
    return;
  }
  if (command === 'create-release') {
    writeRecord(args.output, createProdReleaseRecord({
      testRecord: readJson(args.test_file, 'TEST PASS evidence'),
      candidateSha: args.candidate_sha,
      previousHealth: readJson(args.previous_health_file, 'previous PROD health evidence'),
      expectedRuntimeSha: args.expected_runtime_sha,
      expectedRuntimeHead: args.expected_runtime_head,
      rollbackReference: args.rollback_reference,
      ownerGoReference: args.owner_go_reference,
      runId: args.run_id,
      runUrl: args.run_url,
      prodHealth: readJson(args.prod_health_file, 'PROD health evidence'),
      reconciliation: readJson(args.reconciliation_file, 'PROD reconciliation evidence'),
      action: args.action,
      configRollbackReference: args.config_rollback_reference,
      databaseChange: args.database_change,
      migrationVersion: args.migration_version,
      backupReference: args.db_backup_reference,
      backupChecksumVerified: args.db_backup_checksum_verified,
      restoreEvidence: args.db_restore_evidence,
    }));
    return;
  }
  throw new Error(`Unknown promotion command: ${command || '<missing>'}`);
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedDirectly) {
  main().catch(error => {
    console.error(`PROMOTION_EVIDENCE_FAIL: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
