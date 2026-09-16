import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, resolve } from 'node:path';
import { runtimeDataFiles } from './plans.mjs';
import { serializeSeed, shouldRefreshPristineSeed } from './seed.mjs';
import { SHA_RE, redact } from './contract.mjs';
import { assertPreCutoverLiveGate, verifyLocalSourceSha } from './live.mjs';

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

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd || process.cwd(),
    env: options.env || safeChildEnv(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
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

function runtimeSnapshot(runtime) {
  const temp = mkdtempSync(resolve(tmpdir(), 'job-search-runtime-snapshot-'));
  const ghEnv = githubBootstrapEnv(runtime);
  run('gh', ['auth', 'setup-git'], { env: ghEnv });
  run('gh', ['repo', 'clone', runtime.runtimeRepository, temp, '--', '--depth=1', '--branch', runtime.runtimeRef], { env: ghEnv });
  const sha = run('git', ['rev-parse', 'HEAD'], { cwd: temp, env: ghEnv }).trim().toLowerCase();
  if (!SHA_RE.test(sha)) throw new Error('Could not resolve immutable RUNTIME_DATA_SHA');
  return { temp, dataDir: resolve(temp, 'data'), sha };
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
  verifyLocalSourceSha(runtime.sourceSha, sourceWorkspace());
  const snapshot = runtimeSnapshot(runtime);
  try {
    const env = {
      SOURCE_SHA: runtime.sourceSha,
      RUNTIME_DATA_SHA: snapshot.sha,
      RUNTIME_DATA_DIR: snapshot.dataDir,
      APP_ENV: runtime.environment,
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

export async function provisionEnvironment(runtime) {
  assertPreCutoverLiveGate(runtime.environment, false);
  const created = ensureRuntimeRepository(runtime);
  syncRuntimeFiles(runtime);
  configureRuntimeVariables(runtime);
  const runtimeDataSha = deployWorker(runtime);
  const health = await probeDeployedHealth(runtime, runtimeDataSha);
  return {
    status: 'PASS',
    action: 'bootstrap',
    environment: runtime.environment,
    source_sha: runtime.sourceSha,
    runtime_data_sha: runtimeDataSha,
    runtime_repo: runtime.runtimeRepository,
    runtime_repo_created: created,
    cloudflare_account: redact(runtime.cloudflareAccountId),
    frontend_origin: runtime.frontendOrigin,
    health,
  };
}

export async function deployEnvironment(runtime) {
  assertPreCutoverLiveGate(runtime.environment, false);
  const runtimeDataSha = deployWorker(runtime);
  const health = await probeDeployedHealth(runtime, runtimeDataSha);
  return {
    status: 'PASS',
    action: 'deploy',
    environment: runtime.environment,
    source_sha: runtime.sourceSha,
    runtime_data_sha: runtimeDataSha,
    runtime_repo: runtime.runtimeRepository,
    cloudflare_account: redact(runtime.cloudflareAccountId),
    frontend_origin: runtime.frontendOrigin,
    health,
  };
}

export async function statusEnvironment(runtime) {
  assertPreCutoverLiveGate(runtime.environment, false);
  return probeHealth(runtime);
}
