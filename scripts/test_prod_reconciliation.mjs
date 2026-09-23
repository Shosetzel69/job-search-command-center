import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CANDIDATE_MANAGED_PATHS,
  planCandidateManagedReconciliation,
  prepareAcceptanceState,
  ReconciliationBlockedError,
  sha256Text,
} from './environment/reconciliation.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const CANDIDATE_1 = '1'.repeat(40);
const CANDIDATE_2 = '2'.repeat(40);
const CONTROL = '3'.repeat(40);
const HEAD_0 = '4'.repeat(40);
const PROMOTION_1 = '5'.repeat(40);
const ACCEPTANCE_1 = '6'.repeat(40);
const HEAD_2 = ACCEPTANCE_1;

function canonicalSet() {
  return Object.fromEntries(CANDIDATE_MANAGED_PATHS.map(path => [
    path,
    readFileSync(resolve(ROOT, path), 'utf8'),
  ]));
}

function withSourceWhitespace(contents, suffix) {
  return {
    ...contents,
    'data/sources.json': `${contents['data/sources.json']}${suffix}`,
  };
}

function metadata(contents, overrides = {}) {
  return {
    schema_version: '1.0',
    allowlist_version: '1.0',
    environment: 'prod',
    accepted_baselines: Object.fromEntries(
      CANDIDATE_MANAGED_PATHS.map(path => [path, sha256Text(contents[path])]),
    ),
    accepted_promotion: null,
    previous_accepted_promotion: null,
    pending_promotion: null,
    ...overrides,
  };
}

function plan({
  candidateSha = CANDIDATE_1,
  runtimeHead = HEAD_0,
  candidateContents,
  runtimeContents,
  releaseMetadata,
}) {
  return planCandidateManagedReconciliation({
    environment: 'prod',
    candidateSha,
    controlPlaneSha: CONTROL,
    runtimeHead,
    candidateContents,
    runtimeContents,
    metadata: releaseMetadata,
    now: '2026-09-23T12:00:00.000Z',
  });
}

test('PROD behavior: candidate-only change applies candidate and requires acceptance', () => {
  const baseline = canonicalSet();
  const candidate = withSourceWhitespace(baseline, ' ');
  const result = plan({
    candidateContents: candidate,
    runtimeContents: baseline,
    releaseMetadata: metadata(baseline),
  });
  assert.equal(result.files['data/sources.json'].action, 'apply_candidate');
  assert.equal(result.requires_mutation, true);
  assert.equal(result.requires_acceptance, true);
  assert.equal(result.reconciliation_result, 'PASS');
  assert.equal(result.validation_result, 'PASS');
});

test('PROD behavior: unchanged candidate/runtime is a true no-op', () => {
  const baseline = canonicalSet();
  const result = plan({
    candidateContents: baseline,
    runtimeContents: baseline,
    releaseMetadata: metadata(baseline),
  });
  for (const path of CANDIDATE_MANAGED_PATHS) {
    assert.equal(result.files[path].action, 'noop_baseline');
  }
  assert.equal(result.requires_mutation, false);
  assert.equal(result.requires_acceptance, false);
});

test('PROD behavior: runtime-only change is preserved', () => {
  const baseline = canonicalSet();
  const runtime = withSourceWhitespace(baseline, ' ');
  const result = plan({
    candidateContents: baseline,
    runtimeContents: runtime,
    releaseMetadata: metadata(baseline),
  });
  assert.equal(result.files['data/sources.json'].action, 'preserve_runtime');
  assert.equal(
    result.files['data/sources.json'].runtime_after_digest,
    result.files['data/sources.json'].runtime_before_digest,
  );
  assert.equal(result.requires_acceptance, false);
});

test('PROD behavior: candidate/runtime divergence conflicts fail closed', () => {
  const baseline = canonicalSet();
  const candidate = withSourceWhitespace(baseline, ' ');
  const runtime = withSourceWhitespace(baseline, '\t');
  assert.throws(
    () => plan({
      candidateContents: candidate,
      runtimeContents: runtime,
      releaseMetadata: metadata(baseline),
    }),
    error => error instanceof ReconciliationBlockedError
      && error.evidence?.failure_stage === 'decision_table'
      && /conflict/.test(error.evidence?.reason || ''),
  );
});

test('PROD failure ordering: invalid candidate fails before runtime decision/conflict evaluation', () => {
  const baseline = canonicalSet();
  const invalidCandidate = {
    ...baseline,
    'data/sources.json': '{not-json',
  };
  const runtime = withSourceWhitespace(baseline, '\t');
  assert.throws(
    () => plan({
      candidateContents: invalidCandidate,
      runtimeContents: runtime,
      releaseMetadata: metadata(baseline),
    }),
    error => error instanceof ReconciliationBlockedError
      && error.evidence?.failure_stage === 'candidate_validation'
      && error.evidence?.validation_result === 'FAIL',
  );
});

test('PROD regression: next promotion starts from prior acceptance_runtime_head, not prior promotion_runtime_sha', () => {
  const baseline = canonicalSet();
  const candidate1 = withSourceWhitespace(baseline, ' ');
  const first = plan({
    candidateSha: CANDIDATE_1,
    runtimeHead: HEAD_0,
    candidateContents: candidate1,
    runtimeContents: baseline,
    releaseMetadata: metadata(baseline),
  });
  first.promotion_runtime_sha = PROMOTION_1;

  const prepared = prepareAcceptanceState({
    environment: 'prod',
    currentHead: PROMOTION_1,
    reconciliation: first,
    metadata: first.pending_metadata,
    snapshotVerification: 'PASS',
    functionalVisibility: { status: 'PASS' },
    now: '2026-09-23T12:01:00.000Z',
  });
  assert.equal(prepared.status, 'READY');
  assert.equal(prepared.accepted_metadata.accepted_promotion.runtime_data_sha, PROMOTION_1);

  const candidate2 = withSourceWhitespace(baseline, '  ');
  const second = plan({
    candidateSha: CANDIDATE_2,
    runtimeHead: HEAD_2,
    candidateContents: candidate2,
    runtimeContents: candidate1,
    releaseMetadata: prepared.accepted_metadata,
  });

  assert.notEqual(PROMOTION_1, ACCEPTANCE_1);
  assert.equal(second.runtime_head_before, ACCEPTANCE_1);
  assert.equal(second.files['data/sources.json'].action, 'apply_candidate');
  assert.equal(
    second.files['data/sources.json'].baseline_digest,
    sha256Text(candidate1['data/sources.json']),
  );
  assert.equal(second.requires_acceptance, true);
});
