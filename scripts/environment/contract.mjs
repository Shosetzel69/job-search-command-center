import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const ENVIRONMENTS = Object.freeze(['dev', 'test', 'prod']);
export const SHA_RE = /^[0-9a-f]{40}$/i;
export const ACCOUNT_RE = /^[0-9a-f]{32}$/i;
export const CANONICAL_RUNTIME_REPOSITORIES = Object.freeze({
  dev: 'Shosetzel69/job-search-runtime-dev',
  test: 'Shosetzel69/job-search-runtime-test',
  prod: 'Shosetzel69/job-search-prod',
});
const PLACEHOLDER_RE = /<[^>]+>|#{5,}|\b(?:TODO|TBD|PLACEHOLDER)\b/i;

export function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith('--')) {
      args._.push(item);
      continue;
    }
    const key = item.slice(2).replaceAll('-', '_');
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

export function loadManifest(path = 'config/environments.json', cwd = process.cwd()) {
  const fullPath = resolve(cwd, path);
  const payload = JSON.parse(readFileSync(fullPath, 'utf8'));
  validateManifest(payload);
  return payload;
}

export function validateManifest(manifest) {
  if (manifest?.schema_version !== '1.0') throw new Error('Environment manifest schema_version must be 1.0');
  if (!/^[^/\s]+\/[^/\s]+$/.test(String(manifest.source_repository || ''))) {
    throw new Error('source_repository must use owner/repo format');
  }
  if (!manifest.environments || typeof manifest.environments !== 'object') throw new Error('environments is required');
  const keys = Object.keys(manifest.environments).sort();
  if (keys.join(',') !== [...ENVIRONMENTS].sort().join(',')) throw new Error('Manifest must define exactly dev, test and prod');

  for (const name of ENVIRONMENTS) {
    const cfg = manifest.environments[name];
    const required = [
      'runtime_repository', 'runtime_ref', 'workflow', 'worker_name', 'search_mode',
      'cloudflare_account_id_env', 'cloudflare_token_env', 'github_runtime_token_env',
      'source_read_token_env', 'allowed_google_sub_env', 'google_client_id_env', 'frontend_origin_env',
    ];
    for (const field of required) {
      const value = String(cfg?.[field] || '').trim();
      if (!value) throw new Error(`${name}.${field} is required`);
      if (PLACEHOLDER_RE.test(value)) throw new Error(`${name}.${field} contains unresolved placeholder content`);
    }
    if (cfg.runtime_repository !== CANONICAL_RUNTIME_REPOSITORIES[name]) {
      throw new Error(`${name}.runtime_repository does not match the canonical environment target`);
    }
    if (cfg.runtime_ref !== 'main') throw new Error(`${name}.runtime_ref must be main`);
    if (cfg.workflow !== 'runtime.yml') throw new Error(`${name}.workflow must be runtime.yml`);
    if (name === 'dev' && cfg.search_mode !== 'disabled') throw new Error('DEV search_mode must be disabled');
    if (name === 'test' && cfg.search_mode !== 'smoke') throw new Error('TEST search_mode must be smoke');
    if (name === 'prod' && cfg.search_mode !== 'live') throw new Error('PROD search_mode must be live');
  }
  return manifest;
}

export function requireEnvironment(name) {
  const normalized = String(name || '').trim().toLowerCase();
  if (!ENVIRONMENTS.includes(normalized)) throw new Error('Explicit --env dev|test|prod is required');
  return normalized;
}

export function requireSourceSha(value) {
  const sha = String(value || '').trim().toLowerCase();
  if (!SHA_RE.test(sha)) throw new Error('Explicit immutable --source-sha <40-char SHA> is required');
  return sha;
}

function requiredRuntimeValue(processEnv, envVarName, label) {
  const value = String(processEnv[envVarName] || '').trim();
  if (!value) throw new Error(`${label} is missing (${envVarName})`);
  if (PLACEHOLDER_RE.test(value)) throw new Error(`${label} contains unresolved placeholder content`);
  return value;
}

export function resolveEnvironment(manifest, name, sourceSha, processEnv = process.env, options = {}) {
  const envName = requireEnvironment(name);
  const sha = requireSourceSha(sourceSha);
  const cfg = manifest.environments[envName];
  const requireRuntimeInputs = options.requireRuntimeInputs !== false;

  const resolved = {
    environment: envName,
    sourceRepository: manifest.source_repository,
    sourceSha: sha,
    runtimeRepository: cfg.runtime_repository,
    runtimeRef: cfg.runtime_ref,
    workflow: cfg.workflow,
    workerName: cfg.worker_name,
    searchMode: cfg.search_mode,
    cloudflareAccountId: null,
    cloudflareToken: null,
    githubRuntimeToken: null,
    sourceReadToken: null,
    allowedGoogleSub: null,
    googleClientId: null,
    frontendOrigin: null,
  };

  if (requireRuntimeInputs) {
    resolved.cloudflareAccountId = requiredRuntimeValue(processEnv, cfg.cloudflare_account_id_env, 'Cloudflare account ID');
    if (!ACCOUNT_RE.test(resolved.cloudflareAccountId)) throw new Error(`Cloudflare account ID must be 32 hex characters (${cfg.cloudflare_account_id_env})`);
    resolved.cloudflareToken = requiredRuntimeValue(processEnv, cfg.cloudflare_token_env, 'Cloudflare token');
    resolved.githubRuntimeToken = requiredRuntimeValue(processEnv, cfg.github_runtime_token_env, 'GitHub runtime token');
    resolved.sourceReadToken = requiredRuntimeValue(processEnv, cfg.source_read_token_env, 'Source read token');
    resolved.allowedGoogleSub = requiredRuntimeValue(processEnv, cfg.allowed_google_sub_env, 'Allowed Google subject');
    resolved.googleClientId = requiredRuntimeValue(processEnv, cfg.google_client_id_env, 'Google OAuth client ID');
    resolved.frontendOrigin = requiredRuntimeValue(processEnv, cfg.frontend_origin_env, 'Frontend origin');
    let origin;
    try { origin = new URL(resolved.frontendOrigin); } catch { throw new Error(`Frontend origin must be a valid URL (${cfg.frontend_origin_env})`); }
    if (origin.protocol !== 'https:') throw new Error(`Frontend origin must use HTTPS (${cfg.frontend_origin_env})`);
  }

  return Object.freeze(resolved);
}

export function assertProdGate(environment, ownerGate) {
  if (environment === 'prod' && String(ownerGate || '').trim() !== 'APPROVED') {
    throw new Error('PROD operation refused: explicit --owner-gate APPROVED is required');
  }
}

export function assertTargetIsolation(environment, runtimeRepository, cloudflareAccountId, manifest, processEnv = process.env) {
  const expected = manifest.environments[environment];
  if (runtimeRepository !== expected.runtime_repository) throw new Error('Runtime repository target does not match environment');
  const expectedAccountId = String(processEnv[expected.cloudflare_account_id_env] || '').trim();
  if (!expectedAccountId || cloudflareAccountId !== expectedAccountId) throw new Error('Cloudflare account target does not match environment');
}

export function redact(value) {
  const text = String(value || '');
  if (!text) return 'MISSING';
  if (text.length <= 8) return '***';
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}
