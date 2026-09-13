import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, resolve } from 'node:path';
import { runtimeDataFiles } from './plans.mjs';
import { serializeSeed } from './seed.mjs';
import { SHA_RE, redact } from './contract.mjs';
import { assertPhase4LiveGate, verifyLocalSourceSha } from './live.mjs';

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd || process.cwd(),
    env: options.env || process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function json(command, args, options) {
  return JSON.parse(run(command, args, options));
}

function ensureRuntimeRepository(runtime) {
  try {
    const repo = json('gh', ['repo', 'view', runtime.runtimeRepository, '--json', 'nameWithOwner,isPrivate']);
    if (!repo.isPrivate) throw new Error(`${runtime.runtimeRepository} must be private`);
    return false;
  } catch (error) {
    const stderr = String(error?.stderr || '');
    if (!/not found|could not resolve|HTTP 404/i.test(stderr)) throw error;
    run('gh', ['repo', 'create', runtime.runtimeRepository, '--private', '--description', 'Isolated DEV runtime for Job Search Command Center', '--add-readme']);
    return true;
  }
}

function syncRuntimeFiles(runtime) {
  const temp = mkdtempSync(resolve(tmpdir(), 'job-search-runtime-bootstrap-'));
  try {
    run('gh', ['auth', 'setup-git']);
    run('gh', ['repo', 'clone', runtime.runtimeRepository, temp, '--', '--depth=1']);
    const now = new Date().toISOString();
    for (const dataPath of runtimeDataFiles()) {
      const target = resolve(temp, dataPath);
      if (existsSync(target)) continue;
      mkdirSync(resolve(target, '..'), { recursive: true });
      writeFileSync(target, serializeSeed(basename(dataPath), { sourceSha: runtime.sourceSha, generatedAt: now }), 'utf8');
    }

    const workflow = resolve(temp, '.github', 'workflows', runtime.workflow);
    mkdirSync(resolve(workflow, '..'), { recursive: true });
    cpSync(resolve(process.cwd(), 'config/runtime-template/runtime.yml'), workflow);

    run('git', ['add', '.'], { cwd: temp });
    if (run('git', ['status', '--porcelain'], { cwd: temp }).trim()) {
      run('git', ['-c', 'user.name=job-search-environment-tool', '-c', 'user.email=environment-tool@users.noreply.github.com', 'commit', '-m', '[BOOTSTRAP] Initialize isolated DEV runtime'], { cwd: temp });
      run('git', ['push', 'origin', 'HEAD:main'], { cwd: temp });
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

function configureRuntimeVariables(runtime) {
  run('gh', ['variable', 'set', 'APP_ENV', '--repo', runtime.runtimeRepository, '--body', runtime.environment]);
  run('gh', ['variable', 'set', 'SEARCH_MODE', '--repo', runtime.runtimeRepository, '--body', runtime.searchMode]);
  run('gh', ['variable', 'set', 'SOURCE_REPOSITORY', '--repo', runtime.runtimeRepository, '--body', runtime.sourceRepository]);
}

function runtimeSnapshot(runtime) {
  const temp = mkdtempSync(resolve(tmpdir(), 'job-search-runtime-snapshot-'));
  run('gh', ['auth', 'setup-git']);
  run('gh', ['repo', 'clone', runtime.runtimeRepository, temp, '--', '--depth=1', '--branch', runtime.runtimeRef]);
  const sha = run('git', ['rev-parse', 'HEAD'], { cwd: temp }).trim().toLowerCase();
  if (!SHA_RE.test(sha)) throw new Error('Could not resolve immutable RUNTIME_DATA_SHA');
  return { temp, dataDir: resolve(temp, 'data'), sha };
}

function wrangler(runtime, args, env = {}) {
  return run('npx', ['wrangler', ...args], {
    cwd: resolve(process.cwd(), 'command-api'),
    env: {
      ...process.env,
      CLOUDFLARE_ACCOUNT_ID: runtime.cloudflareAccountId,
      WRANGLER_SEND_METRICS: 'false',
      ...env,
    },
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
  verifyLocalSourceSha(runtime.sourceSha);
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

async function probeHealth(runtime) {
  const response = await fetch(new URL('/health', runtime.frontendOrigin), { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`DEV /health failed (${response.status})`);
  const payload = await response.json();
  const expected = {
    environment: runtime.environment,
    source_sha: runtime.sourceSha,
    runtime_repo: runtime.runtimeRepository,
    search_mode: runtime.searchMode,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (payload[key] !== value) throw new Error(`DEV health mismatch for ${key}: expected ${value}, got ${payload[key]}`);
  }
  if (!SHA_RE.test(String(payload.runtime_data_sha || ''))) throw new Error('DEV /health runtime_data_sha is invalid');
  return payload;
}

export async function provisionDev(runtime) {
  assertPhase4LiveGate(runtime.environment, false);
  const created = ensureRuntimeRepository(runtime);
  syncRuntimeFiles(runtime);
  configureRuntimeVariables(runtime);
  const runtimeDataSha = deployWorker(runtime);
  const health = await probeHealth(runtime);
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

export async function deployDev(runtime) {
  assertPhase4LiveGate(runtime.environment, false);
  const runtimeDataSha = deployWorker(runtime);
  const health = await probeHealth(runtime);
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

export async function statusDev(runtime) {
  assertPhase4LiveGate(runtime.environment, false);
  return probeHealth(runtime);
}
