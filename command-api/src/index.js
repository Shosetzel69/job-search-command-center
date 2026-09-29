import { createRemoteJWKSet, decodeJwt, jwtVerify } from 'jose';
import { activeCodes, assertNomenclatures, geographyIndex } from '../../shared/nomenclatures.mjs';
import { CANDIDATE_MANAGED_DATA_FILES, PROTECTED_DATA_FILES } from '../../shared/runtime-data.mjs';
import {
  applySourceAction,
  assertUniqueCategoryLabel,
  categoryIdFromLabel,
  findCategoryByLabel,
  newPendingSource,
  normalizeCategory,
  normalizeCategoryCatalog,
  normalizeSource,
  normalizeSourceCatalog,
  sameUrl,
  validateCategoryInput,
  validateSourceInput,
} from './source-governance.js';
import { assertEnvironmentConfig, manualSearchExecutionMode } from './environment-config.js';
import { BUILD_IDENTITY } from './build-identity.generated.js';
import { canAccessRuntimeRepository, dispatchWorkflow, hasActiveWorkflowRun, readRuntimeJson, writeRuntimeJson } from './runtime-backend.js';

const GOOGLE_JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const GITHUB_ACTIONS_OIDC_ISSUER = 'https://token.actions.githubusercontent.com';
const GITHUB_ACTIONS_OIDC_JWKS = createRemoteJWKSet(new URL('https://token.actions.githubusercontent.com/.well-known/jwks'));
const GITHUB_FUNCTIONAL_OIDC_AUDIENCE = 'jscc-functional-verification';
const GITHUB_FUNCTIONAL_REPOSITORY = 'Shosetzel69/job-search-command-center';
const GITHUB_FUNCTIONAL_REPOSITORY_ID = '1356423874';
const GITHUB_FUNCTIONAL_WORKFLOW_REFS = Object.freeze({
  dev: 'Shosetzel69/job-search-command-center/.github/workflows/deploy-environment.yml@refs/heads/main',
  test: 'Shosetzel69/job-search-command-center/.github/workflows/deploy-environment.yml@refs/heads/main',
  prod: 'Shosetzel69/job-search-command-center/.github/workflows/prod-cutover.yml@refs/heads/main',
});

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  if (!origin || origin !== env.FRONTEND_ORIGIN) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function assertAllowedOrigin(request, env) {
  const origin = request.headers.get('Origin');
  if (origin && origin !== env.FRONTEND_ORIGIN) {
    throw Object.assign(new Error('Origin not allowed'), { status: 403 });
  }
}

function googleConfigured(env) {
  return Boolean(env.GOOGLE_CLIENT_ID && env.ALLOWED_GOOGLE_SUB);
}

function bearerToken(request, missingMessage = 'Missing ID token') {
  const authorization = request.headers.get('Authorization') || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) throw Object.assign(new Error(missingMessage), { status: 401 });
  return match[1];
}

function githubOidcAudienceMatches(audience) {
  const values = Array.isArray(audience) ? audience : [audience];
  return values.includes(GITHUB_FUNCTIONAL_OIDC_AUDIENCE);
}

export function authorizeGithubOidcPayload(payload, env, nowSeconds = Math.floor(Date.now() / 1000)) {
  const environment = String(env.APP_ENV || '').trim().toLowerCase();
  const expectedWorkflowRef = GITHUB_FUNCTIONAL_WORKFLOW_REFS[environment];
  const forbidden = message => { throw Object.assign(new Error(message), { status: 403 }); };
  const unauthenticated = message => { throw Object.assign(new Error(message), { status: 401 }); };

  if (payload?.iss !== GITHUB_ACTIONS_OIDC_ISSUER) forbidden('GitHub Actions OIDC issuer is not authorized');
  if (!githubOidcAudienceMatches(payload?.aud)) forbidden('GitHub Actions OIDC audience is not authorized');
  if (String(payload?.repository_id || '') !== GITHUB_FUNCTIONAL_REPOSITORY_ID) forbidden('GitHub Actions OIDC repository identity is not authorized');
  if (payload?.repository !== GITHUB_FUNCTIONAL_REPOSITORY) forbidden('GitHub Actions OIDC repository is not authorized');
  if (!environment || payload?.environment !== environment) forbidden('GitHub Actions OIDC environment is not authorized');
  if (!expectedWorkflowRef || payload?.workflow_ref !== expectedWorkflowRef) forbidden('GitHub Actions OIDC workflow is not authorized');
  if (payload?.event_name !== 'workflow_dispatch') forbidden('GitHub Actions OIDC event is not authorized');

  const exp = Number(payload?.exp);
  const iat = Number(payload?.iat);
  const nbf = payload?.nbf == null ? null : Number(payload.nbf);
  if (!Number.isFinite(exp) || exp <= nowSeconds) unauthenticated('GitHub Actions OIDC token is expired');
  if (!Number.isFinite(iat) || iat > nowSeconds + 60) unauthenticated('GitHub Actions OIDC token issued-at time is invalid');
  if (nbf != null && (!Number.isFinite(nbf) || nbf > nowSeconds + 60)) unauthenticated('GitHub Actions OIDC token is not yet valid');
  return payload;
}

export async function verifyGithubActionsOidcToken(token, env, {
  jwks = GITHUB_ACTIONS_OIDC_JWKS,
  currentDate = new Date(),
} = {}) {
  const { payload } = await jwtVerify(token, jwks, {
    issuer: GITHUB_ACTIONS_OIDC_ISSUER,
    audience: GITHUB_FUNCTIONAL_OIDC_AUDIENCE,
    currentDate,
  });
  return authorizeGithubOidcPayload(payload, env, Math.floor(currentDate.getTime() / 1000));
}

function isGithubActionsOidcToken(token) {
  try {
    return decodeJwt(token)?.iss === GITHUB_ACTIONS_OIDC_ISSUER;
  } catch {
    return false;
  }
}

async function verifyGoogleToken(request, env) {
  if (!env.GOOGLE_CLIENT_ID) throw Object.assign(new Error('Google OAuth client is not configured'), { status: 503 });
  const token = bearerToken(request, 'Missing Google ID token');
  const { payload } = await jwtVerify(token, GOOGLE_JWKS, {
    issuer: ['https://accounts.google.com', 'accounts.google.com'],
    audience: env.GOOGLE_CLIENT_ID,
  });
  return payload;
}

function authorizeGooglePayload(payload, env) {
  if (!env.ALLOWED_GOOGLE_SUB) throw Object.assign(new Error('Authorization is not configured'), { status: 503 });
  if (!payload?.sub || payload.sub !== env.ALLOWED_GOOGLE_SUB) {
    throw Object.assign(new Error('User not authorized'), { status: 403 });
  }
  return payload;
}

async function authenticate(request, env, { allowGithubOidc = false, oidcDataFile = null } = {}) {
  const token = bearerToken(request);
  if (isGithubActionsOidcToken(token)) {
    if (!allowGithubOidc) {
      throw Object.assign(new Error('GitHub Actions OIDC is not allowed for this endpoint'), { status: 403 });
    }
    if (!oidcDataFile || !CANDIDATE_MANAGED_DATA_FILES.includes(oidcDataFile)) {
      throw Object.assign(new Error('GitHub Actions OIDC is not authorized for this protected data file'), { status: 403 });
    }
    return verifyGithubActionsOidcToken(token, env);
  }
  if (!env.ALLOWED_GOOGLE_SUB) throw Object.assign(new Error('Authorization is not configured'), { status: 503 });
  const payload = await verifyGoogleToken(request, env);
  return authorizeGooglePayload(payload, env);
}

function runtimeConfig(env) {
  return assertEnvironmentConfig(env, BUILD_IDENTITY);
}

async function hasActiveRun(env) {
  return hasActiveWorkflowRun(env, runtimeConfig(env));
}

async function dispatchRun(env, runTrigger = 'manual-ui', checkActive = true, executionMode = 'policy') {
  return dispatchWorkflow(env, runtimeConfig(env), runTrigger, checkActive, executionMode);
}

async function readRepoJson(env, path) {
  return readRuntimeJson(env, runtimeConfig(env), path);
}

async function writeRepoJson(env, path, sha, payload, message) {
  return writeRuntimeJson(env, runtimeConfig(env), path, sha, payload, message);
}

function protectedRuntimePath(env, file) {
  const overrides = {
    'search-config.json': env.SEARCH_CONFIG_PATH,
    'sources.json': env.SOURCES_PATH,
    'source-categories.json': env.SOURCE_CATEGORIES_PATH,
    'nomenclatures.json': env.NOMENCLATURES_PATH,
  };
  return overrides[file] || `data/${file}`;
}

async function readProtectedRuntimeData(env, file) {
  if (!PROTECTED_DATA_FILES.includes(file)) {
    throw Object.assign(new Error('Not found'), { status:404 });
  }
  const { payload } = await readRepoJson(env, protectedRuntimePath(env, file));
  return payload;
}

async function readNomenclatures(env) {
  const path = env.NOMENCLATURES_PATH || 'data/nomenclatures.json';
  const { sha, payload } = await readRepoJson(env, path);
  try {
    return { path, sha, payload:assertNomenclatures(payload) };
  } catch (error) {
    throw Object.assign(new Error(`Invalid nomenclatures contract: ${error.message}`), { status: 409 });
  }
}

function uniqueStrings(input, { max = 100, maxLength = 100, uppercase = false } = {}) {
  if (!Array.isArray(input) || input.length > max || input.some(x => typeof x !== 'string' || x.length > maxLength)) {
    throw Object.assign(new Error('Invalid list value'), { status: 400 });
  }
  const values = input
    .map(x => x.trim())
    .filter(Boolean)
    .map(x => uppercase ? x.toUpperCase() : x);
  return [...new Set(values)];
}

function assertGeographyNoConflict(patch, nomenclatures) {
  const { validCountries, validRegions, membership } = geographyIndex(nomenclatures);
  const targetsR = new Set((patch.targetRegions || []).map(x => x.toUpperCase()));
  const excludedR = new Set((patch.excludedRegions || []).map(x => x.toUpperCase()));
  const targetsC = new Set((patch.targetCountries || []).map(x => x.toUpperCase()));
  const excludedC = new Set((patch.excludedCountries || []).map(x => x.toUpperCase()));
  for (const r of [...targetsR, ...excludedR]) {
    if (!validRegions.has(r)) throw Object.assign(new Error(`Unsupported region: ${r}`), { status: 400 });
  }
  for (const c of [...targetsC, ...excludedC]) {
    if (!validCountries.has(c)) throw Object.assign(new Error(`Unsupported country code: ${c}`), { status: 400 });
  }
  for (const c of targetsC) if (excludedC.has(c)) throw Object.assign(new Error('Aceeasi tara nu poate fi inclusa si exclusa.'), { status: 400 });
  for (const r of targetsR) if (excludedR.has(r)) throw Object.assign(new Error('Aceeasi regiune nu poate fi inclusa si exclusa.'), { status: 400 });
  for (const r of targetsR) for (const c of excludedC) {
    if (membership.get(r)?.has(c)) throw Object.assign(new Error('Exista un conflict intre regiunea inclusa si o tara exclusa.'), { status: 400 });
  }
  for (const r of excludedR) for (const c of targetsC) {
    if (membership.get(r)?.has(c)) throw Object.assign(new Error('Exista un conflict intre regiunea exclusa si o tara inclusa.'), { status: 400 });
  }
}

function validateUserConfigPatch(input, nomenclatures) {
  assertNomenclatures(nomenclatures);
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw Object.assign(new Error('Invalid configuration payload'), { status: 400 });
  }
  const output = {};
  const booleanKeys = ['rolePm','roleDelivery','roleService','roleScrum','roleProgram','workRemote','workHybrid','workOnsite','keepReposts','immediateStart','jobspipeEnabled'];
  for (const key of booleanKeys) if (key in input) {
    if (typeof input[key] !== 'boolean') throw Object.assign(new Error(`${key} must be boolean`), { status: 400 });
    output[key] = input[key];
  }
  if ('contractTypes' in input) {
    const values = uniqueStrings(input.contractTypes, { max:20, maxLength:40 }).map(value => value.toLowerCase());
    const allowed = activeCodes(nomenclatures, 'contract_types');
    const unsupported = values.filter(value => !allowed.has(value));
    if (unsupported.length) throw Object.assign(new Error(`Unsupported contract type: ${unsupported.join(', ')}`), { status:400 });
    output.contractTypes = values;
  }
  if ('jobspipeMode' in input) {
    const value = String(input.jobspipeMode || '').toLowerCase();
    if (!['disabled','apify','direct'].includes(value)) {
      throw Object.assign(new Error('jobspipeMode must be disabled, apify or direct'), { status: 400 });
    }
    output.jobspipeMode = value;
  }
  const integerRules = {
    jobspipeApifyMaxItems:[100,20000],
    jobspipeDirectRunBudget:[1,1000],
    jobspipeDirectMonthlyGuard:[1,100000],
  };
  for (const [key,[min,max]] of Object.entries(integerRules)) if (key in input) {
    const value = Number(input[key]);
    if (!Number.isInteger(value) || value < min || value > max) {
      throw Object.assign(new Error(`${key} must be ${min}-${max}`), { status: 400 });
    }
    output[key] = value;
  }
  if ('freshness' in input) {
    const value = Number(input.freshness);
    if (![24,36,48,120,720].includes(value)) throw Object.assign(new Error('freshness must be 24, 36, 48, 120 or 720'), { status: 400 });
    output.freshness = value;
  }
  if ('fitThreshold' in input) {
    const value = Number(input.fitThreshold);
    if (!Number.isInteger(value) || value < 50 || value > 100) throw Object.assign(new Error('fitThreshold must be 50-100'), { status: 400 });
    output.fitThreshold = value;
  }
  for (const key of ['rateMin','rateMax']) if (key in input) {
    const value = Number(input[key]);
    if (!Number.isFinite(value) || value < 0 || value > 5000) throw Object.assign(new Error(`${key} is invalid`), { status: 400 });
    output[key] = value;
  }
  if ('rateMin' in output && 'rateMax' in output && output.rateMin > output.rateMax) {
    throw Object.assign(new Error('rateMin cannot exceed rateMax'), { status: 400 });
  }
  if ('exclusions' in input) output.exclusions = uniqueStrings(input.exclusions, { max: 20, maxLength: 200 });
  if ('targetRegions' in input) output.targetRegions = uniqueStrings(input.targetRegions, { max: 10, maxLength: 20, uppercase: true });
  if ('targetCountries' in input) output.targetCountries = uniqueStrings(input.targetCountries, { max: 100, maxLength: 2, uppercase: true });
  if ('excludedRegions' in input) output.excludedRegions = uniqueStrings(input.excludedRegions, { max: 10, maxLength: 20, uppercase: true });
  if ('excludedCountries' in input) output.excludedCountries = uniqueStrings(input.excludedCountries, { max: 100, maxLength: 2, uppercase: true });
  assertGeographyNoConflict(output, nomenclatures);
  return output;
}

function applyUserConfigPatch(config, patch) {
  const groups = config.role_groups || {};
  const mapping = { rolePm:'pm', roleDelivery:'delivery', roleService:'service', roleScrum:'scrum', roleProgram:'program' };
  for (const [inputKey, groupKey] of Object.entries(mapping)) {
    if (inputKey in patch && groups[groupKey]) groups[groupKey].enabled = patch[inputKey];
  }
  config.role_groups = groups;
  config.work_modes ||= {};
  if ('workRemote' in patch) config.work_modes.remote = patch.workRemote;
  if ('workHybrid' in patch) config.work_modes.hybrid = patch.workHybrid;
  if ('workOnsite' in patch) config.work_modes.onsite = patch.workOnsite;
  if ('contractTypes' in patch) config.contract_types = patch.contractTypes;
  if ('freshness' in patch) config.freshness_hours = patch.freshness;
  if ('fitThreshold' in patch) config.fit_threshold = patch.fitThreshold;
  if ('keepReposts' in patch) config.keep_reposts = patch.keepReposts;
  if ('rateMin' in patch) config.rate_min_eur_day = patch.rateMin;
  if ('rateMax' in patch) config.rate_max_eur_day = patch.rateMax;
  if ('immediateStart' in patch) config.immediate_start = patch.immediateStart;
  if ('jobspipeMode' in patch) config.jobspipe_mode = patch.jobspipeMode;
  if ('jobspipeEnabled' in patch && !('jobspipeMode' in patch)) config.jobspipe_mode = patch.jobspipeEnabled ? 'direct' : 'disabled';
  if ('jobspipeApifyMaxItems' in patch) config.jobspipe_apify_max_items_per_run = patch.jobspipeApifyMaxItems;
  if ('jobspipeDirectRunBudget' in patch) config.jobspipe_credit_budget_per_run = patch.jobspipeDirectRunBudget;
  if ('jobspipeDirectMonthlyGuard' in patch) config.jobspipe_monthly_credit_guard = patch.jobspipeDirectMonthlyGuard;
  if ('exclusions' in patch) config.exclusions = patch.exclusions;
  if ('targetRegions' in patch) config.target_regions = patch.targetRegions;
  if ('targetCountries' in patch) {
    config.target_country_codes = patch.targetCountries;
    config.search_country_codes = patch.targetCountries;
  }
  if ('excludedRegions' in patch) config.excluded_regions = patch.excludedRegions;
  if ('excludedCountries' in patch) config.excluded_country_codes = patch.excludedCountries;
  delete config.jobspipe_enabled;
  return config;
}

function validateEffectiveSearchConfig(config, nomenclatures) {
  const { validCountries, validRegions, membership } = geographyIndex(nomenclatures);
  const allowedContractTypes = activeCodes(nomenclatures, 'contract_types');
  if (!config || config.schema_version !== '1.0') {
    throw Object.assign(new Error('Unsupported search configuration schema'), { status: 409 });
  }
  const targetRegions = new Set((config.target_regions || []).map(x => String(x).trim().toUpperCase()).filter(Boolean));
  const excludedRegions = new Set((config.excluded_regions || []).map(x => String(x).trim().toUpperCase()).filter(Boolean));
  const targetCountries = new Set((config.target_country_codes || config.search_country_codes || []).map(x => String(x).trim().toUpperCase()).filter(Boolean));
  const excludedCountries = new Set((config.excluded_country_codes || []).map(x => String(x).trim().toUpperCase()).filter(Boolean));
  for (const region of [...targetRegions, ...excludedRegions]) if (!validRegions.has(region)) throw Object.assign(new Error(`Unsupported region: ${region}`), { status: 400 });
  for (const country of [...targetCountries, ...excludedCountries]) if (!validCountries.has(country)) throw Object.assign(new Error(`Unsupported country code: ${country}`), { status: 400 });
  if (!targetRegions.size && !targetCountries.size) throw Object.assign(new Error('Selecteaza cel putin o tara sau regiune tinta.'), { status: 400 });
  for (const country of targetCountries) if (excludedCountries.has(country)) throw Object.assign(new Error('Aceeasi tara nu poate fi inclusa si exclusa.'), { status: 400 });
  for (const region of targetRegions) if (excludedRegions.has(region)) throw Object.assign(new Error('Aceeasi regiune nu poate fi inclusa si exclusa.'), { status: 400 });
  for (const region of targetRegions) for (const country of excludedCountries) if (membership.get(region)?.has(country)) throw Object.assign(new Error('Exista un conflict intre regiunea inclusa si o tara exclusa.'), { status: 400 });
  for (const region of excludedRegions) for (const country of targetCountries) if (membership.get(region)?.has(country)) throw Object.assign(new Error('Exista un conflict intre regiunea exclusa si o tara inclusa.'), { status: 400 });
  const configuredContractTypes = config.contract_types == null ? [...allowedContractTypes] : config.contract_types;
  if (!Array.isArray(configuredContractTypes)) throw Object.assign(new Error('contract_types must be a list'), { status:400 });
  for (const value of configuredContractTypes) if (!allowedContractTypes.has(String(value).toLowerCase())) throw Object.assign(new Error(`Unsupported contract type: ${value}`), { status:400 });
  const modes = config.work_modes || {};
  for (const key of ['remote','hybrid','onsite']) if (key in modes && typeof modes[key] !== 'boolean') throw Object.assign(new Error(`work_modes.${key} must be boolean`), { status:400 });
  if (Number(config.rate_min_eur_day || 0) > Number(config.rate_max_eur_day || 0)) throw Object.assign(new Error('rateMin cannot exceed rateMax'), { status: 400 });
  return config;
}

async function updateSearchConfig(env, patch, nomenclatures = null) {
  const canonical = nomenclatures || (await readNomenclatures(env)).payload;
  const path = env.SEARCH_CONFIG_PATH;
  const { sha, payload: config } = await readRepoJson(env, path);
  const before = JSON.stringify(config);
  const updated = validateEffectiveSearchConfig(applyUserConfigPatch(config, patch), canonical);
  if (JSON.stringify(updated) === before) return { config: updated, commit: null, changed: false };
  const result = await writeRepoJson(env, path, sha, updated, 'Update search config from command API');
  return { config: updated, commit: result?.commit?.sha || null, changed: true };
}

async function readSearchConfig(env, nomenclatures = null) {
  const canonical = nomenclatures || (await readNomenclatures(env)).payload;
  const { payload } = await readRepoJson(env, env.SEARCH_CONFIG_PATH);
  return validateEffectiveSearchConfig(payload, canonical);
}

async function optionalJsonBody(request) {
  const text = await request.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw Object.assign(new Error('Invalid JSON payload'), { status: 400 });
  }
}

async function readSourceCategories(env) {
  const path = env.SOURCE_CATEGORIES_PATH || 'data/source-categories.json';
  const { sha, payload } = await readRepoJson(env, path);
  return { path, sha, catalog: normalizeCategoryCatalog(payload) };
}

async function mutateSourceCategories(env, mutation, message = 'Update source categories from command API') {
  const { path, sha, catalog } = await readSourceCategories(env);
  const updated = mutation(catalog);
  updated.count = updated.categories.length;
  const result = await writeRepoJson(env, path, sha, updated, message);
  return { catalog: updated, commit: result?.commit?.sha || null };
}

async function readSources(env) {
  const path = env.SOURCES_PATH || 'data/sources.json';
  const { sha, payload } = await readRepoJson(env, path);
  return { path, sha, catalog: normalizeSourceCatalog(payload) };
}

async function mutateSources(env, mutation, message = 'Update source registry from command API') {
  const { path, sha, catalog } = await readSources(env);
  const updated = mutation(catalog);
  updated.count = updated.sources.length;
  const result = await writeRepoJson(env, path, sha, updated, message);
  return { catalog: updated, commit: result?.commit?.sha || null };
}

async function assertSourceCategory(env, categoryLabel, requireActive = true) {
  const { catalog } = await readSourceCategories(env);
  return findCategoryByLabel(catalog, categoryLabel, { requireActive });
}

async function renameSourceCategoryReferences(env, oldLabel, newLabel) {
  const { path, sha, catalog } = await readSources(env);
  let changed = false;
  for (let i = 0; i < catalog.sources.length; i += 1) {
    if (catalog.sources[i].category === oldLabel) {
      catalog.sources[i] = normalizeSource({ ...catalog.sources[i], category:newLabel }, { legacyApproved:true });
      changed = true;
    }
  }
  if (!changed) return null;
  const result = await writeRepoJson(env, path, sha, catalog, 'Rename source category references');
  return result?.commit?.sha || null;
}

export { applyUserConfigPatch, assertGeographyNoConflict, authorizeGooglePayload, protectedRuntimePath, readNomenclatures, readProtectedRuntimeData, validateEffectiveSearchConfig, validateUserConfigPatch };

export default {
  async fetch(request, env) {
    let cors = {};
    try {
      const runtime = runtimeConfig(env);
      cors = corsHeaders(request, env);
      if (request.method === 'OPTIONS') {
        if (request.headers.get('Origin') !== runtime.frontendOrigin) return new Response(null, { status: 403 });
        return new Response(null, { status: 204, headers: cors });
      }

      const url = new URL(request.url);
      if (request.method === 'GET' && url.pathname === '/health') {
        const runtimeConfigured = await canAccessRuntimeRepository(env, runtime);
        return json({
          status:'ok',
          environment:runtime.appEnv,
          source_sha:runtime.sourceSha,
          runtime_repo:runtime.runtimeRepository,
          runtime_ref:runtime.runtimeRef,
          runtime_data_sha:runtime.runtimeDataSha,
          search_mode:runtime.searchMode,
          runtime_backend:runtime.runtimeBackend,
          runtime_configured:runtimeConfigured,
          auth_configured:googleConfigured(env),
          github_configured:runtime.runtimeBackend === 'github' ? runtimeConfigured : false,
        }, 200, cors);
      }
      if (request.method === 'GET' && url.pathname === '/auth/config') {
        return json({ client_id:env.GOOGLE_CLIENT_ID || null, configured:googleConfigured(env) }, googleConfigured(env) ? 200 : 503, cors);
      }

      assertAllowedOrigin(request, env);
      if (request.method === 'POST' && url.pathname === '/auth/session') {
        const user = await authenticate(request, env);
        return json({ status:'ok', email:user.email || null }, 200, cors);
      }

      if (request.method === 'GET' && url.pathname.startsWith('/data/')) {
        const file = decodeURIComponent(url.pathname.slice('/data/'.length));
        if (!file || file.includes('/') || !PROTECTED_DATA_FILES.includes(file)) {
          return json({ error:'Not found' }, 404, cors);
        }
        await authenticate(request, env, { allowGithubOidc:true, oidcDataFile:file });
        return json(await readProtectedRuntimeData(env, file), 200, cors);
      }

      const user = await authenticate(request, env);

      if (request.method === 'POST' && url.pathname === '/commands/run') {
        const executionMode = manualSearchExecutionMode(runtime.appEnv, runtime.searchMode);
        if (!executionMode) throw Object.assign(new Error('Full search is disabled for this environment'), { status: 409 });
        if (await hasActiveRun(env)) throw Object.assign(new Error('A search run is already queued or running'), { status: 409 });
        const input = await optionalJsonBody(request);
        const nomenclatures = (await readNomenclatures(env)).payload;
        let configCommit = null;
        if (input !== null) {
          const patch = validateUserConfigPatch(input, nomenclatures);
          const result = await updateSearchConfig(env, patch, nomenclatures);
          configCommit = result.commit;
        } else {
          await readSearchConfig(env, nomenclatures);
        }
        await dispatchRun(env, 'manual-ui', false, executionMode);
        return json({ status:'accepted', requested_by:user.sub, trigger:'manual-ui', execution_mode:executionMode, source_sha:runtime.sourceSha, config_commit:configCommit }, 202, cors);
      }

      if (request.method === 'PUT' && url.pathname === '/config') {
        const nomenclatures = (await readNomenclatures(env)).payload;
        const input = validateUserConfigPatch(await request.json(), nomenclatures);
        const result = await updateSearchConfig(env, input, nomenclatures);
        return json({ status:'saved', commit:result.commit, changed:result.changed }, 200, cors);
      }

      if (request.method === 'GET' && url.pathname === '/source-categories') {
        const result = await readSourceCategories(env);
        return json({ status:'ok', catalog:result.catalog }, 200, cors);
      }

      if (request.method === 'POST' && url.pathname === '/source-categories') {
        const input = validateCategoryInput(await request.json(), false);
        const result = await mutateSourceCategories(env, catalog => {
          assertUniqueCategoryLabel(catalog, input.label);
          let id = categoryIdFromLabel(input.label);
          if (catalog.categories.some(item => item.id === id)) id = `${id}-${crypto.randomUUID().slice(0, 8)}`;
          const order = input.order ?? (catalog.categories.reduce((max, item) => Math.max(max, item.order), 0) + 10);
          catalog.categories.push(normalizeCategory({ id, label:input.label, active:input.active ?? true, order }, catalog.categories.length));
          catalog.categories.sort((a, b) => a.order - b.order || a.label.localeCompare(b.label, 'ro'));
          return catalog;
        });
        return json({ status:'created', commit:result.commit, catalog:result.catalog }, 201, cors);
      }

      const categoryMatch = url.pathname.match(/^\/source-categories\/([^/]+)$/);
      if (categoryMatch && request.method === 'PUT') {
        const id = decodeURIComponent(categoryMatch[1]);
        const patch = validateCategoryInput(await request.json(), true);
        const current = await readSourceCategories(env);
        const existing = current.catalog.categories.find(item => item.id === id);
        if (!existing) throw Object.assign(new Error('Categoria nu a fost gasita.'), { status: 404 });
        if (patch.label) assertUniqueCategoryLabel(current.catalog, patch.label, id);
        if (patch.label && patch.label !== existing.label) {
          await renameSourceCategoryReferences(env, existing.label, patch.label);
        }
        const result = await mutateSourceCategories(env, catalog => {
          const index = catalog.categories.findIndex(item => item.id === id);
          if (index < 0) throw Object.assign(new Error('Categoria nu a fost gasita.'), { status: 404 });
          catalog.categories[index] = normalizeCategory({ ...catalog.categories[index], ...patch }, index);
          catalog.categories.sort((a, b) => a.order - b.order || a.label.localeCompare(b.label, 'ro'));
          return catalog;
        }, 'Update source category');
        return json({ status:'saved', commit:result.commit, catalog:result.catalog }, 200, cors);
      }

      if (categoryMatch && request.method === 'DELETE') {
        const id = decodeURIComponent(categoryMatch[1]);
        const current = await readSourceCategories(env);
        const category = current.catalog.categories.find(item => item.id === id);
        if (!category) throw Object.assign(new Error('Categoria nu a fost gasita.'), { status: 404 });
        const { catalog:sources } = await readSources(env);
        if (sources.sources.some(source => source.category === category.label)) {
          throw Object.assign(new Error('Categoria are surse asociate. Muta sursele inainte de stergere.'), { status: 409 });
        }
        const result = await mutateSourceCategories(env, catalog => {
          catalog.categories = catalog.categories.filter(item => item.id !== id);
          return catalog;
        }, 'Delete source category');
        return json({ status:'deleted', commit:result.commit, catalog:result.catalog }, 200, cors);
      }

      if (request.method === 'POST' && url.pathname === '/sources') {
        const source = validateSourceInput(await request.json(), false);
        const category = await assertSourceCategory(env, source.category, true);
        source.category = category.label;
        const result = await mutateSources(env, catalog => {
          if (catalog.sources.some(item => sameUrl(item.url, source.url))) {
            throw Object.assign(new Error('Exista deja o sursa cu acest URL. Editeaza intrarea existenta.'), { status: 409 });
          }
          catalog.sources.push(newPendingSource(source));
          return catalog;
        });
        return json({ status:'created', commit:result.commit, catalog:result.catalog }, 201, cors);
      }

      const sourceMatch = url.pathname.match(/^\/sources\/([^/]+)$/);
      if (sourceMatch && request.method === 'PUT') {
        const id = decodeURIComponent(sourceMatch[1]);
        const patch = validateSourceInput(await request.json(), true);
        if (patch.category) {
          const category = await assertSourceCategory(env, patch.category, true);
          patch.category = category.label;
        }
        const result = await mutateSources(env, catalog => {
          const index = catalog.sources.findIndex(item => item.id === id);
          if (index < 0) throw Object.assign(new Error('Sursa nu a fost gasita.'), { status: 404 });
          const next = normalizeSource({ ...catalog.sources[index], ...patch }, { legacyApproved:true });
          if (patch.url && catalog.sources.some((item, i) => i !== index && sameUrl(item.url, patch.url))) {
            throw Object.assign(new Error('Exista deja o sursa cu acest URL.'), { status: 409 });
          }
          next.id = catalog.sources[index].id;
          catalog.sources[index] = next;
          return catalog;
        });
        return json({ status:'saved', commit:result.commit, catalog:result.catalog }, 200, cors);
      }

      const sourceActionMatch = url.pathname.match(/^\/sources\/([^/]+)\/actions$/);
      if (sourceActionMatch && request.method === 'POST') {
        const id = decodeURIComponent(sourceActionMatch[1]);
        const input = await request.json();
        const action = String(input?.action || '');
        const reason = input?.reason == null ? null : String(input.reason).slice(0, 500);
        const result = await mutateSources(env, catalog => {
          const index = catalog.sources.findIndex(item => item.id === id);
          if (index < 0) throw Object.assign(new Error('Sursa nu a fost gasita.'), { status: 404 });
          catalog.sources[index] = applySourceAction(catalog.sources[index], action, { reason });
          return catalog;
        }, `Source governance action: ${action}`);
        return json({ status:'saved', action, commit:result.commit, catalog:result.catalog }, 200, cors);
      }

      if (sourceMatch && request.method === 'DELETE') {
        const id = decodeURIComponent(sourceMatch[1]);
        const result = await mutateSources(env, catalog => {
          const before = catalog.sources.length;
          catalog.sources = catalog.sources.filter(item => item.id !== id);
          if (catalog.sources.length === before) throw Object.assign(new Error('Sursa nu a fost gasita.'), { status: 404 });
          return catalog;
        });
        return json({ status:'deleted', commit:result.commit, catalog:result.catalog }, 200, cors);
      }

      return json({ error:'Not found' }, 404, cors);
    } catch (error) {
      const code = String(error?.code || '');
      const jwtFailure = code.startsWith('ERR_JWT') || code.startsWith('ERR_JWS');
      const status = Number(error?.status) || (jwtFailure ? 401 : 500);
      const publicMessage = status >= 500 ? 'Command API error' : error.message;
      console.error(error);
      return json({ error:publicMessage }, status, cors);
    }
  },
};
