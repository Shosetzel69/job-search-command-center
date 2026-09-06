import { createRemoteJWKSet, jwtVerify } from 'jose';

const GOOGLE_JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const GITHUB_API_VERSION = '2026-03-10';
const SOURCE_SCHEMA = '1.0';

const REGION_COUNTRIES = {
  EU: new Set(['AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE']),
  US: new Set(['US']),
  ASIA: new Set(['AF','AM','AZ','BH','BD','BT','BN','KH','CN','GE','HK','IN','ID','IR','IQ','IL','JP','JO','KZ','KW','KG','LA','LB','MO','MY','MV','MN','MM','NP','KP','OM','PK','PS','PH','QA','SA','SG','KR','LK','SY','TW','TJ','TH','TL','TR','TM','AE','UZ','VN','YE']),
};

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });
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
  if (origin && origin !== env.FRONTEND_ORIGIN) throw Object.assign(new Error('Origin not allowed'), { status: 403 });
}

function googleConfigured(env) { return Boolean(env.GOOGLE_CLIENT_ID && env.ALLOWED_GOOGLE_SUB); }

async function verifyGoogleToken(request, env) {
  if (!env.GOOGLE_CLIENT_ID) throw Object.assign(new Error('Google OAuth client is not configured'), { status: 503 });
  const authorization = request.headers.get('Authorization') || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) throw Object.assign(new Error('Missing Google ID token'), { status: 401 });
  const { payload } = await jwtVerify(match[1], GOOGLE_JWKS, {
    issuer: ['https://accounts.google.com', 'accounts.google.com'], audience: env.GOOGLE_CLIENT_ID,
  });
  return payload;
}

async function authenticate(request, env) {
  if (!env.ALLOWED_GOOGLE_SUB) throw Object.assign(new Error('Authorization is not configured'), { status: 503 });
  const payload = await verifyGoogleToken(request, env);
  if (!payload.sub || payload.sub !== env.ALLOWED_GOOGLE_SUB) throw Object.assign(new Error('User not authorized'), { status: 403 });
  return payload;
}

function githubHeaders(env) {
  return {
    Accept: 'application/vnd.github+json', Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    'X-GitHub-Api-Version': GITHUB_API_VERSION, 'User-Agent': 'job-search-command-api',
  };
}
function githubBase(env) { return `https://api.github.com/repos/${encodeURIComponent(env.GITHUB_OWNER)}/${encodeURIComponent(env.GITHUB_REPO)}`; }
async function githubRequest(env, path, init = {}) {
  if (!env.GITHUB_TOKEN) throw Object.assign(new Error('GitHub token is not configured'), { status: 503 });
  const response = await fetch(`${githubBase(env)}${path}`, { ...init, headers: { ...githubHeaders(env), ...(init.headers || {}) } });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 1000);
    const status = response.status === 409 ? 409 : 502;
    throw Object.assign(new Error(`GitHub ${response.status}: ${detail}`), { status });
  }
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function hasActiveRun(env) {
  const workflow = encodeURIComponent(env.GITHUB_WORKFLOW);
  const payload = await githubRequest(env, `/actions/workflows/${workflow}/runs?per_page=10`);
  return (payload?.workflow_runs || []).some(run => run.status === 'queued' || run.status === 'in_progress');
}
async function dispatchRun(env) {
  if (await hasActiveRun(env)) throw Object.assign(new Error('A search run is already queued or running'), { status: 409 });
  const workflow = encodeURIComponent(env.GITHUB_WORKFLOW);
  return githubRequest(env, `/actions/workflows/${workflow}/dispatches`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ref: env.GITHUB_REF }),
  });
}

function decodeBase64Utf8(value) {
  const binary = atob(value.replace(/\n/g, ''));
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
function encodeBase64Utf8(value) {
  const bytes = new TextEncoder().encode(value); let binary = ''; const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}
function encodePath(path) { return path.split('/').map(encodeURIComponent).join('/'); }
async function readRepoJson(env, path) {
  const current = await githubRequest(env, `/contents/${encodePath(path)}?ref=${encodeURIComponent(env.GITHUB_REF)}`);
  if (!current?.sha || !current?.content) throw Object.assign(new Error(`Repository file could not be loaded: ${path}`), { status: 502 });
  return { sha: current.sha, payload: JSON.parse(decodeBase64Utf8(current.content)) };
}
async function writeRepoJson(env, path, sha, payload, message) {
  return githubRequest(env, `/contents/${encodePath(path)}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, content: encodeBase64Utf8(`${JSON.stringify(payload, null, 2)}\n`), sha, branch: env.GITHUB_REF }),
  });
}

function uniqueStrings(input, { max = 100, maxLength = 100, uppercase = false } = {}) {
  if (!Array.isArray(input) || input.length > max || input.some(x => typeof x !== 'string' || x.length > maxLength)) {
    throw Object.assign(new Error('Invalid list value'), { status: 400 });
  }
  const values = input.map(x => x.trim()).filter(Boolean).map(x => uppercase ? x.toUpperCase() : x);
  return [...new Set(values)];
}
function assertGeographyNoConflict(patch) {
  const targetsR = new Set((patch.targetRegions || []).map(x => x.toUpperCase()));
  const excludedR = new Set((patch.excludedRegions || []).map(x => x.toUpperCase()));
  const targetsC = new Set((patch.targetCountries || []).map(x => x.toUpperCase()));
  const excludedC = new Set((patch.excludedCountries || []).map(x => x.toUpperCase()));
  for (const r of [...targetsR, ...excludedR]) if (!REGION_COUNTRIES[r]) throw Object.assign(new Error(`Unsupported region: ${r}`), { status: 400 });
  for (const c of [...targetsC, ...excludedC]) if (!/^[A-Z]{2}$/.test(c)) throw Object.assign(new Error(`Invalid country code: ${c}`), { status: 400 });
  for (const c of targetsC) if (excludedC.has(c)) throw Object.assign(new Error('Aceeasi tara nu poate fi inclusa si exclusa.'), { status: 400 });
  for (const r of targetsR) if (excludedR.has(r)) throw Object.assign(new Error('Aceeasi regiune nu poate fi inclusa si exclusa.'), { status: 400 });
  for (const r of targetsR) for (const c of excludedC) if (REGION_COUNTRIES[r].has(c)) throw Object.assign(new Error('Exista un conflict intre regiunea inclusa si o tara exclusa.'), { status: 400 });
  for (const r of excludedR) for (const c of targetsC) if (REGION_COUNTRIES[r].has(c)) throw Object.assign(new Error('Exista un conflict intre regiunea exclusa si o tara inclusa.'), { status: 400 });
}

function validateUserConfigPatch(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Object.assign(new Error('Invalid configuration payload'), { status: 400 });
  const output = {};
  const booleanKeys = ['rolePm','roleDelivery','roleService','roleScrum','roleProgram','workRemote','workHybrid','keepReposts','immediateStart','jobspipeEnabled'];
  for (const key of booleanKeys) if (key in input) {
    if (typeof input[key] !== 'boolean') throw Object.assign(new Error(`${key} must be boolean`), { status: 400 });
    output[key] = input[key];
  }
  if ('jobspipeMode' in input) {
    const value = String(input.jobspipeMode || '').toLowerCase();
    if (!['disabled','apify','direct'].includes(value)) throw Object.assign(new Error('jobspipeMode must be disabled, apify or direct'), { status: 400 });
    output.jobspipeMode = value;
  }
  const integerRules = { jobspipeApifyMaxItems:[100,20000], jobspipeDirectRunBudget:[1,1000], jobspipeDirectMonthlyGuard:[1,100000] };
  for (const [key,[min,max]] of Object.entries(integerRules)) if (key in input) {
    const value = Number(input[key]);
    if (!Number.isInteger(value) || value < min || value > max) throw Object.assign(new Error(`${key} must be ${min}-${max}`), { status: 400 });
    output[key] = value;
  }
  if ('freshness' in input) {
    const value = Number(input.freshness); if (![24,36,48,120].includes(value)) throw Object.assign(new Error('freshness must be 24, 36, 48 or 120'), { status: 400 }); output.freshness = value;
  }
  if ('fitThreshold' in input) {
    const value = Number(input.fitThreshold); if (!Number.isInteger(value) || value < 50 || value > 100) throw Object.assign(new Error('fitThreshold must be 50-100'), { status: 400 }); output.fitThreshold = value;
  }
  for (const key of ['rateMin','rateMax']) if (key in input) {
    const value = Number(input[key]); if (!Number.isFinite(value) || value < 0 || value > 5000) throw Object.assign(new Error(`${key} is invalid`), { status: 400 }); output[key] = value;
  }
  if ('rateMin' in output && 'rateMax' in output && output.rateMin > output.rateMax) throw Object.assign(new Error('rateMin cannot exceed rateMax'), { status: 400 });
  if ('exclusions' in input) output.exclusions = uniqueStrings(input.exclusions, { max: 20, maxLength: 200 });
  if ('targetRegions' in input) output.targetRegions = uniqueStrings(input.targetRegions, { max: 3, maxLength: 10, uppercase: true });
  if ('targetCountries' in input) output.targetCountries = uniqueStrings(input.targetCountries, { max: 100, maxLength: 2, uppercase: true });
  if ('excludedRegions' in input) output.excludedRegions = uniqueStrings(input.excludedRegions, { max: 3, maxLength: 10, uppercase: true });
  if ('excludedCountries' in input) output.excludedCountries = uniqueStrings(input.excludedCountries, { max: 100, maxLength: 2, uppercase: true });
  assertGeographyNoConflict(output);
  return output;
}

function applyUserConfigPatch(config, patch) {
  const groups = config.role_groups || {};
  const mapping = { rolePm:'pm', roleDelivery:'delivery', roleService:'service', roleScrum:'scrum', roleProgram:'program' };
  for (const [inputKey, groupKey] of Object.entries(mapping)) if (inputKey in patch && groups[groupKey]) groups[groupKey].enabled = patch[inputKey];
  config.role_groups = groups; config.work_modes ||= {};
  if ('workRemote' in patch) config.work_modes.remote = patch.workRemote;
  if ('workHybrid' in patch) config.work_modes.hybrid = patch.workHybrid;
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
  if ('targetCountries' in patch) { config.target_country_codes = patch.targetCountries; config.search_country_codes = patch.targetCountries; }
  if ('excludedRegions' in patch) config.excluded_regions = patch.excludedRegions;
  if ('excludedCountries' in patch) config.excluded_country_codes = patch.excludedCountries;
  delete config.jobspipe_enabled;
  return config;
}

async function updateSearchConfig(env, patch) {
  const path = env.SEARCH_CONFIG_PATH;
  const { sha, payload: config } = await readRepoJson(env, path);
  if (config.schema_version !== '1.0') throw Object.assign(new Error('Unsupported search configuration schema'), { status: 409 });
  const updated = applyUserConfigPatch(config, patch);
  return writeRepoJson(env, path, sha, updated, 'Update search config from command API');
}

function stableSourceId(url) {
  let hash = 2166136261;
  for (const char of String(url || '').toLowerCase()) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return `src-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
function normalizeSource(source) {
  const url = String(source?.url || '').trim();
  return {
    id: String(source?.id || stableSourceId(url)),
    category: String(source?.category || 'Altele').trim(),
    name: String(source?.name || 'Sursa').trim(),
    url,
    active: source?.active !== false,
    connector_available: Boolean(source?.connector_available),
  };
}
function normalizeCatalog(payload) {
  const sources = (payload?.sources || []).map(normalizeSource);
  return { schema_version: SOURCE_SCHEMA, count: sources.length, sources };
}
function validateSourceInput(input, partial = false) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Object.assign(new Error('Invalid source payload'), { status: 400 });
  const output = {};
  for (const key of ['name','url','category']) if (key in input) {
    const value = String(input[key] || '').trim();
    if (!value || value.length > 300) throw Object.assign(new Error(`${key} is invalid`), { status: 400 });
    output[key] = value;
  }
  if ('url' in output) {
    let parsed; try { parsed = new URL(output.url); } catch { throw Object.assign(new Error('URL invalid'), { status: 400 }); }
    if (!['http:','https:'].includes(parsed.protocol)) throw Object.assign(new Error('URL must use http/https'), { status: 400 });
    output.url = parsed.toString();
  }
  if ('active' in input) {
    if (typeof input.active !== 'boolean') throw Object.assign(new Error('active must be boolean'), { status: 400 });
    output.active = input.active;
  }
  if (!partial && (!output.name || !output.url || !output.category)) throw Object.assign(new Error('name, url and category are required'), { status: 400 });
  return output;
}
function sameUrl(a, b) {
  try { return new URL(a).toString().toLowerCase() === new URL(b).toString().toLowerCase(); } catch { return String(a).toLowerCase() === String(b).toLowerCase(); }
}
async function mutateSources(env, mutation) {
  const path = env.SOURCES_PATH || 'data/sources.json';
  const { sha, payload } = await readRepoJson(env, path);
  const catalog = normalizeCatalog(payload);
  const updated = mutation(catalog);
  updated.count = updated.sources.length;
  const result = await writeRepoJson(env, path, sha, updated, 'Update source registry from command API');
  return { catalog: updated, commit: result?.commit?.sha || null };
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') {
      if (request.headers.get('Origin') !== env.FRONTEND_ORIGIN) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: cors });
    }
    try {
      const url = new URL(request.url);
      if (request.method === 'GET' && url.pathname === '/health') return json({ status:'ok', auth_configured:googleConfigured(env), github_configured:Boolean(env.GITHUB_TOKEN) }, 200, cors);
      if (request.method === 'GET' && url.pathname === '/auth/config') return json({ client_id:env.GOOGLE_CLIENT_ID || null, configured:googleConfigured(env) }, googleConfigured(env) ? 200 : 503, cors);
      assertAllowedOrigin(request, env);
      if (request.method === 'POST' && url.pathname === '/auth/session') {
        const user = await authenticate(request, env); return json({ status:'ok', email:user.email || null }, 200, cors);
      }
      const user = await authenticate(request, env);
      if (request.method === 'POST' && url.pathname === '/commands/run') {
        await dispatchRun(env); return json({ status:'accepted', requested_by:user.sub }, 202, cors);
      }
      if (request.method === 'PUT' && url.pathname === '/config') {
        const input = validateUserConfigPatch(await request.json()); const result = await updateSearchConfig(env, input);
        return json({ status:'saved', commit:result?.commit?.sha || null }, 200, cors);
      }
      if (request.method === 'POST' && url.pathname === '/sources') {
        const source = validateSourceInput(await request.json(), false);
        const result = await mutateSources(env, catalog => {
          if (catalog.sources.some(item => sameUrl(item.url, source.url))) throw Object.assign(new Error('Exista deja o sursa cu acest URL. Editeaza intrarea existenta.'), { status: 409 });
          catalog.sources.push({ id:`src-${crypto.randomUUID()}`, ...source, connector_available:false }); return catalog;
        });
        return json({ status:'created', commit:result.commit, catalog:result.catalog }, 201, cors);
      }
      const sourceMatch = url.pathname.match(/^\/sources\/([^/]+)$/);
      if (sourceMatch && request.method === 'PUT') {
        const id = decodeURIComponent(sourceMatch[1]); const patch = validateSourceInput(await request.json(), true);
        const result = await mutateSources(env, catalog => {
          const index = catalog.sources.findIndex(item => item.id === id); if (index < 0) throw Object.assign(new Error('Sursa nu a fost gasita.'), { status: 404 });
          const next = { ...catalog.sources[index], ...patch };
          if (patch.url && catalog.sources.some((item, i) => i !== index && sameUrl(item.url, patch.url))) throw Object.assign(new Error('Exista deja o sursa cu acest URL.'), { status: 409 });
          next.id = catalog.sources[index].id; next.connector_available = catalog.sources[index].connector_available; catalog.sources[index] = next; return catalog;
        });
        return json({ status:'saved', commit:result.commit, catalog:result.catalog }, 200, cors);
      }
      if (sourceMatch && request.method === 'DELETE') {
        const id = decodeURIComponent(sourceMatch[1]);
        const result = await mutateSources(env, catalog => {
          const before = catalog.sources.length; catalog.sources = catalog.sources.filter(item => item.id !== id);
          if (catalog.sources.length === before) throw Object.assign(new Error('Sursa nu a fost gasita.'), { status: 404 }); return catalog;
        });
        return json({ status:'deleted', commit:result.commit, catalog:result.catalog }, 200, cors);
      }
      return json({ error:'Not found' }, 404, cors);
    } catch (error) {
      const code = String(error?.code || ''); const jwtFailure = code.startsWith('ERR_JWT') || code.startsWith('ERR_JWS');
      const status = Number(error?.status) || (jwtFailure ? 401 : 500); const publicMessage = status >= 500 ? 'Command API error' : error.message;
      console.error(error); return json({ error:publicMessage }, status, cors);
    }
  },
};
