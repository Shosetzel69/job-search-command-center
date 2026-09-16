import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CANONICAL_RUNTIME_REPOSITORIES, requireSourceSha, validateManifest } from './contract.mjs';

function loadJson(path, cwd = process.cwd()) {
  return JSON.parse(readFileSync(resolve(cwd, path), 'utf8'));
}

function legacyRuntimeRepository(wrangler) {
  const owner = String(wrangler?.vars?.GITHUB_RUNTIME_OWNER || '').trim();
  const repo = String(wrangler?.vars?.GITHUB_RUNTIME_REPO || '').trim();
  if (!owner || !repo) throw new Error('Current PROD wrangler config is missing runtime repository identity');
  return `${owner}/${repo}`;
}

export function buildProdPreparationReport({ manifest, wrangler, sourceSha }) {
  validateManifest(manifest);
  const sha = requireSourceSha(sourceSha);
  const current = {
    worker_name: String(wrangler?.name || '').trim(),
    environment: String(wrangler?.vars?.APP_ENV || '').trim(),
    frontend_origin: String(wrangler?.vars?.FRONTEND_ORIGIN || '').trim(),
    runtime_repository: legacyRuntimeRepository(wrangler),
    runtime_ref: String(wrangler?.vars?.GITHUB_RUNTIME_REF || '').trim(),
    workflow: String(wrangler?.vars?.GITHUB_WORKFLOW || '').trim(),
    search_mode: String(wrangler?.vars?.SEARCH_MODE || '').trim(),
  };
  const targetCfg = manifest.environments.prod;
  const target = {
    worker_name: targetCfg.worker_name,
    runtime_repository: targetCfg.runtime_repository,
    runtime_ref: targetCfg.runtime_ref,
    workflow: targetCfg.workflow,
    search_mode: targetCfg.search_mode,
    cloudflare_account_id_env: targetCfg.cloudflare_account_id_env,
    cloudflare_token_env: targetCfg.cloudflare_token_env,
    github_runtime_token_env: targetCfg.github_runtime_token_env,
    source_read_token_env: targetCfg.source_read_token_env,
    allowed_google_sub_env: targetCfg.allowed_google_sub_env,
    google_client_id_env: targetCfg.google_client_id_env,
    frontend_origin_env: targetCfg.frontend_origin_env,
  };

  const forbiddenRuntimeRepositories = new Set([
    manifest.source_repository,
    manifest.environments.dev.runtime_repository,
    manifest.environments.test.runtime_repository,
  ]);

  const checks = [
    ['current-prod-environment', current.environment === 'prod'],
    ['current-prod-search-mode', current.search_mode === 'live'],
    ['current-prod-origin-https', current.frontend_origin.startsWith('https://')],
    ['target-prod-runtime-isolated', !forbiddenRuntimeRepositories.has(target.runtime_repository)],
    ['target-prod-runtime-canonical', target.runtime_repository === CANONICAL_RUNTIME_REPOSITORIES.prod],
    ['target-prod-search-mode-live', target.search_mode === 'live'],
    ['target-prod-runtime-ref-main', target.runtime_ref === 'main'],
    ['target-prod-workflow-runtime', target.workflow === 'runtime.yml'],
    ['target-worker-name-defined', Boolean(target.worker_name)],
  ].map(([id, pass]) => ({ id, result: pass ? 'PASS' : 'FAIL' }));

  if (checks.some(check => check.result !== 'PASS')) {
    throw new Error(`PROD preparation preflight failed: ${checks.filter(check => check.result !== 'PASS').map(check => check.id).join(', ')}`);
  }

  return {
    status: 'PASS',
    phase: 6,
    mode: 'non-mutating-prod-preparation',
    source_sha: sha,
    live_prod_mutation_authorized: false,
    phase7_cutover_authorized: false,
    migration_required: current.runtime_repository !== target.runtime_repository || current.workflow !== target.workflow,
    current_prod: current,
    target_prod: target,
    backup_anchor: {
      source_repository: manifest.source_repository,
      source_sha: sha,
      requirement: 'Capture a fresh immutable PROD runtime-data snapshot immediately before Phase 7 cutover.',
    },
    checks,
  };
}

export function prodPreparationReport({
  manifestPath = 'config/environments.json',
  wranglerPath = 'command-api/wrangler.jsonc',
  sourceSha,
  cwd = process.cwd(),
} = {}) {
  const manifest = loadJson(manifestPath, cwd);
  const wrangler = loadJson(wranglerPath, cwd);
  return buildProdPreparationReport({ manifest, wrangler, sourceSha });
}
