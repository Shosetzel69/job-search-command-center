import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SHA_RE } from './contract.mjs';

const SCHEMA_VERSION = '1.0';
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
  if (health.environment !== environment) {
    throw new Error(`${environment.toUpperCase()} health environment mismatch`);
  }
  const sourceSha = requireSha(health.source_sha, `${environment}.health.source_sha`);
  if (sourceSha !== candidateSha) {
    throw new Error(`${environment.toUpperCase()} health source_sha does not match CANDIDATE_SHA`);
  }
  const runtimeDataSha = requireSha(health.runtime_data_sha, `${environment}.health.runtime_data_sha`);
  return {
    environment,
    source_sha: sourceSha,
    runtime_repo: requireText(health.runtime_repo, `${environment}.health.runtime_repo`),
    runtime_ref: requireText(health.runtime_ref, `${environment}.health.runtime_ref`),
    runtime_data_sha: runtimeDataSha,
    search_mode: requireText(health.search_mode, `${environment}.health.search_mode`),
  };
}

function normalizeRunEvidence({ environment, candidateSha, runId, runUrl, health }) {
  return {
    verdict: 'PASS',
    run_id: requireRunId(runId),
    run_url: requireText(runUrl, 'run_url'),
    ...normalizeHealth(health, environment, candidateSha),
  };
}

function assertBaseRecord(record, expectedStage, candidateSha) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new Error('Promotion evidence must be a JSON object');
  }
  if (record.schema_version !== SCHEMA_VERSION) throw new Error('Unsupported promotion evidence schema_version');
  if (record.stage !== expectedStage) throw new Error(`Promotion evidence must be ${expectedStage}`);
  const expectedSha = requireSha(candidateSha, 'CANDIDATE_SHA');
  const recordSha = requireSha(record.candidate_sha, 'record.candidate_sha');
  if (recordSha !== expectedSha) throw new Error('Promotion evidence candidate does not match requested CANDIDATE_SHA');
  requireText(record.issue_pr, 'record.issue_pr');
  return expectedSha;
}

function assertPassEvidence(evidence, environment, candidateSha) {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    throw new Error(`${environment.toUpperCase()} PASS evidence is missing`);
  }
  if (evidence.verdict !== 'PASS') throw new Error(`${environment.toUpperCase()} verdict must be PASS`);
  requireRunId(evidence.run_id, `${environment}.run_id`);
  requireText(evidence.run_url, `${environment}.run_url`);
  if (evidence.environment !== environment) throw new Error(`${environment.toUpperCase()} evidence environment mismatch`);
  if (requireSha(evidence.source_sha, `${environment}.source_sha`) !== candidateSha) {
    throw new Error(`${environment.toUpperCase()} evidence source_sha does not match CANDIDATE_SHA`);
  }
  requireSha(evidence.runtime_data_sha, `${environment}.runtime_data_sha`);
}

export function createDevPassRecord({ candidateSha, issuePr, runId, runUrl, health, createdAt = new Date().toISOString() }) {
  const sha = requireSha(candidateSha, 'CANDIDATE_SHA');
  return {
    schema_version: SCHEMA_VERSION,
    stage: 'dev_pass',
    issue_pr: requireText(issuePr, 'Issue / PR'),
    candidate_sha: sha,
    created_at: createdAt,
    dev_pass: normalizeRunEvidence({ environment: 'dev', candidateSha: sha, runId, runUrl, health }),
  };
}

export function assertDevPassRecord(record, candidateSha) {
  const sha = assertBaseRecord(record, 'dev_pass', candidateSha);
  assertPassEvidence(record.dev_pass, 'dev', sha);
  return record;
}

export function createTestPassRecord({ devRecord, candidateSha, runId, runUrl, health, createdAt = new Date().toISOString() }) {
  const sha = requireSha(candidateSha, 'CANDIDATE_SHA');
  assertDevPassRecord(devRecord, sha);
  return {
    ...devRecord,
    stage: 'test_pass',
    created_at: createdAt,
    test_pass: normalizeRunEvidence({ environment: 'test', candidateSha: sha, runId, runUrl, health }),
  };
}

export function assertTestPassRecord(record, candidateSha) {
  const sha = assertBaseRecord(record, 'test_pass', candidateSha);
  assertPassEvidence(record.dev_pass, 'dev', sha);
  assertPassEvidence(record.test_pass, 'test', sha);
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
  rollbackReference,
  ownerGoReference,
  runId,
  runUrl,
  prodHealth,
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
  if (previousRuntimeDataSha !== expectedRuntime) {
    throw new Error('Previous PROD /health runtime_data_sha does not match expected_runtime_sha');
  }

  const prodPass = normalizeRunEvidence({ environment: 'prod', candidateSha: sha, runId, runUrl, health: prodHealth });
  const record = {
    schema_version: SCHEMA_VERSION,
    stage: 'prod_pass',
    issue_pr: testRecord.issue_pr,
    candidate_sha: sha,
    created_at: createdAt,
    dev_pass: testRecord.dev_pass,
    test_pass: testRecord.test_pass,
    previous_prod_source_sha: previousSourceSha,
    previous_prod_runtime_data_sha: previousRuntimeDataSha,
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
    }));
    return;
  }
  if (command === 'verify-dev') {
    assertDevPassRecord(readJson(args.file, 'DEV promotion evidence'), args.candidate_sha);
    return;
  }
  if (command === 'create-test') {
    writeRecord(args.output, createTestPassRecord({
      devRecord: readJson(args.dev_file, 'DEV promotion evidence'),
      candidateSha: args.candidate_sha,
      runId: args.run_id,
      runUrl: args.run_url,
      health: readJson(args.health_file, 'TEST health evidence'),
    }));
    return;
  }
  if (command === 'verify-test') {
    assertTestPassRecord(readJson(args.file, 'TEST promotion evidence'), args.candidate_sha);
    return;
  }
  if (command === 'create-release') {
    writeRecord(args.output, createProdReleaseRecord({
      testRecord: readJson(args.test_file, 'TEST promotion evidence'),
      candidateSha: args.candidate_sha,
      previousHealth: readJson(args.previous_health_file, 'previous PROD health evidence'),
      expectedRuntimeSha: args.expected_runtime_sha,
      rollbackReference: args.rollback_reference,
      ownerGoReference: args.owner_go_reference,
      runId: args.run_id,
      runUrl: args.run_url,
      prodHealth: readJson(args.prod_health_file, 'PROD health evidence'),
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
