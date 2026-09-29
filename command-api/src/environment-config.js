const ENVIRONMENTS = new Set(['dev', 'test', 'prod']);
const SEARCH_MODES = new Set(['disabled', 'smoke', 'live']);
const SHA_RE = /^[0-9a-f]{40}$/i;

function configError(message) {
  return Object.assign(new Error(message), { status: 503 });
}

function requiredString(value, name) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw configError(`${name} is required`);
  return normalized;
}

function requiredSha(value, name) {
  const normalized = requiredString(value, name).toLowerCase();
  if (!SHA_RE.test(normalized)) throw configError(`${name} must be a full 40-character commit SHA`);
  return normalized;
}

function identitySha(name, runtimeValue, buildValue) {
  const runtime = String(runtimeValue ?? '').trim();
  const build = String(buildValue ?? '').trim();
  if (runtime && build && runtime.toLowerCase() !== build.toLowerCase()) {
    throw configError(`${name} does not match the immutable build identity`);
  }
  return requiredSha(runtime || build, name);
}

function requiredOrigin(value) {
  const normalized = requiredString(value, 'FRONTEND_ORIGIN').replace(/\/$/, '');
  let parsed;
  try { parsed = new URL(normalized); }
  catch { throw configError('FRONTEND_ORIGIN must be a valid origin'); }
  if (!['https:', 'http:'].includes(parsed.protocol) || parsed.origin !== normalized) {
    throw configError('FRONTEND_ORIGIN must contain only scheme and host');
  }
  return normalized;
}

export function manualSearchExecutionMode(appEnv, searchMode) {
  const environment = String(appEnv || '').trim().toLowerCase();
  const mode = String(searchMode || '').trim().toLowerCase();
  if (environment === 'dev' && mode === 'disabled') return 'manual-full';
  if (environment === 'test' && mode === 'smoke') return 'manual-full';
  if (environment === 'prod' && mode === 'live') return 'policy';
  return null;
}

export function assertEnvironmentConfig(env = {}, buildIdentity = {}) {
  const appEnv = requiredString(env.APP_ENV, 'APP_ENV').toLowerCase();
  if (!ENVIRONMENTS.has(appEnv)) throw configError('APP_ENV must be dev, test or prod');

  const runtimeBackend = String(env.JSCC_RUNTIME_BACKEND || 'github').trim().toLowerCase();
  if (!['github','gcp'].includes(runtimeBackend)) throw configError('JSCC_RUNTIME_BACKEND must be github or gcp');

  let runtimeOwner = null;
  let runtimeRepo = null;
  let runtimeRef = null;
  let workflow = null;
  let gcpProjectId = null;
  let gcpRuntimeBucket = null;
  let gcpSearchJob = null;
  let gcpRegion = null;

  if (runtimeBackend === 'github') {
    runtimeOwner = requiredString(env.GITHUB_RUNTIME_OWNER, 'GITHUB_RUNTIME_OWNER');
    runtimeRepo = requiredString(env.GITHUB_RUNTIME_REPO, 'GITHUB_RUNTIME_REPO');
    runtimeRef = requiredString(env.GITHUB_RUNTIME_REF, 'GITHUB_RUNTIME_REF');
    workflow = requiredString(env.GITHUB_WORKFLOW, 'GITHUB_WORKFLOW');
  } else {
    gcpProjectId = requiredString(env.GCP_PROJECT_ID, 'GCP_PROJECT_ID');
    gcpRuntimeBucket = requiredString(env.GCP_RUNTIME_BUCKET, 'GCP_RUNTIME_BUCKET');
    gcpSearchJob = requiredString(env.GCP_SEARCH_JOB, 'GCP_SEARCH_JOB');
    gcpRegion = requiredString(env.GCP_REGION || 'europe-west1', 'GCP_REGION');
    runtimeRef = 'gcp-runtime';
  }
  const sourceSha = identitySha('SOURCE_SHA', env.SOURCE_SHA, buildIdentity.sourceSha);
  const runtimeDataSha = identitySha('RUNTIME_DATA_SHA', env.RUNTIME_DATA_SHA, buildIdentity.runtimeDataSha);
  const searchMode = requiredString(env.SEARCH_MODE, 'SEARCH_MODE').toLowerCase();
  if (!SEARCH_MODES.has(searchMode)) throw configError('SEARCH_MODE must be disabled, smoke or live');
  if (appEnv === 'prod' && searchMode !== 'live') throw configError('PROD requires SEARCH_MODE=live');
  if (appEnv !== 'prod' && searchMode === 'live') throw configError('DEV/TEST cannot use SEARCH_MODE=live');

  const frontendOrigin = requiredOrigin(env.FRONTEND_ORIGIN);
  return Object.freeze({
    appEnv,
    runtimeBackend,
    runtimeOwner,
    runtimeRepo,
    runtimeRef,
    workflow,
    gcpProjectId,
    gcpRuntimeBucket,
    gcpSearchJob,
    gcpRegion,
    sourceSha,
    runtimeDataSha,
    searchMode,
    frontendOrigin,
    runtimeRepository: runtimeBackend === 'github' ? `${runtimeOwner}/${runtimeRepo}` : `gcp://${gcpProjectId}/${gcpRuntimeBucket}`,
  });
}

export { SHA_RE };
