import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALLOWLIST_VERSION,
  CANDIDATE_MANAGED_PATHS,
  KNOWN_SEED_DIGESTS,
  RECONCILIATION_SCHEMA_VERSION,
  planCandidateManagedReconciliation,
  reconcileFileDecision,
  sha256Text,
} from './environment/reconciliation.mjs';
import { serializeSeed } from './environment/seed.mjs';

const SHA = 'a'.repeat(40);
const CONTROL = 'b'.repeat(40);
const RUNTIME = 'c'.repeat(40);

function category(id = 'general', label = 'General') {
  return { id, label, active: true, order: 10 };
}

function source(id = 'src-one', name = 'One', url = 'https://example.com/jobs', categoryLabel = 'General') {
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
  };
}

function managedSet({ sources = [], categories = [] } = {}) {
  return {
    'data/sources.json': `${JSON.stringify({ schema_version:'1.0', count:sources.length, sources }, null, 2)}\n`,
    'data/source-categories.json': `${JSON.stringify({ schema_version:'1.0', count:categories.length, categories }, null, 2)}\n`,
    'data/nomenclatures.json': serializeSeed('nomenclatures.json', {
      sourceSha: null,
      generatedAt: '1970-01-01T00:00:00.000Z',
      environment: 'dev',
      searchMode: 'disabled',
    }),
  };
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

test('candidate-managed allowlist is explicit and exact', () => {
  assert.deepEqual(CANDIDATE_MANAGED_PATHS, [
    'data/sources.json',
    'data/source-categories.json',
    'data/nomenclatures.json',
  ]);
  assert.equal(Object.keys(KNOWN_SEED_DIGESTS).length, 3);
});

test('exact known seed bootstrap promotes candidate source registry atomically', () => {
  const runtimeContents = managedSet();
  const candidateContents = managedSet({
    categories: [category()],
    sources: [source()],
  });
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

test('bootstrap fails closed when runtime is not an exact trusted seed', () => {
  const runtimeContents = managedSet({ categories:[category()] });
  const candidateContents = runtimeContents;
  assert.throws(
    () => plan({ candidateContents, runtimeContents, metadata:null }),
    /not an exact trusted seed/,
  );
});

test('runtime-only change is preserved and does not advance candidate baseline', () => {
  const baseline = managedSet({ categories:[category()], sources:[source()] });
  const runtimeContents = managedSet({
    categories:[category()],
    sources:[source(), source('src-two','Two','https://example.org/jobs')],
  });
  const result = plan({ candidateContents:baseline, runtimeContents, metadata:metadataFrom(baseline) });
  const item = result.files['data/sources.json'];
  assert.equal(item.action, 'preserve_runtime');
  assert.equal(item.next_baseline_digest, item.baseline_digest);
  assert.equal(item.runtime_after_digest, item.runtime_before_digest);
});

test('candidate change applies only when runtime still equals accepted baseline', () => {
  const baseline = managedSet({ categories:[category()], sources:[source()] });
  const candidateContents = managedSet({
    categories:[category()],
    sources:[source(), source('src-two','Two','https://example.org/jobs')],
  });
  const result = plan({ candidateContents, runtimeContents:baseline, metadata:metadataFrom(baseline) });
  assert.equal(result.files['data/sources.json'].action, 'apply_candidate');
  assert.equal(result.files['data/sources.json'].next_baseline_digest, sha256Text(candidateContents['data/sources.json']));
});

test('runtime already equal to changed candidate is a no-op but advances baseline after verification', () => {
  const baseline = managedSet({ categories:[category()], sources:[source()] });
  const candidateContents = managedSet({
    categories:[category()],
    sources:[source(), source('src-two','Two','https://example.org/jobs')],
  });
  const result = plan({ candidateContents, runtimeContents:candidateContents, metadata:metadataFrom(baseline) });
  assert.equal(result.files['data/sources.json'].action, 'noop_runtime_already_candidate');
  assert.equal(result.requires_acceptance, true);
});

test('candidate and runtime change on the same file conflicts and fails closed', () => {
  const baseline = managedSet({ categories:[category()], sources:[source()] });
  const candidateContents = managedSet({
    categories:[category()],
    sources:[source(), source('src-two','Candidate','https://candidate.example/jobs')],
  });
  const runtimeContents = managedSet({
    categories:[category()],
    sources:[source(), source('src-three','Runtime','https://runtime.example/jobs')],
  });
  assert.throws(
    () => plan({ candidateContents, runtimeContents, metadata:metadataFrom(baseline) }),
    /candidate\/runtime conflict/,
  );
});

test('unsupported release-control metadata schema fails closed', () => {
  const contents = managedSet();
  assert.throws(
    () => plan({
      candidateContents:contents,
      runtimeContents:contents,
      metadata:metadataFrom(contents, { schema_version:'9.9' }),
    }),
    /Unsupported release-control metadata schema_version/,
  );
});

test('unresolved pending promotion fails closed', () => {
  const contents = managedSet();
  assert.throws(
    () => plan({
      candidateContents:contents,
      runtimeContents:contents,
      metadata:metadataFrom(contents, { pending_promotion:{ candidate_sha:SHA } }),
    }),
    /Unresolved pending/,
  );
});

test('cross-file source/category integrity is validated before mutation', () => {
  const runtimeContents = managedSet();
  const candidateContents = managedSet({
    categories:[category()],
    sources:[source('src-bad','Bad','https://bad.example/jobs','Missing')],
  });
  assert.throws(
    () => plan({ candidateContents, runtimeContents, metadata:null }),
    /unknown category/,
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
