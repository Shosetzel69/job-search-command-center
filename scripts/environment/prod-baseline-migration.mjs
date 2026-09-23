import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ALLOWLIST_VERSION,
  CANDIDATE_MANAGED_PATHS,
  RECONCILIATION_SCHEMA_VERSION,
  ReconciliationBlockedError,
  planCandidateManagedReconciliation,
  sha256Text,
  validateCandidateManagedSet,
} from './reconciliation.mjs';

const SHA_RE = /^[0-9a-f]{40}$/;
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
export const PROD_BASELINE_MIGRATION_SCHEMA_VERSION = '1.0';

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
  }
  return value;
}

function semanticDigest(text) {
  return sha256Text(JSON.stringify(stableValue(JSON.parse(text))));
}

function sameValue(a, b) {
  return JSON.stringify(stableValue(a)) === JSON.stringify(stableValue(b));
}

function requireSha(value, label) {
  const sha = String(value || '').trim().toLowerCase();
  if (!SHA_RE.test(sha)) throw new Error(`${label} must be a full immutable commit SHA`);
  return sha;
}

function requireDigest(value, label) {
  const digest = String(value || '').trim();
  if (!DIGEST_RE.test(digest)) throw new Error(`${label} must be a sha256 digest`);
  return digest;
}

function digestSet(contents) {
  return Object.fromEntries(CANDIDATE_MANAGED_PATHS.map(path => [path, sha256Text(contents[path])]));
}

function sourceMap(payload) {
  return new Map(payload.sources.map(source => [source.id, source]));
}

function assertExactHistoricalRuntimeDelta(historicalContents, runtimeContents, manifest) {
  for (const path of ['data/source-categories.json', 'data/nomenclatures.json']) {
    if (historicalContents[path] !== runtimeContents[path]) {
      throw new Error(`Unexpected PROD runtime delta outside approved overlay: ${path}`);
    }
  }

  const historical = JSON.parse(historicalContents['data/sources.json']);
  const runtime = JSON.parse(runtimeContents['data/sources.json']);
  const historicalById = sourceMap(historical);
  const runtimeById = sourceMap(runtime);

  if (historicalById.size !== runtimeById.size) {
    throw new Error('Unexpected PROD sources add/remove outside approved Monster overlay');
  }

  for (const [id, historicalSource] of historicalById) {
    const runtimeSource = runtimeById.get(id);
    if (!runtimeSource) throw new Error(`Unexpected PROD source removal: ${id}`);
    if (id === manifest.approved_overlay.source_id) {
      if (!sameValue(historicalSource, manifest.approved_overlay.historical_record)) {
        throw new Error('Historical Monster record does not match approved migration manifest');
      }
      if (!sameValue(runtimeSource, manifest.approved_overlay.runtime_record)) {
        throw new Error('Current PROD Monster overlay does not match approved migration manifest');
      }
      continue;
    }
    if (!sameValue(historicalSource, runtimeSource)) {
      throw new Error(`Unexpected PROD runtime source delta: ${historicalSource.name || id}`);
    }
  }

  for (const id of runtimeById.keys()) {
    if (!historicalById.has(id)) throw new Error(`Unexpected PROD runtime source addition: ${id}`);
  }
}

function resolvedTarget(candidateContents, manifest) {
  const resolved = { ...candidateContents };
  const sources = JSON.parse(candidateContents['data/sources.json']);
  const index = sources.sources.findIndex(source => source.id === manifest.approved_overlay.source_id);
  if (index < 0) throw new Error('Target candidate is missing approved Monster source');
  sources.sources[index] = manifest.approved_overlay.runtime_record;
  if (sources.sources.some(source => source.name === 'NTT RO')) {
    throw new Error('Transient NTT RO record must not be carried into resolved PROD target');
  }
  sources.count = sources.sources.length;
  resolved['data/sources.json'] = `${JSON.stringify(sources, null, 2)}\n`;
  return resolved;
}

function blockedEvidence(input, reason, stage, migration = null) {
  return {
    schema_version: RECONCILIATION_SCHEMA_VERSION,
    environment: input.environment,
    control_plane_sha: String(input.controlPlaneSha || '').toLowerCase(),
    candidate_sha: String(input.candidateSha || '').toLowerCase(),
    runtime_head_before: String(input.runtimeHead || '').toLowerCase(),
    promotion_runtime_sha: null,
    acceptance_runtime_head: null,
    allowlist_version: ALLOWLIST_VERSION,
    files: {},
    reconciliation_result: 'BLOCKED',
    validation_result: stage.includes('validation') ? 'FAIL' : 'NOT_RUN',
    failure_stage: stage,
    functional_visibility: { status:'NOT_RUN', method:'deployed-protected-data', files:{} },
    acceptance_result: 'NOT_RUN',
    revert_result: 'NOT_REQUIRED',
    migration,
    reason,
  };
}

export function validateProdBaselineMigrationManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('Migration manifest must be an object');
  if (manifest.schema_version !== PROD_BASELINE_MIGRATION_SCHEMA_VERSION) throw new Error('Unsupported PROD baseline migration schema_version');
  if (manifest.migration_id !== 'prod-baseline-332-v1') throw new Error('Unsupported PROD baseline migration id');
  if (manifest.migration_version !== '1.0') throw new Error('Unsupported PROD baseline migration version');
  if (manifest.environment !== 'prod') throw new Error('PROD baseline migration environment must be prod');
  if (manifest.single_use !== true) throw new Error('PROD baseline migration must be single-use');
  requireSha(manifest.historical_candidate_sha, 'historical candidate SHA');
  requireSha(manifest.target_candidate_sha, 'target candidate SHA');
  requireSha(manifest.expected_pre_migration_runtime_head, 'expected pre-migration runtime HEAD');
  for (const path of CANDIDATE_MANAGED_PATHS) {
    const item = manifest.files?.[path];
    if (!item) throw new Error(`Migration manifest missing file contract: ${path}`);
    requireDigest(item.historical_digest, `historical digest ${path}`);
    requireDigest(item.target_candidate_digest, `target candidate digest ${path}`);
    requireDigest(item.expected_pre_migration_digest, `pre-migration digest ${path}`);
    requireDigest(item.resolved_target_digest, `resolved target digest ${path}`);
  }
  if (manifest.approved_overlay?.path !== 'data/sources.json'
    || manifest.approved_overlay?.source_id !== 'src-362eebc4'
    || manifest.approved_overlay?.source_name !== 'Monster') {
    throw new Error('Unsupported PROD migration overlay identity');
  }
  return manifest;
}

export function loadProdBaselineMigrationManifest(path) {
  return validateProdBaselineMigrationManifest(JSON.parse(readFileSync(resolve(path), 'utf8')));
}

function sourceReadEnv(token) {
  const env = {};
  for (const key of ['PATH','HOME','USER','SHELL','SYSTEMROOT','WINDIR','COMSPEC','PATHEXT']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return { ...env, GH_TOKEN: token };
}

export function loadHistoricalCandidateManagedContents(runtime, manifest) {
  const env = sourceReadEnv(runtime.sourceReadToken);
  const contents = {};
  for (const path of CANDIDATE_MANAGED_PATHS) {
    const encoded = execFileSync(
      'gh',
      ['api', `repos/${runtime.sourceRepository}/contents/${path}?ref=${manifest.historical_candidate_sha}`, '--jq', '.content'],
      { encoding:'utf8', env, stdio:['ignore','pipe','pipe'] },
    ).replace(/\s+/g, '');
    contents[path] = Buffer.from(encoded, 'base64').toString('utf8');
  }
  return contents;
}

export function planProdBaselineMigration({
  environment,
  candidateSha,
  controlPlaneSha,
  runtimeHead,
  candidateContents,
  runtimeContents,
  metadata,
  historicalContents,
  manifest,
  now = new Date().toISOString(),
}) {
  const input = { environment, candidateSha, controlPlaneSha, runtimeHead };
  let migration = null;
  try {
    validateProdBaselineMigrationManifest(manifest);
    const candidate = requireSha(candidateSha, 'CANDIDATE_SHA');
    const controlPlane = requireSha(controlPlaneSha, 'CONTROL_PLANE_SHA');
    const runtimeBefore = requireSha(runtimeHead, 'runtime HEAD');

    if (environment !== 'prod') throw new Error('One-time baseline migration is PROD-only');
    if (metadata != null) throw new Error('One-time baseline migration requires release-control metadata to be absent');
    if (candidate !== manifest.target_candidate_sha) throw new Error('Candidate SHA does not match approved one-time PROD migration target');

    validateCandidateManagedSet(historicalContents);
    validateCandidateManagedSet(candidateContents);
    validateCandidateManagedSet(runtimeContents);

    const historicalDigests = digestSet(historicalContents);
    const candidateDigests = digestSet(candidateContents);
    const runtimeDigests = digestSet(runtimeContents);

    for (const path of CANDIDATE_MANAGED_PATHS) {
      if (historicalDigests[path] !== manifest.files[path].historical_digest) {
        throw new Error(`Historical candidate digest mismatch: ${path}`);
      }
      if (candidateDigests[path] !== manifest.files[path].target_candidate_digest) {
        throw new Error(`Target candidate digest mismatch: ${path}`);
      }
      if (runtimeDigests[path] !== manifest.files[path].expected_pre_migration_digest) {
        throw new Error(`PROD pre-migration digest mismatch: ${path}`);
      }
    }

    assertExactHistoricalRuntimeDelta(historicalContents, runtimeContents, manifest);

    const targetContents = resolvedTarget(candidateContents, manifest);
    validateCandidateManagedSet(targetContents);
    const targetDigests = digestSet(targetContents);
    for (const path of CANDIDATE_MANAGED_PATHS) {
      if (targetDigests[path] !== manifest.files[path].resolved_target_digest) {
        throw new Error(`Resolved PROD target digest mismatch: ${path}`);
      }
    }

    const files = {};
    for (const path of CANDIDATE_MANAGED_PATHS) {
      files[path] = {
        baseline_digest: historicalDigests[path],
        candidate_digest: candidateDigests[path],
        runtime_before_digest: runtimeDigests[path],
        action: targetDigests[path] === runtimeDigests[path] ? 'migration_noop_target' : 'migration_apply_resolved',
        runtime_after_digest: targetDigests[path],
        next_baseline_digest: candidateDigests[path],
        functional_expected_digest: semanticDigest(targetContents[path]),
      };
    }

    migration = {
      schema_version: manifest.schema_version,
      migration_id: manifest.migration_id,
      migration_version: manifest.migration_version,
      path: 'one_time_prod_baseline_migration',
      historical_candidate_sha: manifest.historical_candidate_sha,
      target_candidate_sha: manifest.target_candidate_sha,
      historical_digests: historicalDigests,
      pre_migration_digests: runtimeDigests,
      approved_overlay: {
        path: manifest.approved_overlay.path,
        source_id: manifest.approved_overlay.source_id,
        source_name: manifest.approved_overlay.source_name,
      },
      resolved_target_digests: targetDigests,
      result: 'PASS',
    };

    return {
      schema_version: RECONCILIATION_SCHEMA_VERSION,
      environment,
      control_plane_sha: controlPlane,
      candidate_sha: candidate,
      runtime_head_before: runtimeBefore,
      allowlist_version: ALLOWLIST_VERSION,
      bootstrap: false,
      migration,
      files,
      reconciliation_result: 'PASS',
      validation_result: 'PASS',
      target_contents: targetContents,
      requires_mutation: true,
      requires_acceptance: true,
      pending_metadata: {
        schema_version: RECONCILIATION_SCHEMA_VERSION,
        allowlist_version: ALLOWLIST_VERSION,
        environment,
        accepted_baselines: { ...historicalDigests },
        accepted_promotion: null,
        previous_accepted_promotion: null,
        pending_promotion: {
          candidate_sha: candidate,
          control_plane_sha: controlPlane,
          runtime_head_before: runtimeBefore,
          started_at: now,
          next_accepted_baselines: { ...candidateDigests },
          files,
          migration: {
            migration_id: manifest.migration_id,
            migration_version: manifest.migration_version,
            historical_candidate_sha: manifest.historical_candidate_sha,
          },
        },
      },
    };
  } catch (error) {
    if (error instanceof ReconciliationBlockedError) throw error;
    const reason = error instanceof Error ? error.message : String(error);
    throw new ReconciliationBlockedError(reason, blockedEvidence(input, reason, 'migration_validation', migration));
  }
}

export function createProdMigrationAwarePlanner({ manifest, historicalContents }) {
  validateProdBaselineMigrationManifest(manifest);
  return input => {
    if (input.metadata != null) return planCandidateManagedReconciliation(input);
    return planProdBaselineMigration({ ...input, historicalContents, manifest });
  };
}
