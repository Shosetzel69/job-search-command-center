import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { CANDIDATE_MANAGED_DATA_FILES } from '../../shared/runtime-data.mjs';
import { assertNomenclatures } from '../../shared/nomenclatures.mjs';
import {
  normalizeCategoryCatalog,
  normalizeSource,
  sameUrl,
} from '../../command-api/src/source-governance.js';
import { serializeSeed } from './seed.mjs';
import { SHA_RE } from './contract.mjs';

export const RECONCILIATION_SCHEMA_VERSION = '1.0';
export const ALLOWLIST_VERSION = '1.0';
export const RELEASE_CONTROL_METADATA_PATH = '.release-control/candidate-managed.json';
export const CANDIDATE_MANAGED_PATHS = Object.freeze(
  CANDIDATE_MANAGED_DATA_FILES.map(file => `data/${file}`),
);

const ACTIONS = new Set([
  'noop_baseline',
  'noop_runtime_already_candidate',
  'apply_candidate',
  'preserve_runtime',
]);

const LEGACY_MONSTER_KEYS = Object.freeze([
  'active',
  'category',
  'connector_available',
  'id',
  'name',
  'url',
]);

function requireSha(value, label) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!SHA_RE.test(normalized)) throw new Error(`${label} must be a full immutable commit SHA`);
  return normalized;
}

function run(command, args, { cwd, env } = {}) {
  return execFileSync(command, args, {
    cwd: cwd || process.cwd(),
    env: env || process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

export function sha256Text(value) {
  return `sha256:${createHash('sha256').update(String(value), 'utf8').digest('hex')}`;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
  }
  return value;
}

function semanticallyEqual(a, b) {
  return JSON.stringify(stableValue(a)) === JSON.stringify(stableValue(b));
}

function semanticDigest(value) {
  return sha256Text(JSON.stringify(stableValue(value)));
}

function readText(path) {
  return readFileSync(resolve(path), 'utf8');
}

function writeText(path, content) {
  mkdirSync(dirname(resolve(path)), { recursive: true });
  writeFileSync(resolve(path), content, 'utf8');
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function categoryKey(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ro-RO');
}

function assertExactRoot(payload, kind, expectedKeys) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error(`${kind} catalog must be an object`);
  }
  const actual = Object.keys(payload).sort();
  const expected = [...expectedKeys].sort();
  if (actual.join('|') !== expected.join('|')) {
    throw new Error(`${kind} catalog contains unsupported or missing root fields`);
  }
}

function validateCategories(payload) {
  assertExactRoot(payload, 'source categories', ['schema_version', 'count', 'categories']);
  if (payload.schema_version !== '1.0') throw new Error('Unsupported source categories schema_version');
  if (!Array.isArray(payload.categories)) throw new Error('source categories must contain categories[]');
  if (payload.count !== payload.categories.length) throw new Error('source categories count mismatch');

  const normalized = normalizeCategoryCatalog(payload);
  if (!semanticallyEqual(normalized, payload)) {
    throw new Error('source categories are not in canonical normalized form');
  }

  const labels = new Set();
  for (const category of payload.categories) {
    const keys = Object.keys(category || {}).sort();
    if (keys.join('|') !== ['active','id','label','order'].sort().join('|')) {
      throw new Error(`source category has unsupported or missing fields: ${category?.id || '<unknown>'}`);
    }
    labels.add(categoryKey(category.label));
  }
  return labels;
}

function isCanonicalSource(source) {
  return semanticallyEqual(normalizeSource(source, { legacyApproved:true }), source);
}

function assertLegacyMonster(source) {
  const keys = Object.keys(source || {}).sort();
  if (keys.join('|') !== [...LEGACY_MONSTER_KEYS].sort().join('|')) {
    throw new Error('Monster legacy record has unexpected physical fields');
  }
  if (source.active !== true || source.connector_available !== true) {
    throw new Error('Monster legacy physical state is invalid');
  }
  const normalized = normalizeSource(source, { legacyApproved:true });
  if (normalized.policy_excluded !== true || normalized.active !== false) {
    throw new Error('Monster must remain operationally policy-excluded');
  }
}

function validateSources(payload, categoryLabels) {
  assertExactRoot(payload, 'sources', ['schema_version', 'count', 'sources']);
  if (payload.schema_version !== '1.0') throw new Error('Unsupported sources schema_version');
  if (!Array.isArray(payload.sources)) throw new Error('sources catalog must contain sources[]');
  if (payload.count !== payload.sources.length) throw new Error('sources count mismatch');

  const ids = new Set();
  const urls = [];
  let monsterCount = 0;

  for (const source of payload.sources) {
    const id = String(source?.id || '').trim();
    const name = String(source?.name || '').trim();
    const url = String(source?.url || '').trim();
    const category = String(source?.category || '').trim();
    if (!id || !name || !url || !category) throw new Error('source id/name/url/category is required');
    if ('priority' in source) throw new Error(`source contains forbidden legacy priority: ${name}`);
    if (ids.has(id)) throw new Error(`duplicate source id: ${id}`);
    ids.add(id);

    let parsed;
    try { parsed = new URL(url); } catch { throw new Error(`invalid source URL: ${name}`); }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error(`unsupported source URL protocol: ${name}`);
    if (urls.some(existing => sameUrl(existing, url))) throw new Error(`duplicate source URL: ${url}`);
    urls.push(url);

    if (!categoryLabels.has(categoryKey(category))) {
      throw new Error(`source references unknown category: ${name} -> ${category}`);
    }

    if (name === 'Monster') {
      monsterCount += 1;
      if (!isCanonicalSource(source)) assertLegacyMonster(source);
      continue;
    }
    if (!isCanonicalSource(source)) {
      throw new Error(`source is not in canonical governance form: ${name}`);
    }
  }

  if (monsterCount !== 1) throw new Error('Exactly one Monster policy-excluded source is required');
}

export function validateCandidateManagedSet(contents) {
  for (const path of CANDIDATE_MANAGED_PATHS) {
    if (typeof contents?.[path] !== 'string') throw new Error(`Missing managed file: ${path}`);
  }
  const categories = parseJson(contents['data/source-categories.json'], 'source categories');
  const categoryLabels = validateCategories(categories);
  validateSources(parseJson(contents['data/sources.json'], 'sources'), categoryLabels);
  assertNomenclatures(parseJson(contents['data/nomenclatures.json'], 'nomenclatures'));
  return true;
}

export function knownSeedDigests() {
  const options = {
    sourceSha: null,
    generatedAt: '1970-01-01T00:00:00.000Z',
    environment: 'dev',
    searchMode: 'disabled',
  };
  return Object.freeze(Object.fromEntries(
    CANDIDATE_MANAGED_PATHS.map(path => [
      path,
      sha256Text(serializeSeed(path.replace('data/', ''), options)),
    ]),
  ));
}

export const KNOWN_SEED_DIGESTS = knownSeedDigests();

function assertDigest(value, label) {
  const text = String(value || '');
  if (!/^sha256:[0-9a-f]{64}$/.test(text)) throw new Error(`${label} must be a sha256 digest`);
  return text;
}

export function normalizeReleaseControlMetadata(metadata, environment) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new Error('release-control metadata must be an object');
  }
  if (metadata.schema_version !== RECONCILIATION_SCHEMA_VERSION) {
    throw new Error('Unsupported release-control metadata schema_version');
  }
  if (metadata.allowlist_version !== ALLOWLIST_VERSION) {
    throw new Error('Unsupported release-control allowlist_version');
  }
  if (metadata.environment !== environment) throw new Error('release-control environment mismatch');
  if (metadata.pending_promotion) {
    throw new Error('Unresolved pending candidate-managed promotion requires explicit recovery');
  }
  const accepted = {};
  for (const path of CANDIDATE_MANAGED_PATHS) {
    accepted[path] = assertDigest(metadata.accepted_baselines?.[path], `accepted baseline ${path}`);
  }
  return {
    schema_version: RECONCILIATION_SCHEMA_VERSION,
    allowlist_version: ALLOWLIST_VERSION,
    environment,
    accepted_baselines: accepted,
    accepted_promotion: metadata.accepted_promotion || null,
    previous_accepted_promotion: metadata.previous_accepted_promotion || null,
    pending_promotion: null,
  };
}

function digestSet(contents) {
  return Object.fromEntries(CANDIDATE_MANAGED_PATHS.map(path => [path, sha256Text(contents[path])]));
}

function semanticDigestSet(contents) {
  return Object.fromEntries(CANDIDATE_MANAGED_PATHS.map(path => [
    path,
    semanticDigest(parseJson(contents[path], path)),
  ]));
}

function explicitSeedBaseline(runtimeDigests) {
  for (const path of CANDIDATE_MANAGED_PATHS) {
    if (runtimeDigests[path] !== KNOWN_SEED_DIGESTS[path]) {
      throw new Error(`Missing release-control baseline and runtime is not an exact trusted seed: ${path}`);
    }
  }
  return { ...runtimeDigests };
}

export function reconcileFileDecision({ baselineDigest, candidateDigest, runtimeDigest }) {
  assertDigest(baselineDigest, 'baseline digest');
  assertDigest(candidateDigest, 'candidate digest');
  assertDigest(runtimeDigest, 'runtime digest');

  if (candidateDigest === baselineDigest && runtimeDigest === baselineDigest) {
    return { action: 'noop_baseline', runtimeAfterDigest: runtimeDigest, nextBaselineDigest: baselineDigest };
  }
  if (runtimeDigest === candidateDigest) {
    return { action: 'noop_runtime_already_candidate', runtimeAfterDigest: runtimeDigest, nextBaselineDigest: candidateDigest };
  }
  if (candidateDigest !== baselineDigest && runtimeDigest === baselineDigest) {
    return { action: 'apply_candidate', runtimeAfterDigest: candidateDigest, nextBaselineDigest: candidateDigest };
  }
  if (candidateDigest === baselineDigest && runtimeDigest !== baselineDigest) {
    return { action: 'preserve_runtime', runtimeAfterDigest: runtimeDigest, nextBaselineDigest: baselineDigest };
  }
  throw new Error('candidate/runtime conflict against accepted baseline');
}

function buildBlockedEvidence({
  environment,
  candidateSha,
  controlPlaneSha,
  runtimeHead,
  files = {},
  reason,
  failureStage = 'reconciliation',
  validationResult = 'NOT_RUN',
}) {
  return {
    schema_version: RECONCILIATION_SCHEMA_VERSION,
    environment,
    control_plane_sha: controlPlaneSha,
    candidate_sha: candidateSha,
    runtime_head_before: runtimeHead,
    promotion_runtime_sha: null,
    acceptance_runtime_head: null,
    allowlist_version: ALLOWLIST_VERSION,
    files,
    reconciliation_result: 'BLOCKED',
    validation_result: validationResult,
    failure_stage: failureStage,
    functional_visibility: { status:'NOT_RUN', method:'canonical-protected-runtime-read', files:{} },
    acceptance_result: 'NOT_RUN',
    revert_result: 'NOT_REQUIRED',
    reason,
  };
}

export class ReconciliationBlockedError extends Error {
  constructor(message, evidence) {
    super(message);
    this.name = 'ReconciliationBlockedError';
    this.evidence = evidence;
  }
}

export class FunctionalVisibilityError extends Error {
  constructor(message, proof) {
    super(message);
    this.name = 'FunctionalVisibilityError';
    this.proof = proof;
  }
}

export function planCandidateManagedReconciliation({
  environment,
  candidateSha,
  controlPlaneSha,
  runtimeHead,
  candidateContents,
  runtimeContents,
  metadata = null,
  now = new Date().toISOString(),
}) {
  const candidate = requireSha(candidateSha, 'CANDIDATE_SHA');
  const controlPlane = requireSha(controlPlaneSha, 'CONTROL_PLANE_SHA');
  const runtimeBefore = requireSha(runtimeHead, 'runtime HEAD');
  const files = {};
  let failureStage = 'candidate_validation';

  try {
    validateCandidateManagedSet(candidateContents);

    const candidateDigests = digestSet(candidateContents);
    const runtimeDigests = digestSet(runtimeContents);
    const bootstrap = metadata == null;

    let normalizedMetadata = null;
    let baselineDigests;
    if (bootstrap) {
      // Bootstrap runtime files are intentionally minimal seeds. They are
      // accepted only by exact trusted digests and are not treated as a
      // canonical operational catalog before candidate reconciliation.
      failureStage = 'bootstrap_validation';
      baselineDigests = explicitSeedBaseline(runtimeDigests);
    } else {
      failureStage = 'runtime_validation';
      validateCandidateManagedSet(runtimeContents);
      failureStage = 'metadata_validation';
      normalizedMetadata = normalizeReleaseControlMetadata(metadata, environment);
      baselineDigests = normalizedMetadata.accepted_baselines;
    }

    const targetContents = {};
    const nextBaselines = {};
    failureStage = 'decision_table';
    for (const path of CANDIDATE_MANAGED_PATHS) {
      const decision = reconcileFileDecision({
        baselineDigest: baselineDigests[path],
        candidateDigest: candidateDigests[path],
        runtimeDigest: runtimeDigests[path],
      });
      if (!ACTIONS.has(decision.action)) throw new Error(`unsupported reconciliation action for ${path}`);
      targetContents[path] = decision.action === 'apply_candidate' ? candidateContents[path] : runtimeContents[path];
      nextBaselines[path] = decision.nextBaselineDigest;
      files[path] = {
        baseline_digest: baselineDigests[path],
        candidate_digest: candidateDigests[path],
        runtime_before_digest: runtimeDigests[path],
        action: decision.action,
        runtime_after_digest: decision.runtimeAfterDigest,
        next_baseline_digest: decision.nextBaselineDigest,
      };
    }

    failureStage = 'target_validation';
    validateCandidateManagedSet(targetContents);
    const targetSemanticDigests = semanticDigestSet(targetContents);
    for (const path of CANDIDATE_MANAGED_PATHS) {
      files[path].functional_expected_digest = targetSemanticDigests[path];
    }

    const baselineAdvances = CANDIDATE_MANAGED_PATHS.some(
      path => nextBaselines[path] !== baselineDigests[path],
    );
    const dataChanges = CANDIDATE_MANAGED_PATHS.some(
      path => files[path].runtime_after_digest !== files[path].runtime_before_digest,
    );
    const requiresAcceptance = bootstrap || baselineAdvances;
    const requiresMutation = dataChanges || requiresAcceptance;

    const pendingMetadata = requiresAcceptance ? {
      schema_version: RECONCILIATION_SCHEMA_VERSION,
      allowlist_version: ALLOWLIST_VERSION,
      environment,
      accepted_baselines: { ...baselineDigests },
      accepted_promotion: normalizedMetadata?.accepted_promotion || null,
      previous_accepted_promotion: normalizedMetadata?.previous_accepted_promotion || null,
      pending_promotion: {
        candidate_sha: candidate,
        control_plane_sha: controlPlane,
        runtime_head_before: runtimeBefore,
        started_at: now,
        next_accepted_baselines: { ...nextBaselines },
        files,
      },
    } : null;

    return {
      schema_version: RECONCILIATION_SCHEMA_VERSION,
      environment,
      control_plane_sha: controlPlane,
      candidate_sha: candidate,
      runtime_head_before: runtimeBefore,
      allowlist_version: ALLOWLIST_VERSION,
      bootstrap,
      files,
      reconciliation_result: 'PASS',
      validation_result: 'PASS',
      target_contents: targetContents,
      requires_mutation: requiresMutation,
      requires_acceptance: requiresAcceptance,
      pending_metadata: pendingMetadata,
    };
  } catch (error) {
    if (error instanceof ReconciliationBlockedError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new ReconciliationBlockedError(message, buildBlockedEvidence({
      environment,
      candidateSha: candidate,
      controlPlaneSha: controlPlane,
      runtimeHead: runtimeBefore,
      files,
      reason: message,
      failureStage,
      validationResult: failureStage.includes('validation') ? 'FAIL' : 'NOT_RUN',
    }));
  }
}

function readManagedContents(root) {
  return Object.fromEntries(CANDIDATE_MANAGED_PATHS.map(path => [path, readText(resolve(root, path))]));
}

function readMetadata(root) {
  const path = resolve(root, RELEASE_CONTROL_METADATA_PATH);
  if (!existsSync(path)) return null;
  return parseJson(readText(path), 'release-control metadata');
}

function verifyNoUnexpectedChanges(repoDir) {
  const lines = run('git', ['status', '--porcelain'], { cwd: repoDir }).trim().split('\n').filter(Boolean);
  const allowed = new Set([...CANDIDATE_MANAGED_PATHS, RELEASE_CONTROL_METADATA_PATH]);
  for (const line of lines) {
    const path = line.slice(3).trim();
    if (!allowed.has(path)) throw new Error(`Unexpected runtime mutation outside allowlist: ${path}`);
  }
}

function remoteHead(repoDir, runtimeRef, env) {
  const output = run('git', ['ls-remote', 'origin', `refs/heads/${runtimeRef}`], { cwd: repoDir, env }).trim();
  const sha = output.split(/\s+/)[0]?.toLowerCase();
  return requireSha(sha, 'remote runtime HEAD');
}

function assertExpectedRemoteHead(repoDir, runtimeRef, expectedHead, env) {
  const actual = remoteHead(repoDir, runtimeRef, env);
  if (actual !== expectedHead) {
    throw new Error(`Runtime changed concurrently: expected ${expectedHead}, got ${actual}`);
  }
}

function commitAndPush(repoDir, runtimeRef, expectedHead, message, env) {
  assertExpectedRemoteHead(repoDir, runtimeRef, expectedHead, env);
  run('git', ['add', '--', ...CANDIDATE_MANAGED_PATHS, RELEASE_CONTROL_METADATA_PATH], { cwd: repoDir, env });
  verifyNoUnexpectedChanges(repoDir);
  const status = run('git', ['status', '--porcelain'], { cwd: repoDir, env }).trim();
  if (!status) return expectedHead;
  run('git', [
    '-c', 'user.name=job-search-environment-tool',
    '-c', 'user.email=environment-tool@users.noreply.github.com',
    'commit', '-m', message,
  ], { cwd: repoDir, env });
  const commit = requireSha(run('git', ['rev-parse', 'HEAD'], { cwd: repoDir, env }).trim(), 'runtime promotion commit');
  assertExpectedRemoteHead(repoDir, runtimeRef, expectedHead, env);
  run('git', ['push', 'origin', `HEAD:${runtimeRef}`], { cwd: repoDir, env });
  return commit;
}

function cloneRuntime(runtime, env, prefix) {
  const temp = mkdtempSync(resolve(tmpdir(), prefix));
  run('gh', ['auth', 'setup-git'], { env });
  run('gh', ['repo', 'clone', runtime.runtimeRepository, temp, '--', '--depth=2', '--branch', runtime.runtimeRef], { env });
  return temp;
}

export function candidateManagedContentsFromWorkspace(candidateWorkspace) {
  const root = resolve(String(candidateWorkspace || ''));
  if (!root || !existsSync(root)) throw new Error('CANDIDATE_DATA_WORKSPACE is missing');
  return readManagedContents(root);
}

export function reconcileRuntimeRepository(runtime, {
  candidateWorkspace,
  controlPlaneSha,
  gitEnv,
  expectedRuntimeHead = null,
  planner = planCandidateManagedReconciliation,
  now = new Date().toISOString(),
} = {}) {
  const temp = cloneRuntime(runtime, gitEnv, 'job-search-runtime-reconcile-');
  let runtimeHead = null;
  try {
    runtimeHead = requireSha(run('git', ['rev-parse', 'HEAD'], { cwd: temp, env: gitEnv }).trim(), 'runtime HEAD');
    if (expectedRuntimeHead != null) {
      const expected = requireSha(expectedRuntimeHead, 'expected runtime HEAD');
      if (runtimeHead !== expected) {
        throw new ReconciliationBlockedError(
          `Runtime HEAD moved before reconciliation: expected ${expected}, got ${runtimeHead}`,
          buildBlockedEvidence({
            environment: runtime.environment,
            candidateSha: runtime.sourceSha,
            controlPlaneSha,
            runtimeHead,
            reason: `Runtime HEAD moved before reconciliation: expected ${expected}, got ${runtimeHead}`,
            failureStage: 'runtime_anchor',
            validationResult: 'NOT_RUN',
          }),
        );
      }
    }
    let candidateContents;
    let runtimeContents;
    let metadata;
    try {
      candidateContents = candidateManagedContentsFromWorkspace(candidateWorkspace);
      runtimeContents = readManagedContents(temp);
      metadata = readMetadata(temp);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ReconciliationBlockedError(message, buildBlockedEvidence({
        environment: runtime.environment,
        candidateSha: runtime.sourceSha,
        controlPlaneSha,
        runtimeHead,
        reason: message,
        failureStage: 'input_load',
        validationResult: 'FAIL',
      }));
    }

    const plan = planner({
      environment: runtime.environment,
      candidateSha: runtime.sourceSha,
      controlPlaneSha,
      runtimeHead,
      candidateContents,
      runtimeContents,
      metadata,
      now,
    });

    if (!plan.requires_mutation) {
      return {
        ...plan,
        target_contents: undefined,
        pending_metadata: undefined,
        mutation_performed: false,
        promotion_runtime_sha: runtimeHead,
      };
    }

    try {
      for (const path of CANDIDATE_MANAGED_PATHS) {
        if (plan.files[path].runtime_after_digest !== plan.files[path].runtime_before_digest) {
          writeText(resolve(temp, path), plan.target_contents[path]);
        }
      }
      if (plan.pending_metadata) {
        writeText(resolve(temp, RELEASE_CONTROL_METADATA_PATH), `${JSON.stringify(plan.pending_metadata, null, 2)}\n`);
      }

      const promotionSha = commitAndPush(
        temp,
        runtime.runtimeRef,
        runtimeHead,
        `[PROMOTION] Reconcile candidate-managed data for ${runtime.environment.toUpperCase()}`,
        gitEnv,
      );
      return {
        ...plan,
        target_contents: undefined,
        pending_metadata: undefined,
        mutation_performed: promotionSha !== runtimeHead,
        promotion_runtime_sha: promotionSha,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ReconciliationBlockedError(message, buildBlockedEvidence({
        environment: runtime.environment,
        candidateSha: runtime.sourceSha,
        controlPlaneSha,
        runtimeHead,
        files: plan.files,
        reason: message,
        failureStage: 'runtime_commit',
        validationResult: 'PASS',
      }));
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

export function verifyRuntimePromotionSnapshot(runtime, reconciliation, { gitEnv } = {}) {
  const temp = cloneRuntime(runtime, gitEnv, 'job-search-runtime-verify-');
  try {
    for (const path of CANDIDATE_MANAGED_PATHS) {
      const content = run('git', ['show', `${reconciliation.promotion_runtime_sha}:${path}`], { cwd: temp, env: gitEnv });
      const digest = sha256Text(content);
      if (digest !== reconciliation.files[path].runtime_after_digest) {
        throw new Error(`Runtime snapshot digest mismatch after promotion: ${path}`);
      }
    }
    return 'PASS';
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

function payloadCount(path, payload) {
  if (path === 'data/sources.json') return Number(payload?.count ?? payload?.sources?.length ?? 0);
  if (path === 'data/source-categories.json') return Number(payload?.count ?? payload?.categories?.length ?? 0);
  if (path === 'data/nomenclatures.json') return Object.keys(payload?.domains || {}).length;
  return 0;
}

export async function verifyProtectedFunctionalVisibility(runtime, reconciliation, {
  oidcToken,
  fetchFn = fetch,
} = {}) {
  const token = String(oidcToken || '').trim();
  if (!token) {
    const proof = {
      status: 'FAIL',
      method: 'deployed-protected-data',
      origin: runtime.frontendOrigin,
      files: {},
      reason: 'FUNCTIONAL_GITHUB_OIDC_TOKEN is required',
    };
    throw new FunctionalVisibilityError(proof.reason, proof);
  }

  const origin = String(runtime.frontendOrigin || '').trim().replace(/\/+$/, '');
  if (!origin) {
    const proof = {
      status: 'FAIL',
      method: 'deployed-protected-data',
      origin: null,
      files: {},
      reason: 'Deployed environment origin is missing',
    };
    throw new FunctionalVisibilityError(proof.reason, proof);
  }

  const proof = {
    status: 'FAIL',
    method: 'deployed-protected-data',
    origin,
    files: {},
  };

  try {
    const visibleContents = {};
    for (const path of CANDIDATE_MANAGED_PATHS) {
      const file = path.slice('data/'.length);
      const url = new URL(`/data/${encodeURIComponent(file)}`, origin);
      const response = await fetchFn(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });
      const item = {
        path: url.pathname,
        http_status: response.status,
        expected_semantic_digest: reconciliation.files[path].functional_expected_digest,
        visible_semantic_digest: null,
        visible_count: null,
      };
      proof.files[path] = item;

      if (!response.ok) {
        let detail = '';
        try { detail = (await response.text()).slice(0, 300); } catch {}
        throw new Error(`Deployed protected data read failed: ${url.pathname} -> HTTP ${response.status}${detail ? ` (${detail})` : ''}`);
      }

      const payload = await response.json();
      const visibleDigest = semanticDigest(payload);
      item.visible_semantic_digest = visibleDigest;
      item.visible_count = payloadCount(path, payload);
      const expectedDigest = reconciliation.files[path].functional_expected_digest;
      if (visibleDigest !== expectedDigest) {
        throw new Error(`Deployed protected functional visibility mismatch: ${url.pathname}`);
      }
      visibleContents[path] = `${JSON.stringify(payload, null, 2)}\n`;
    }

    validateCandidateManagedSet(visibleContents);
    proof.status = 'PASS';
    return proof;
  } catch (error) {
    proof.reason = error instanceof Error ? error.message : String(error);
    throw new FunctionalVisibilityError(proof.reason, proof);
  }
}

function requireSuccessfulVerification({ snapshotVerification, functionalVisibility }) {
  if (snapshotVerification !== 'PASS') {
    throw new Error('Runtime snapshot verification must PASS before baseline acceptance');
  }
  if (functionalVisibility?.status !== 'PASS') {
    throw new Error('Protected functional visibility must PASS before baseline acceptance');
  }
}

export function prepareAcceptanceState({
  environment,
  currentHead,
  reconciliation,
  metadata,
  snapshotVerification,
  functionalVisibility,
  now = new Date().toISOString(),
}) {
  requireSuccessfulVerification({ snapshotVerification, functionalVisibility });
  const head = requireSha(currentHead, 'runtime HEAD');
  if (head !== reconciliation.promotion_runtime_sha) {
    return {
      status: 'DEGRADED',
      reason: `Runtime changed before baseline acceptance: expected ${reconciliation.promotion_runtime_sha}, got ${head}`,
      acceptance_runtime_head: head,
      accepted_metadata: null,
    };
  }

  if (!metadata?.pending_promotion) throw new Error('Pending release-control metadata is missing');
  if (metadata.schema_version !== RECONCILIATION_SCHEMA_VERSION || metadata.allowlist_version !== ALLOWLIST_VERSION) {
    throw new Error('Unsupported release-control metadata during acceptance');
  }
  if (metadata.environment !== environment) throw new Error('release-control environment mismatch during acceptance');

  const pending = metadata.pending_promotion;
  if (pending.candidate_sha !== reconciliation.candidate_sha
    || pending.control_plane_sha !== reconciliation.control_plane_sha
    || pending.runtime_head_before !== reconciliation.runtime_head_before) {
    throw new Error('Pending promotion identity does not match reconciliation evidence');
  }

  return {
    status: 'READY',
    acceptance_runtime_head: head,
    accepted_metadata: {
      schema_version: RECONCILIATION_SCHEMA_VERSION,
      allowlist_version: ALLOWLIST_VERSION,
      environment,
      accepted_baselines: { ...pending.next_accepted_baselines },
      previous_accepted_promotion: metadata.accepted_promotion || null,
      accepted_promotion: {
        candidate_sha: reconciliation.candidate_sha,
        control_plane_sha: reconciliation.control_plane_sha,
        runtime_data_sha: reconciliation.promotion_runtime_sha,
        accepted_at: now,
      },
      pending_promotion: null,
    },
  };
}

export function acceptRuntimeReconciliation(runtime, reconciliation, {
  gitEnv,
  snapshotVerification,
  functionalVisibility,
  now = new Date().toISOString(),
} = {}) {
  if (!reconciliation.requires_acceptance) {
    return {
      status: 'NOT_REQUIRED',
      acceptance_runtime_head: reconciliation.promotion_runtime_sha,
    };
  }
  const temp = cloneRuntime(runtime, gitEnv, 'job-search-runtime-accept-');
  try {
    const head = requireSha(run('git', ['rev-parse', 'HEAD'], { cwd: temp, env: gitEnv }).trim(), 'runtime HEAD');
    const prepared = prepareAcceptanceState({
      environment: runtime.environment,
      currentHead: head,
      reconciliation,
      metadata: readMetadata(temp),
      snapshotVerification,
      functionalVisibility,
      now,
    });
    if (prepared.status === 'DEGRADED') return prepared;

    writeText(
      resolve(temp, RELEASE_CONTROL_METADATA_PATH),
      `${JSON.stringify(prepared.accepted_metadata, null, 2)}\n`,
    );
    const acceptedHead = commitAndPush(
      temp,
      runtime.runtimeRef,
      head,
      `[PROMOTION] Accept candidate-managed baseline for ${runtime.environment.toUpperCase()}`,
      gitEnv,
    );
    return { status: 'ACCEPTED', acceptance_runtime_head: acceptedHead };
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

export function compensatingRevertDecision({
  mutationPerformed,
  currentHead,
  promotionRuntimeSha,
}) {
  if (!mutationPerformed) return { status:'NOT_REQUIRED' };
  const head = requireSha(currentHead, 'runtime HEAD');
  const promotion = requireSha(promotionRuntimeSha, 'promotion runtime SHA');
  if (head !== promotion) {
    return {
      status: 'DEGRADED',
      reason: `Runtime changed after promotion; compensating revert refused: expected ${promotion}, got ${head}`,
      runtime_head: head,
    };
  }
  return { status:'REVERT', runtime_head:head };
}

export function revertRuntimeReconciliation(runtime, reconciliation, { gitEnv } = {}) {
  if (!reconciliation?.mutation_performed) {
    return { status: 'NOT_REQUIRED', runtime_head: reconciliation?.promotion_runtime_sha || null };
  }
  const temp = cloneRuntime(runtime, gitEnv, 'job-search-runtime-revert-');
  try {
    const head = requireSha(run('git', ['rev-parse', 'HEAD'], { cwd: temp, env: gitEnv }).trim(), 'runtime HEAD');
    const decision = compensatingRevertDecision({
      mutationPerformed: reconciliation.mutation_performed,
      currentHead: head,
      promotionRuntimeSha: reconciliation.promotion_runtime_sha,
    });
    if (decision.status === 'DEGRADED') return decision;

    assertExpectedRemoteHead(temp, runtime.runtimeRef, head, gitEnv);
    run('git', [
      '-c', 'user.name=job-search-environment-tool',
      '-c', 'user.email=environment-tool@users.noreply.github.com',
      'revert', '--no-edit', reconciliation.promotion_runtime_sha,
    ], { cwd: temp, env: gitEnv });
    const revertSha = requireSha(run('git', ['rev-parse', 'HEAD'], { cwd: temp, env: gitEnv }).trim(), 'runtime revert commit');
    assertExpectedRemoteHead(temp, runtime.runtimeRef, head, gitEnv);
    run('git', ['push', 'origin', `HEAD:${runtime.runtimeRef}`], { cwd: temp, env: gitEnv });
    return { status: 'REVERTED', runtime_head: revertSha };
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

export function buildReconciliationEvidence(reconciliation, {
  health = null,
  snapshotVerification = 'NOT_RUN',
  functionalVisibility = null,
  acceptance = null,
  revert = null,
} = {}) {
  const evidence = {
    schema_version: RECONCILIATION_SCHEMA_VERSION,
    environment: reconciliation.environment,
    control_plane_sha: reconciliation.control_plane_sha,
    candidate_sha: reconciliation.candidate_sha,
    runtime_head_before: reconciliation.runtime_head_before,
    promotion_runtime_sha: reconciliation.promotion_runtime_sha || null,
    acceptance_runtime_head: acceptance?.acceptance_runtime_head || null,
    allowlist_version: reconciliation.allowlist_version,
    files: reconciliation.files || {},
    reconciliation_result: reconciliation.reconciliation_result,
    validation_result: reconciliation.validation_result,
    failure_stage: reconciliation.failure_stage || null,
    snapshot_verification: snapshotVerification,
    functional_visibility: functionalVisibility || {
      status:'NOT_RUN',
      method:'canonical-protected-runtime-read',
      files:{},
    },
    acceptance_result: acceptance?.status || 'NOT_RUN',
    health: health ? {
      source_sha: health.source_sha,
      runtime_data_sha: health.runtime_data_sha,
    } : null,
    revert_result: revert?.status || 'NOT_REQUIRED',
    migration: reconciliation.migration ? {
      ...reconciliation.migration,
      acceptance_result: acceptance?.status || 'NOT_RUN',
    } : null,
  };
  if (reconciliation.reason) evidence.reason = reconciliation.reason;
  if (acceptance?.reason) evidence.acceptance_reason = acceptance.reason;
  if (revert?.reason) evidence.revert_reason = revert.reason;
  return evidence;
}

export function writeReconciliationEvidence(path, evidence) {
  if (!path) return;
  writeText(resolve(path), `${JSON.stringify(evidence, null, 2)}\n`);
}
