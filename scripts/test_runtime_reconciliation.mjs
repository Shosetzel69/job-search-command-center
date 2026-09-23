import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ALLOWLIST_VERSION,
  CANDIDATE_MANAGED_PATHS,
  FunctionalVisibilityError,
  KNOWN_SEED_DIGESTS,
  RECONCILIATION_SCHEMA_VERSION,
  ReconciliationBlockedError,
  compensatingRevertDecision,
  planCandidateManagedReconciliation,
  prepareAcceptanceState,
  reconcileFileDecision,
  sha256Text,
  validateCandidateManagedSet,
  verifyProtectedFunctionalVisibility,
} from './environment/reconciliation.mjs';
import { serializeSeed } from './environment/seed.mjs';

const SHA = 'a'.repeat(40);
const CONTROL = 'b'.repeat(40);
const RUNTIME = 'c'.repeat(40);
const PROMOTION = 'd'.repeat(40);
const CONCURRENT = 'e'.repeat(40);

function category(id = 'general', label = 'General', extra = {}) {
  return { id, label, active:true, order:10, ...extra };
}

function source(id = 'src-one', name = 'One', url = 'https://example.com/jobs', categoryLabel = 'General', extra = {}) {
  return {
    id,
    category: categoryLabel,
    name,
    url,
    active: false,
    collection_method: 'web',
    connector_available: true,
    validation_status: 'validated',
    approval_status: 'pending',
    last_validated_at: null,
    validation_reason: null,
    policy_excluded: false,
    ...extra,
  };
}

function monster(categoryLabel = 'General') {
  return {
    id: 'src-monster',
    category: categoryLabel,
    name: 'Monster',
    url: 'https://www.monster.com/jobs/',
    active: true,
    connector_available: true,
  };
}

function managedSet({ sources = [source()], categories = [category()], includeMonster = true } = {}) {
  const finalSources = includeMonster && !sources.some(item => item.name === 'Monster')
    ? [...sources, monster(categories[0]?.label || 'General')]
    : [...sources];
  return {
    'data/sources.json': `${JSON.stringify({ schema_version:'1.0', count:finalSources.length, sources:finalSources }, null, 2)}\n`,
    'data/source-categories.json': `${JSON.stringify({ schema_version:'1.0', count:categories.length, categories }, null, 2)}\n`,
    'data/nomenclatures.json': serializeSeed('nomenclatures.json', {
      sourceSha: null,
      generatedAt: '1970-01-01T00:00:00.000Z',
      environment: 'dev',
      searchMode: 'disabled',
    }),
  };
}

function seedSet() {
  return Object.fromEntries(CANDIDATE_MANAGED_PATHS.map(path => [
    path,
    serializeSeed(path.replace('data/', ''), {
      sourceSha: null,
      generatedAt: '1970-01-01T00:00:00.000Z',
      environment: 'dev',
      searchMode: 'disabled',
    }),
  ]));
}

function metadataFrom(contents, overrides = {}) {
  const accepted = Object.fromEntries(CANDIDATE_MANAGED_PATHS.map(path => [path, sha256Text(contents[path])]));
  return {
    schema_version: RECONCILIATION_SCHEMA_VERSION,
    allowlist_version: ALLOWLIST_VERSION,
    environment: 'dev',
    accepted_baselines: accepted,
    accepted_promotion: null,
    previous_accepted_promotion: null,
    pending_promotion: null,
    ...overrides,
  };
}

function plan({ candidateContents, runtimeContents, metadata }) {
  return planCandidateManagedReconciliation({
    environment: 'dev',
    candidateSha: SHA,
    controlPlaneSha: CONTROL,
    runtimeHead: RUNTIME,
    candidateContents,
    runtimeContents,
    metadata,
    now: '2026-09-23T00:00:00.000Z',
  });
}

function runtime() {
  return {
    environment:'dev',
    sourceSha:SHA,
    runtimeRepository:'Shosetzel69/job-search-runtime-dev',
    runtimeRef:'main',
    githubRuntimeToken:'test-runtime-token',
    frontendOrigin:'https://dev.example.test',
  };
}

function parsedPayloads(contents) {
  return Object.fromEntries(Object.entries(contents).map(([path,text]) => [path, JSON.parse(text)]));
}

test('candidate-managed allowlist is explicit and exact', () => {
  assert.deepEqual(CANDIDATE_MANAGED_PATHS, [
    'data/sources.json',
    'data/source-categories.json',
    'data/nomenclatures.json',
  ]);
  assert.equal(Object.keys(KNOWN_SEED_DIGESTS).length, 3);
});

test('full canonical source/category contracts accept normalized catalog plus explicit Monster legacy exception', () => {
  assert.doesNotThrow(() => validateCandidateManagedSet(managedSet()));
});

test('trusted validator accepts the repository canonical managed catalogs', () => {
  const root = resolve(import.meta.dirname, '..');
  const contents = Object.fromEntries(CANDIDATE_MANAGED_PATHS.map(path => [
    path,
    readFileSync(resolve(root, path), 'utf8'),
  ]));
  assert.doesNotThrow(() => validateCandidateManagedSet(contents));
});

test('source governance rejects invalid lifecycle state and missing canonical metadata', () => {
  const invalidState = managedSet();
  const statePayload = JSON.parse(invalidState['data/sources.json']);
  statePayload.sources[0].active = true;
  invalidState['data/sources.json'] = `${JSON.stringify(statePayload, null, 2)}\n`;
  assert.throws(() => validateCandidateManagedSet(invalidState), /canonical governance form/);

  const missingField = managedSet();
  const missingPayload = JSON.parse(missingField['data/sources.json']);
  delete missingPayload.sources[0].policy_excluded;
  missingField['data/sources.json'] = `${JSON.stringify(missingPayload, null, 2)}\n`;
  assert.throws(() => validateCandidateManagedSet(missingField), /canonical governance form/);
});

test('exact known seed bootstrap is recognized before strict operational runtime validation', () => {
  const runtimeContents = seedSet();
  const candidateContents = managedSet();
  const result = plan({ candidateContents, runtimeContents, metadata:null });
  assert.equal(result.bootstrap, true);
  assert.equal(result.reconciliation_result, 'PASS');
  assert.equal(result.validation_result, 'PASS');
  assert.equal(result.files['data/sources.json'].action, 'apply_candidate');
  assert.equal(result.files['data/source-categories.json'].action, 'apply_candidate');
  assert.equal(result.files['data/nomenclatures.json'].action, 'noop_baseline');
  assert.equal(result.requires_mutation, true);
  assert.equal(result.requires_acceptance, true);
  assert.ok(result.pending_metadata);
});

test('bootstrap failure is structured and identifies bootstrap_validation', () => {
  const runtimeContents = managedSet();
  const candidateContents = managedSet();
  assert.throws(
    () => plan({ candidateContents, runtimeContents, metadata:null }),
    error => {
      assert.ok(error instanceof ReconciliationBlockedError);
      assert.equal(error.evidence.reconciliation_result, 'BLOCKED');
      assert.equal(error.evidence.failure_stage, 'bootstrap_validation');
      assert.match(error.evidence.reason, /not an exact trusted seed/);
      return true;
    },
  );
});

test('unsupported metadata schema fails closed with structured evidence', () => {
  const contents = managedSet();
  assert.throws(
    () => plan({
      candidateContents:contents,
      runtimeContents:contents,
      metadata:metadataFrom(contents, { schema_version:'9.9' }),
    }),
    error => {
      assert.ok(error instanceof ReconciliationBlockedError);
      assert.equal(error.evidence.failure_stage, 'metadata_validation');
      assert.equal(error.evidence.validation_result, 'FAIL');
      assert.match(error.evidence.reason, /Unsupported release-control metadata schema_version/);
      return true;
    },
  );
});

test('candidate schema/governance failure is structured before mutation', () => {
  const invalid = managedSet();
  const payload = JSON.parse(invalid['data/sources.json']);
  delete payload.sources[0].approval_status;
  invalid['data/sources.json'] = `${JSON.stringify(payload, null, 2)}\n`;
  assert.throws(
    () => plan({ candidateContents:invalid, runtimeContents:seedSet(), metadata:null }),
    error => {
      assert.ok(error instanceof ReconciliationBlockedError);
      assert.equal(error.evidence.failure_stage, 'candidate_validation');
      assert.equal(error.evidence.validation_result, 'FAIL');
      assert.match(error.evidence.reason, /canonical governance form/);
      return true;
    },
  );
});

test('source category contract rejects unsupported fields', () => {
  const invalid = managedSet({ categories:[category('general','General',{ unexpected:true })] });
  assert.throws(
    () => validateCandidateManagedSet(invalid),
    /canonical normalized form|unsupported or missing fields/,
  );
});

test('source registry rejects duplicate URLs and unknown category references', () => {
  const duplicate = managedSet({
    sources:[
      source(),
      source('src-two','Two','https://example.com/jobs'),
    ],
  });
  assert.throws(() => validateCandidateManagedSet(duplicate), /duplicate source URL/);

  const unknown = managedSet({
    sources:[source('src-bad','Bad','https://bad.example/jobs','Missing')],
  });
  assert.throws(() => validateCandidateManagedSet(unknown), /unknown category/);
});

test('runtime-only change is preserved and does not advance candidate baseline', () => {
  const baseline = managedSet();
  const runtimeContents = managedSet({
    sources:[source(), source('src-two','Two','https://example.org/jobs')],
  });
  const result = plan({ candidateContents:baseline, runtimeContents, metadata:metadataFrom(baseline) });
  const item = result.files['data/sources.json'];
  assert.equal(item.action, 'preserve_runtime');
  assert.equal(item.next_baseline_digest, item.baseline_digest);
  assert.equal(item.runtime_after_digest, item.runtime_before_digest);
});

test('candidate change applies only when runtime still equals accepted baseline', () => {
  const baseline = managedSet();
  const candidateContents = managedSet({
    sources:[source(), source('src-two','Two','https://example.org/jobs')],
  });
  const result = plan({ candidateContents, runtimeContents:baseline, metadata:metadataFrom(baseline) });
  assert.equal(result.files['data/sources.json'].action, 'apply_candidate');
  assert.equal(result.files['data/sources.json'].next_baseline_digest, sha256Text(candidateContents['data/sources.json']));
});

test('runtime already equal to changed candidate is a no-op but requires verified baseline advancement', () => {
  const baseline = managedSet();
  const candidateContents = managedSet({
    sources:[source(), source('src-two','Two','https://example.org/jobs')],
  });
  const result = plan({ candidateContents, runtimeContents:candidateContents, metadata:metadataFrom(baseline) });
  assert.equal(result.files['data/sources.json'].action, 'noop_runtime_already_candidate');
  assert.equal(result.requires_acceptance, true);
});

test('candidate and runtime change on the same file conflicts with structured evidence', () => {
  const baseline = managedSet();
  const candidateContents = managedSet({
    sources:[source(), source('src-two','Candidate','https://candidate.example/jobs')],
  });
  const runtimeContents = managedSet({
    sources:[source(), source('src-three','Runtime','https://runtime.example/jobs')],
  });
  assert.throws(
    () => plan({ candidateContents, runtimeContents, metadata:metadataFrom(baseline) }),
    error => {
      assert.ok(error instanceof ReconciliationBlockedError);
      assert.equal(error.evidence.failure_stage, 'decision_table');
      assert.match(error.evidence.reason, /candidate\/runtime conflict/);
      return true;
    },
  );
});

test('unresolved pending promotion fails closed with metadata evidence', () => {
  const contents = managedSet();
  assert.throws(
    () => plan({
      candidateContents:contents,
      runtimeContents:contents,
      metadata:metadataFrom(contents, { pending_promotion:{ candidate_sha:SHA } }),
    }),
    error => {
      assert.ok(error instanceof ReconciliationBlockedError);
      assert.equal(error.evidence.failure_stage, 'metadata_validation');
      assert.match(error.evidence.reason, /Unresolved pending/);
      return true;
    },
  );
});

test('decision table rejects both-sides divergence', () => {
  const a = sha256Text('a');
  const b = sha256Text('b');
  const c = sha256Text('c');
  assert.throws(
    () => reconcileFileDecision({ baselineDigest:a, candidateDigest:b, runtimeDigest:c }),
    /conflict/,
  );
});

test('protected functional visibility proves managed files through deployed Worker /data paths', async () => {
  const contents = managedSet();
  const result = plan({ candidateContents:contents, runtimeContents:contents, metadata:metadataFrom(contents) });
  result.promotion_runtime_sha = PROMOTION;
  const payloads = parsedPayloads(contents);
  const seen = [];
  const proof = await verifyProtectedFunctionalVisibility(runtime(), result, {
    googleIdToken:'test-google-id-token',
    fetchFn: async (url, init) => {
      const path = `data/${decodeURIComponent(new URL(url).pathname.slice('/data/'.length))}`;
      seen.push({
        url:String(url),
        authorization:init.headers.Authorization,
      });
      return new Response(JSON.stringify(payloads[path]), {
        status:200,
        headers:{ 'content-type':'application/json' },
      });
    },
  });
  assert.equal(proof.status, 'PASS');
  assert.equal(proof.method, 'deployed-protected-data');
  assert.deepEqual(Object.keys(proof.files).sort(), [...CANDIDATE_MANAGED_PATHS].sort());
  assert.ok(seen.every(item => item.url.startsWith('https://dev.example.test/data/')));
  assert.ok(seen.every(item => item.authorization === 'Bearer test-google-id-token'));
  for (const path of CANDIDATE_MANAGED_PATHS) {
    assert.equal(proof.files[path].http_status, 200);
    assert.equal(proof.files[path].visible_semantic_digest, result.files[path].functional_expected_digest);
  }
});

test('deployed functional visibility mismatch fails before acceptance with structured proof', async () => {
  const contents = managedSet();
  const result = plan({ candidateContents:contents, runtimeContents:contents, metadata:metadataFrom(contents) });
  result.promotion_runtime_sha = PROMOTION;
  const payloads = parsedPayloads(contents);
  payloads['data/sources.json'].sources[0].name = 'Tampered';
  await assert.rejects(
    () => verifyProtectedFunctionalVisibility(runtime(), result, {
      googleIdToken:'test-google-id-token',
      fetchFn: async url => {
        const path = `data/${decodeURIComponent(new URL(url).pathname.slice('/data/'.length))}`;
        return new Response(JSON.stringify(payloads[path]), { status:200 });
      },
    }),
    error => {
      assert.ok(error instanceof FunctionalVisibilityError);
      assert.equal(error.proof.status, 'FAIL');
      assert.equal(error.proof.method, 'deployed-protected-data');
      assert.match(error.proof.reason, /visibility mismatch/);
      return true;
    },
  );
});

test('deployed functional visibility fails closed without auth token or on protected HTTP failure', async () => {
  const contents = managedSet();
  const result = plan({ candidateContents:contents, runtimeContents:contents, metadata:metadataFrom(contents) });
  result.promotion_runtime_sha = PROMOTION;

  await assert.rejects(
    () => verifyProtectedFunctionalVisibility(runtime(), result, {
      googleIdToken:'',
      fetchFn: async () => new Response('{}', { status:200 }),
    }),
    error => error instanceof FunctionalVisibilityError
      && /FUNCTIONAL_GOOGLE_ID_TOKEN is required/.test(error.proof.reason),
  );

  await assert.rejects(
    () => verifyProtectedFunctionalVisibility(runtime(), result, {
      googleIdToken:'test-google-id-token',
      fetchFn: async () => new Response(JSON.stringify({ error:'GitHub token is not configured' }), { status:503 }),
    }),
    error => error instanceof FunctionalVisibilityError
      && error.proof.method === 'deployed-protected-data'
      && /HTTP 503/.test(error.proof.reason),
  );
});

test('accepted baseline cannot advance without snapshot and protected functional PASS', () => {
  const baseline = managedSet();
  const candidate = managedSet({
    sources:[source(), source('src-two','Two','https://example.org/jobs')],
  });
  const result = plan({ candidateContents:candidate, runtimeContents:baseline, metadata:metadataFrom(baseline) });
  result.promotion_runtime_sha = PROMOTION;

  assert.throws(
    () => prepareAcceptanceState({
      environment:'dev',
      currentHead:PROMOTION,
      reconciliation:result,
      metadata:result.pending_metadata,
      snapshotVerification:'PASS',
      functionalVisibility:{ status:'FAIL' },
    }),
    /functional visibility must PASS/,
  );

  assert.throws(
    () => prepareAcceptanceState({
      environment:'dev',
      currentHead:PROMOTION,
      reconciliation:result,
      metadata:result.pending_metadata,
      snapshotVerification:'FAIL',
      functionalVisibility:{ status:'PASS' },
    }),
    /snapshot verification must PASS/,
  );
});

test('successful verification prepares accepted baseline only after functional PASS', () => {
  const baseline = managedSet();
  const candidate = managedSet({
    sources:[source(), source('src-two','Two','https://example.org/jobs')],
  });
  const result = plan({ candidateContents:candidate, runtimeContents:baseline, metadata:metadataFrom(baseline) });
  result.promotion_runtime_sha = PROMOTION;
  const prepared = prepareAcceptanceState({
    environment:'dev',
    currentHead:PROMOTION,
    reconciliation:result,
    metadata:result.pending_metadata,
    snapshotVerification:'PASS',
    functionalVisibility:{ status:'PASS' },
    now:'2026-09-23T01:00:00.000Z',
  });
  assert.equal(prepared.status, 'READY');
  assert.equal(prepared.accepted_metadata.pending_promotion, null);
  assert.equal(
    prepared.accepted_metadata.accepted_baselines['data/sources.json'],
    result.files['data/sources.json'].next_baseline_digest,
  );
});

test('concurrent mutation blocks baseline acceptance without overwrite', () => {
  const baseline = managedSet();
  const candidate = managedSet({
    sources:[source(), source('src-two','Two','https://example.org/jobs')],
  });
  const result = plan({ candidateContents:candidate, runtimeContents:baseline, metadata:metadataFrom(baseline) });
  result.promotion_runtime_sha = PROMOTION;
  const prepared = prepareAcceptanceState({
    environment:'dev',
    currentHead:CONCURRENT,
    reconciliation:result,
    metadata:result.pending_metadata,
    snapshotVerification:'PASS',
    functionalVisibility:{ status:'PASS' },
  });
  assert.equal(prepared.status, 'DEGRADED');
  assert.equal(prepared.accepted_metadata, null);
  assert.match(prepared.reason, /Runtime changed before baseline acceptance/);
});

test('compensating revert is permitted only when runtime HEAD still equals promotion commit', () => {
  assert.deepEqual(
    compensatingRevertDecision({
      mutationPerformed:false,
      currentHead:PROMOTION,
      promotionRuntimeSha:PROMOTION,
    }),
    { status:'NOT_REQUIRED' },
  );
  assert.deepEqual(
    compensatingRevertDecision({
      mutationPerformed:true,
      currentHead:PROMOTION,
      promotionRuntimeSha:PROMOTION,
    }),
    { status:'REVERT', runtime_head:PROMOTION },
  );
  const blocked = compensatingRevertDecision({
    mutationPerformed:true,
    currentHead:CONCURRENT,
    promotionRuntimeSha:PROMOTION,
  });
  assert.equal(blocked.status, 'DEGRADED');
  assert.match(blocked.reason, /compensating revert refused/);
});

test('failed functional verification leaves baseline pending and selects compensating revert', () => {
  const baseline = managedSet();
  const candidate = managedSet({
    sources:[source(), source('src-two','Two','https://example.org/jobs')],
  });
  const result = plan({ candidateContents:candidate, runtimeContents:baseline, metadata:metadataFrom(baseline) });
  result.promotion_runtime_sha = PROMOTION;
  result.mutation_performed = true;

  assert.ok(result.pending_metadata?.pending_promotion);
  assert.throws(
    () => prepareAcceptanceState({
      environment:'dev',
      currentHead:PROMOTION,
      reconciliation:result,
      metadata:result.pending_metadata,
      snapshotVerification:'PASS',
      functionalVisibility:{ status:'FAIL' },
    }),
    /functional visibility must PASS/,
  );
  assert.ok(result.pending_metadata?.pending_promotion, 'failed verification must not consume pending metadata');
  assert.deepEqual(
    compensatingRevertDecision({
      mutationPerformed:true,
      currentHead:PROMOTION,
      promotionRuntimeSha:PROMOTION,
    }),
    { status:'REVERT', runtime_head:PROMOTION },
  );
});
