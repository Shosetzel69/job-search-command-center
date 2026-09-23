import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, resolve } from 'node:path';
import { runtimeDataFiles } from './plans.mjs';
import { serializeSeed, shouldRefreshPristineSeed } from './seed.mjs';
import { SHA_RE, redact } from './contract.mjs';
import { assertPreCutoverLiveGate, verifyLocalSourceSha } from './live.mjs';
import {
  acceptRuntimeReconciliation,
  buildReconciliationEvidence,
  FunctionalVisibilityError,
  reconcileRuntimeRepository,
  ReconciliationBlockedError,
  revertRuntimeReconciliation,
  verifyProtectedFunctionalVisibility,
  verifyRuntimePromotionSnapshot,
  writeReconciliationEvidence,
} from './reconciliation.mjs';

const HEALTH_PROPAGATION_ATTEMPTS = 10;
const HEALTH_PROPAGATION_DELAY_MS = 3000;

function envLabel(runtime) {
  return String(runtime.environment || 'unknown').toUpperCase();
}

function sourceWorkspace() {
  return resolve(String(process.env.SOURCE_WORKSPACE || process.cwd()));
}

function safeChildEnv(extra = {}) {
  const allow = [
    'PATH', 'HOME', 'USER', 'SHELL', 'CI', 'GITHUB_ACTIONS', 'RUNNER_TEMP', 'RUNNER_TOOL_CACHE',
    'RUNNER_OS', 'TMPDIR', 'TEMP', 'TMP', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT',
    'NODE_OPTIONS', 'NPM_CONFIG_CACHE',
  ];
  const env = {};
  for (const key of allow) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return { ...env, ...extra };
}

function githubBootstrapEnv(runtime, extra = {}) {
  return safeChildEnv({ GH_TOKEN: runtime.githubBootstrapToken, ...extra });
}

function githubRuntimeEnv(runtime, extra = {}) {
  return safeChildEnv({ GH_TOKEN: runtime.githubRuntimeToken, ...extra });
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd || process.cwd(),
    env: options.env || safeChildEnv(),
    encoding: 'utf8',
    input: options.input,
    stdio: [options.input == null ? 'ignore' : 'pipe', 'pipe', 'pipe'],
  });
}

function json(command, args, options) {
  return JSON.parse(run(command, args, options));
}

function sleep(ms) {
  return new Promise(resolvePromise => setTimeout(resolvePromise, ms));
}

function ensureRuntimeRepository(runtime) {
  const ghEnv = githubBootstrapEnv(runtime);
  try {
    const repo = json('gh', ['repo', 'view', runtime.runtimeRepository, '--json', 'nameWithOwner,isPrivate'], { env: ghEnv });
    if (!repo.isPrivate) throw new Error(`${runtime.runtimeRepository} must be private`);
    return false;
  } catch (error) {
    const stderr = String(error?.stderr || '');
    if (!/not found|could not resolve|HTTP 404/i.test(stderr)) throw error;
    run('gh', [
      'repo', 'create', runtime.runtimeRepository,
      '--private',
      '--description', `Isolated ${envLabel(runtime)} runtime for Job Search Command Center`,
      '--add-readme',
    ], { env: ghEnv });
    return true;
  }
}

function shouldWriteSeed(target, file, runtime) {
  if (!existsSync(target)) return true;
  try {
    const payload = JSON.parse(readFileSync(target, 'utf8'));
    return shouldRefreshPristineSeed(file, payload, {
      environment: runtime.environment,
      searchMode: runtime.searchMode,
    });
  } catch {
    return false;
  }
}

function syncRuntimeFiles(runtime) {
  const temp = mkdtempSync(resolve(tmpdir(), 'job-search-runtime-bootstrap-'));
  const ghEnv = githubBootstrapEnv(runtime);
  try {
    run('gh', ['auth', 'setup-git'], { env: ghEnv });
    run('gh', ['repo', 'clone', runtime.runtimeRepository, temp, '--', '--depth=1'], { env: ghEnv });
    const now = new Date().toISOString();
    for (const dataPath of runtimeDataFiles()) {
      const target = resolve(temp, dataPath);
      const file = basename(dataPath);
      if (!shouldWriteSeed(target, file, runtime)) continue;
      mkdirSync(resolve(target, '..'), { recursive: true });
      writeFileSync(target, serializeSeed(file, {
        sourceSha: runtime.sourceSha,
        generatedAt: now,
        environment: runtime.environment,
        searchMode: runtime.searchMode,
      }), 'utf8');
    }

    const workflow = resolve(temp, '.github', 'workflows', runtime.workflow);
    mkdirSync(resolve(workflow, '..'), { recursive: true });
    cpSync(resolve(process.cwd(), 'config/runtime-template/runtime.yml'), workflow);

    run('git', ['add', '.'], { cwd: temp, env: ghEnv });
    if (run('git', ['status', '--porcelain'], { cwd: temp, env: ghEnv }).trim()) {
      run('git', [
        '-c', 'user.name=job-search-environment-tool',
        '-c', 'user.email=environment-tool@users.noreply.github.com',
        'commit', '-m', `[BOOTSTRAP] Initialize isolated ${envLabel(runtime)} runtime`,
      ], { cwd: temp, env: ghEnv });
      run('git', ['push', 'origin', 'HEAD:main'], { cwd: temp, env: ghEnv });
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

function configureRuntimeVariables(runtime) {
  const ghEnv = githubBootstrapEnv(runtime);
  run('gh', ['variable', 'set', 'APP_ENV', '--repo', runtime.runtimeRepository, '--body', runtime.environment], { env: ghEnv });
  run('gh', ['variable', 'set', 'SEARCH_MODE', '--repo', runtime.runtimeRepository, '--body', runtime.searchMode], { env: ghEnv });
  run('gh', ['variable', 'set', 'SOURCE_REPOSITORY', '--repo', runtime.runtimeRepository, '--body', runtime.sourceRepository], { env: ghEnv });
}

function configureBootstrapRuntimeSecrets(runtime) {
  if (runtime.githubBootstrapToken === runtime.githubRuntimeToken) {
    throw new Error('GitHub bootstrap and runtime credentials must be distinct');
  }
  if (runtime.githubRuntimeToken === runtime.sourceReadToken) {
    throw new Error('GitHub runtime and source-read credentials must be distinct');
  }
  if (runtime.githubBootstrapToken === runtime.sourceReadToken) {
    throw new Error('GitHub bootstrap and source-read credentials must be distinct');
  }

  run(
    'gh',
    ['secret', 'set', 'SOURCE_READ_TOKEN', '--repo', runtime.runtimeRepository],
    { env: githubBootstrapEnv(runtime), input: runtime.sourceReadToken },
  );

  const cloudflareEnv = safeChildEnv({
    CLOUDFLARE_ACCOUNT_ID: runtime.cloudflareAccountId,
    CLOUDFLARE_API_TOKEN: runtime.cloudflareToken,
    WRANGLER_SEND_METRICS: 'false',
  });
  const cwd = resolve(sourceWorkspace(), 'command-api');
  run('npx', ['wrangler', 'secret', 'put', 'GITHUB_TOKEN', '--name', runtime.workerName], {
    cwd,
    env: cloudflareEnv,
    input: runtime.githubRuntimeToken,
  });
  run('npx', ['wrangler', 'secret', 'put', 'ALLOWED_GOOGLE_SUB', '--name', runtime.workerName], {
    cwd,
    env: cloudflareEnv,
    input: runtime.allowedGoogleSub,
  });
}

function runtimeSnapshot(runtime) {
  const temp = mkdtempSync(resolve(tmpdir(), 'job-search-runtime-snapshot-'));
  const ghEnv = githubRuntimeEnv(runtime);
  run('gh', ['auth', 'setup-git'], { env: ghEnv });
  run('gh', ['repo', 'clone', runtime.runtimeRepository, temp, '--', '--depth=1', '--branch', runtime.runtimeRef], { env: ghEnv });
  const sha = run('git', ['rev-parse', 'HEAD'], { cwd: temp, env: ghEnv }).trim().toLowerCase();
  if (!SHA_RE.test(sha)) throw new Error('Could not resolve immutable RUNTIME_DATA_SHA');
  return { temp, dataDir: resolve(temp, 'data'), sha };
}

function verifyDeploymentWorkspaceSource(sourceSha) {
  const workspace = sourceWorkspace();
  const attestationPath = resolve(workspace, '.candidate-source-sha');
  if (!existsSync(attestationPath)) {
    verifyLocalSourceSha(sourceSha, workspace);
    return false;
  }
  const attested = readFileSync(attestationPath, 'utf8').trim().toLowerCase();
  if (!SHA_RE.test(attested) || attested !== String(sourceSha).toLowerCase()) {
    throw new Error('Prepared deployment payload does not match immutable SOURCE_SHA');
  }
  return true;
}

function wrangler(runtime, args, env = {}) {
  return run('npx', ['wrangler', ...args], {
    cwd: resolve(sourceWorkspace(), 'command-api'),
    env: safeChildEnv({
      CLOUDFLARE_ACCOUNT_ID: runtime.cloudflareAccountId,
      CLOUDFLARE_API_TOKEN: runtime.cloudflareToken,
      WRANGLER_SEND_METRICS: 'false',
      ...env,
    }),
  });
}

function workerVars(runtime) {
  const [owner, repo] = runtime.runtimeRepository.split('/');
  return {
    APP_ENV: runtime.environment,
    FRONTEND_ORIGIN: runtime.frontendOrigin,
    GOOGLE_CLIENT_ID: runtime.googleClientId,
    GITHUB_RUNTIME_OWNER: owner,
    GITHUB_RUNTIME_REPO: repo,
    GITHUB_RUNTIME_REF: runtime.runtimeRef,
    GITHUB_WORKFLOW: runtime.workflow,
    SEARCH_MODE: runtime.searchMode,
    SEARCH_CONFIG_PATH: 'data/search-config.json',
    SOURCES_PATH: 'data/sources.json',
    SOURCE_CATEGORIES_PATH: 'data/source-categories.json',
    NOMENCLATURES_PATH: 'data/nomenclatures.json',
    APPLICATIONS_PATH: 'data/applications.json',
  };
}

function deployWorker(runtime) {
  const trustedPayloadBuild = verifyDeploymentWorkspaceSource(runtime.sourceSha);
  const snapshot = runtimeSnapshot(runtime);
  try {
    const env = {
      SOURCE_SHA: runtime.sourceSha,
      RUNTIME_DATA_SHA: snapshot.sha,
      RUNTIME_DATA_DIR: snapshot.dataDir,
      APP_ENV: runtime.environment,
      TRUSTED_PAYLOAD_BUILD: trustedPayloadBuild ? '1' : '0',
    };
    const vars = Object.entries(workerVars(runtime)).flatMap(([key, value]) => ['--var', `${key}:${value}`]);
    wrangler(runtime, ['deploy', '--name', runtime.workerName, ...vars], env);
    return snapshot.sha;
  } finally {
    rmSync(snapshot.temp, { recursive: true, force: true });
  }
}

async function probeHealthOnce(runtime, expectedRuntimeDataSha = null) {
  const label = envLabel(runtime);
  const response = await fetch(new URL('/health', runtime.frontendOrigin), { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`${label} /health failed (${response.status})`);
  const payload = await response.json();
  const expected = {
    environment: runtime.environment,
    source_sha: runtime.sourceSha,
    runtime_repo: runtime.runtimeRepository,
    search_mode: runtime.searchMode,
  };
  if (expectedRuntimeDataSha) expected.runtime_data_sha = expectedRuntimeDataSha;
  for (const [key, value] of Object.entries(expected)) {
    if (payload[key] !== value) throw new Error(`${label} health mismatch for ${key}: expected ${value}, got ${payload[key]}`);
  }
  if (!SHA_RE.test(String(payload.runtime_data_sha || ''))) throw new Error(`${label} /health runtime_data_sha is invalid`);
  return payload;
}

async function probeHealth(runtime, { attempts = 1, delayMs = 0, expectedRuntimeDataSha = null } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await probeHealthOnce(runtime, expectedRuntimeDataSha);
    } catch (error) {
      lastError = error;
      if (attempt === attempts) throw error;
      await sleep(delayMs);
    }
  }
  throw lastError;
}

async function probeDeployedHealth(runtime, runtimeDataSha) {
  return probeHealth(runtime, {
    attempts: HEALTH_PROPAGATION_ATTEMPTS,
    delayMs: HEALTH_PROPAGATION_DELAY_MS,
    expectedRuntimeDataSha: runtimeDataSha,
  });
}

function requiredLiveReconciliationInputs() {
  const controlPlaneSha = String(process.env.CONTROL_PLANE_SHA || '').trim().toLowerCase();
  if (!SHA_RE.test(controlPlaneSha)) throw new Error('CONTROL_PLANE_SHA must be a full immutable commit SHA');
  const candidateWorkspace = String(process.env.CANDIDATE_DATA_WORKSPACE || '').trim();
  if (!candidateWorkspace) throw new Error('CANDIDATE_DATA_WORKSPACE is required for live deployment');
  const functionalGoogleIdToken = String(process.env.FUNCTIONAL_GOOGLE_ID_TOKEN || '').trim();
  if (!functionalGoogleIdToken) throw new Error('FUNCTIONAL_GOOGLE_ID_TOKEN is required for deployed protected functional verification');
  return {
    controlPlaneSha,
    candidateWorkspace,
    functionalGoogleIdToken,
    evidencePath: String(process.env.RECONCILIATION_EVIDENCE_PATH || '').trim() || null,
  };
}

async function deployCandidateWithReconciliation(runtime, { configureBootstrapSecrets = false } = {}) {
  const inputs = requiredLiveReconciliationInputs();
  const gitEnv = githubRuntimeEnv(runtime);
  let reconciliation;

  try {
    reconciliation = reconcileRuntimeRepository(runtime, {
      candidateWorkspace: inputs.candidateWorkspace,
      controlPlaneSha: inputs.controlPlaneSha,
      gitEnv,
    });
  } catch (error) {
    if (error instanceof ReconciliationBlockedError && error.evidence) {
      writeReconciliationEvidence(inputs.evidencePath, error.evidence);
    }
    throw error;
  }

  let health = null;
  let snapshotVerification = 'NOT_RUN';
  let functionalVisibility = null;
  let acceptance = null;
  let revert = null;

  try {
    const runtimeDataSha = deployWorker(runtime);
    if (runtimeDataSha !== reconciliation.promotion_runtime_sha) {
      throw new Error(`Runtime snapshot identity mismatch: expected ${reconciliation.promotion_runtime_sha}, got ${runtimeDataSha}`);
    }
    if (configureBootstrapSecrets) configureBootstrapRuntimeSecrets(runtime);
    health = await probeDeployedHealth(runtime, runtimeDataSha);
    try {
      snapshotVerification = verifyRuntimePromotionSnapshot(runtime, reconciliation, { gitEnv });
    } catch (error) {
      snapshotVerification = 'FAIL';
      throw error;
    }
    functionalVisibility = await verifyProtectedFunctionalVisibility(runtime, reconciliation, {
      googleIdToken: inputs.functionalGoogleIdToken,
    });
    acceptance = acceptRuntimeReconciliation(runtime, reconciliation, {
      gitEnv,
      snapshotVerification,
      functionalVisibility,
    });
    if (acceptance.status === 'DEGRADED') throw new Error(acceptance.reason || 'Baseline acceptance is degraded');

    const evidence = buildReconciliationEvidence(reconciliation, {
      health,
      snapshotVerification,
      functionalVisibility,
      acceptance,
      revert,
    });
    writeReconciliationEvidence(inputs.evidencePath, evidence);
    return { runtimeDataSha, health, reconciliation: evidence };
  } catch (error) {
    if (error instanceof FunctionalVisibilityError && error.proof) {
      functionalVisibility = error.proof;
    }
    if (acceptance?.status !== 'ACCEPTED') {
      try {
        revert = revertRuntimeReconciliation(runtime, reconciliation, { gitEnv });
      } catch (revertError) {
        revert = {
          status: 'DEGRADED',
          reason: `Compensating revert failed: ${revertError instanceof Error ? revertError.message : String(revertError)}`,
        };
      }
    } else {
      revert = { status: 'NOT_PERMITTED_AFTER_ACCEPTANCE' };
    }

    const evidence = buildReconciliationEvidence(reconciliation, {
      health,
      snapshotVerification,
      functionalVisibility,
      acceptance,
      revert,
    });
    try { writeReconciliationEvidence(inputs.evidencePath, evidence); } catch {}
    const suffix = revert?.status === 'DEGRADED' ? ` Runtime is DEGRADED/BLOCKED: ${revert.reason || 'concurrent mutation'}` : '';
    throw new Error(`${error instanceof Error ? error.message : String(error)}.${suffix}`);
  }
}

export async function provisionEnvironment(runtime) {
  assertPreCutoverLiveGate(runtime.environment, false);
  const created = ensureRuntimeRepository(runtime);
  syncRuntimeFiles(runtime);
  configureRuntimeVariables(runtime);
  const deployment = await deployCandidateWithReconciliation(runtime, { configureBootstrapSecrets: true });
  return {
    status: 'PASS',
    action: 'bootstrap',
    environment: runtime.environment,
    source_sha: runtime.sourceSha,
    runtime_data_sha: deployment.runtimeDataSha,
    runtime_repo: runtime.runtimeRepository,
    runtime_repo_created: created,
    cloudflare_account: redact(runtime.cloudflareAccountId),
    frontend_origin: runtime.frontendOrigin,
    health: deployment.health,
    reconciliation: deployment.reconciliation,
  };
}

export async function deployEnvironment(runtime) {
  assertPreCutoverLiveGate(runtime.environment, false);
  const deployment = await deployCandidateWithReconciliation(runtime);
  return {
    status: 'PASS',
    action: 'deploy',
    environment: runtime.environment,
    source_sha: runtime.sourceSha,
    runtime_data_sha: deployment.runtimeDataSha,
    runtime_repo: runtime.runtimeRepository,
    cloudflare_account: redact(runtime.cloudflareAccountId),
    frontend_origin: runtime.frontendOrigin,
    health: deployment.health,
    reconciliation: deployment.reconciliation,
  };
}

export async function statusEnvironment(runtime) {
  assertPreCutoverLiveGate(runtime.environment, false);
  return probeHealth(runtime);
}
