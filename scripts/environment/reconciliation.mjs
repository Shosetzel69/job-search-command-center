import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { CANDIDATE_MANAGED_DATA_FILES } from '../../shared/runtime-data.mjs';
import { assertNomenclatures } from '../../shared/nomenclatures.mjs';
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

function assertCatalogRoot(payload, kind) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error(`${kind} catalog must be an object`);
  }
  if (payload.schema_version !== '1.0') throw new Error(`Unsupported ${kind} schema_version`);
}

function validateCategories(payload) {
  assertCatalogRoot(payload, 'source categories');
  if (!Array.isArray(payload.categories)) throw new Error('source categories must contain categories[]');
  if (payload.count !== payload.categories.length) throw new Error('source categories count mismatch');
  const ids = new Set();
  const labels = new Set();
  for (const category of payload.categories) {
    const id = String(category?.id || '').trim();
    const label = String(category?.label || '').trim();
    if (!id || !label) throw new Error('source category id/label is required');
    if (ids.has(id)) throw new Error(`duplicate source category id: ${id}`);
    const key = categoryKey(label);
    if (labels.has(key)) throw new Error(`duplicate source category label: ${label}`);
    ids.add(id);
    labels.add(key);
  }
  return labels;
}

function validateSources(payload, categoryLabels) {
  assertCatalogRoot(payload, 'sources');
  if (!Array.isArray(payload.sources)) throw new Error('sources catalog must contain sources[]');
  if (payload.count !== payload.sources.length) throw new Error('sources count mismatch');
  const ids = new Set();
  for (const source of payload.sources) {
    const id = String(source?.id || '').trim();
    const name = String(source?.name || '').trim();
    const url = String(source?.url || '').trim();
    const category = String(source?.category || '').trim();
    if (!id || !name || !url || !category) throw new Error('source id/name/url/category is required');
    if (ids.has(id)) throw new Error(`duplicate source id: ${id}`);
    ids.add(id);
    let parsed;
    try { parsed = new URL(url); } catch { throw new Error(`invalid source URL: ${name}`); }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error(`unsupported source URL protocol: ${name}`);
    if (!categoryLabels.has(categoryKey(category))) {
      throw new Error(`source references unknown category: ${name} -> ${category}`);
    }
  }
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

function buildBlockedEvidence({ environment, candidateSha, controlPlaneSha, runtimeHead, files, reason }) {
  return {
    schema_version: RECONCILIATION_SCHEMA_VERSION,
    environment,
    control_plane_sha: controlPlaneSha,
    candidate_sha: candidateSha,
    runtime_head_before: runtimeHead,
    allowlist_version: ALLOWLIST_VERSION,
    files,
    reconciliation_result: 'BLOCKED',
    validation_result: 'NOT_RUN',
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

  validateCandidateManagedSet(candidateContents);
  validateCandidateManagedSet(runtimeContents);

  const candidateDigests = digestSet(candidateContents);
  const runtimeDigests = digestSet(runtimeContents);
  const bootstrap = metadata == null;
  const normalizedMetadata = bootstrap ? null : normalizeReleaseControlMetadata(metadata, environment);
  const baselineDigests = bootstrap
    ? explicitSeedBaseline(runtimeDigests)
    : normalizedMetadata.accepted_baselines;

  const files = {};
  const targetContents = {};
  const nextBaselines = {};
  try {
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
  } catch (error) {
    throw new ReconciliationBlockedError(
      error instanceof Error ? error.message : String(error),
      buildBlockedEvidence({
        environment,
        candidateSha: candidate,
        controlPlaneSha: controlPlane,
        runtimeHead: runtimeBefore,
        files,
        reason: error instanceof Error ? error.message : String(error),
      }),
    );
  }

  validateCandidateManagedSet(targetContents);

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
  now = new Date().toISOString(),
} = {}) {
  const temp = cloneRuntime(runtime, gitEnv, 'job-search-runtime-reconcile-');
  try {
    const runtimeHead = requireSha(run('git', ['rev-parse', 'HEAD'], { cwd: temp, env: gitEnv }).trim(), 'runtime HEAD');
    const plan = planCandidateManagedReconciliation({
      environment: runtime.environment,
      candidateSha: runtime.sourceSha,
      controlPlaneSha,
      runtimeHead,
      candidateContents: candidateManagedContentsFromWorkspace(candidateWorkspace),
      runtimeContents: readManagedContents(temp),
      metadata: readMetadata(temp),
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

    for (const path of CANDIDATE_MANAGED_PATHS) {
      if (plan.files[path].action === 'apply_candidate') writeText(resolve(temp, path), plan.target_contents[path]);
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

export function acceptRuntimeReconciliation(runtime, reconciliation, {
  gitEnv,
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
    if (head !== reconciliation.promotion_runtime_sha) {
      return {
        status: 'DEGRADED',
        reason: `Runtime changed before baseline acceptance: expected ${reconciliation.promotion_runtime_sha}, got ${head}`,
        acceptance_runtime_head: head,
      };
    }
    const metadata = readMetadata(temp);
    if (!metadata?.pending_promotion) throw new Error('Pending release-control metadata is missing');
    if (metadata.schema_version !== RECONCILIATION_SCHEMA_VERSION || metadata.allowlist_version !== ALLOWLIST_VERSION) {
      throw new Error('Unsupported release-control metadata during acceptance');
    }
    const pending = metadata.pending_promotion;
    if (pending.candidate_sha !== reconciliation.candidate_sha
      || pending.control_plane_sha !== reconciliation.control_plane_sha
      || pending.runtime_head_before !== reconciliation.runtime_head_before) {
      throw new Error('Pending promotion identity does not match reconciliation evidence');
    }

    const accepted = {
      schema_version: RECONCILIATION_SCHEMA_VERSION,
      allowlist_version: ALLOWLIST_VERSION,
      environment: runtime.environment,
      accepted_baselines: { ...pending.next_accepted_baselines },
      previous_accepted_promotion: metadata.accepted_promotion || null,
      accepted_promotion: {
        candidate_sha: reconciliation.candidate_sha,
        control_plane_sha: reconciliation.control_plane_sha,
        runtime_data_sha: reconciliation.promotion_runtime_sha,
        accepted_at: now,
      },
      pending_promotion: null,
    };
    writeText(resolve(temp, RELEASE_CONTROL_METADATA_PATH), `${JSON.stringify(accepted, null, 2)}\n`);
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

export function revertRuntimeReconciliation(runtime, reconciliation, { gitEnv } = {}) {
  if (!reconciliation?.mutation_performed) {
    return { status: 'NOT_REQUIRED', runtime_head: reconciliation?.promotion_runtime_sha || null };
  }
  const temp = cloneRuntime(runtime, gitEnv, 'job-search-runtime-revert-');
  try {
    const head = requireSha(run('git', ['rev-parse', 'HEAD'], { cwd: temp, env: gitEnv }).trim(), 'runtime HEAD');
    if (head !== reconciliation.promotion_runtime_sha) {
      return {
        status: 'DEGRADED',
        reason: `Runtime changed after promotion; compensating revert refused: expected ${reconciliation.promotion_runtime_sha}, got ${head}`,
        runtime_head: head,
      };
    }
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
  acceptance = null,
  revert = null,
} = {}) {
  const evidence = {
    schema_version: RECONCILIATION_SCHEMA_VERSION,
    environment: reconciliation.environment,
    control_plane_sha: reconciliation.control_plane_sha,
    candidate_sha: reconciliation.candidate_sha,
    runtime_head_before: reconciliation.runtime_head_before,
    promotion_runtime_sha: reconciliation.promotion_runtime_sha,
    acceptance_runtime_head: acceptance?.acceptance_runtime_head || null,
    allowlist_version: reconciliation.allowlist_version,
    files: reconciliation.files,
    reconciliation_result: reconciliation.reconciliation_result,
    validation_result: reconciliation.validation_result,
    snapshot_verification: snapshotVerification,
    acceptance_result: acceptance?.status || 'NOT_RUN',
    health: health ? {
      source_sha: health.source_sha,
      runtime_data_sha: health.runtime_data_sha,
    } : null,
    revert_result: revert?.status || 'NOT_REQUIRED',
  };
  if (acceptance?.reason) evidence.acceptance_reason = acceptance.reason;
  if (revert?.reason) evidence.revert_reason = revert.reason;
  return evidence;
}

export function writeReconciliationEvidence(path, evidence) {
  if (!path) return;
  writeText(resolve(path), `${JSON.stringify(evidence, null, 2)}\n`);
}
