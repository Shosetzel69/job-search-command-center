import { createRemoteJWKSet, jwtVerify } from 'jose';

const GOOGLE_JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const GITHUB_API_VERSION = '2026-03-10';

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

function html(body, status = 200, headers = {}) {
  return new Response(body, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
      ...headers,
    },
  });
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  if (!origin || origin !== env.FRONTEND_ORIGIN) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
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

async function verifyGoogleToken(request, env) {
  if (!env.GOOGLE_CLIENT_ID || env.GOOGLE_CLIENT_ID.includes('REPLACE_WITH_')) {
    throw Object.assign(new Error('Google OAuth client is not configured'), { status: 503 });
  }

  const authorization = request.headers.get('Authorization') || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) throw Object.assign(new Error('Missing Google ID token'), { status: 401 });

  const { payload } = await jwtVerify(match[1], GOOGLE_JWKS, {
    issuer: ['https://accounts.google.com', 'accounts.google.com'],
    audience: env.GOOGLE_CLIENT_ID,
  });
  return payload;
}

async function authenticate(request, env) {
  const payload = await verifyGoogleToken(request, env);
  if (!env.ALLOWED_GOOGLE_SUB) {
    throw Object.assign(new Error('Authorization bootstrap incomplete'), { status: 503 });
  }
  if (!payload.sub || payload.sub !== env.ALLOWED_GOOGLE_SUB) {
    throw Object.assign(new Error('User not authorized'), { status: 403 });
  }
  return payload;
}

function bootstrapPage(env) {
  const clientId = String(env.GOOGLE_CLIENT_ID || '');
  if (!clientId || clientId.includes('REPLACE_WITH_')) {
    return html('<h1>Google OAuth client is not configured</h1>', 503);
  }
  if (env.ALLOWED_GOOGLE_SUB) {
    return html('<h1>Bootstrap disabled</h1><p>ALLOWED_GOOGLE_SUB is already configured.</p>', 404);
  }

  const safeClientId = clientId.replace(/[<>&"']/g, '');
  return html(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Job Search Auth Bootstrap</title>
  <script src="https://accounts.google.com/gsi/client" async defer></script>
  <style>
    body{font-family:system-ui,sans-serif;max-width:720px;margin:60px auto;padding:0 20px;line-height:1.5}
    pre{padding:16px;background:#f4f4f4;border-radius:8px;overflow:auto}
  </style>
</head>
<body>
  <h1>Authorize Job Search Command Center</h1>
  <p>Sign in with the Google account that should be allowed to run searches and save configuration.</p>
  <div id="button"></div>
  <pre id="result">Waiting for Google sign-in…</pre>
  <script>
    window.onload = () => {
      google.accounts.id.initialize({
        client_id: '${safeClientId}',
        callback: async ({credential}) => {
          const result = document.getElementById('result');
          result.textContent = 'Verifying…';
          const response = await fetch('/auth/whoami', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + credential }
          });
          const body = await response.json();
          result.textContent = JSON.stringify(body, null, 2);
        }
      });
      google.accounts.id.renderButton(document.getElementById('button'), {theme:'outline',size:'large'});
    };
  </script>
</body>
</html>`);
}

function githubHeaders(env) {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    'X-GitHub-Api-Version': GITHUB_API_VERSION,
    'User-Agent': 'job-search-command-api',
  };
}

function githubBase(env) {
  return `https://api.github.com/repos/${encodeURIComponent(env.GITHUB_OWNER)}/${encodeURIComponent(env.GITHUB_REPO)}`;
}

async function githubRequest(env, path, init = {}) {
  const response = await fetch(`${githubBase(env)}${path}`, {
    ...init,
    headers: { ...githubHeaders(env), ...(init.headers || {}) },
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 1000);
    throw Object.assign(new Error(`GitHub ${response.status}: ${detail}`), { status: 502 });
  }
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function hasActiveRun(env) {
  const workflow = encodeURIComponent(env.GITHUB_WORKFLOW);
  const payload = await githubRequest(env, `/actions/workflows/${workflow}/runs?per_page=10`);
  return (payload?.workflow_runs || []).some((run) => run.status === 'queued' || run.status === 'in_progress');
}

async function dispatchRun(env) {
  if (await hasActiveRun(env)) {
    throw Object.assign(new Error('A search run is already queued or running'), { status: 409 });
  }
  const workflow = encodeURIComponent(env.GITHUB_WORKFLOW);
  return githubRequest(env, `/actions/workflows/${workflow}/dispatches`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: env.GITHUB_REF }),
  });
}

function decodeBase64Utf8(value) {
  const cleaned = value.replace(/\n/g, '');
  const binary = atob(cleaned);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function encodeBase64Utf8(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function validateUserConfigPatch(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw Object.assign(new Error('Invalid configuration payload'), { status: 400 });
  }

  const output = {};
  const booleanKeys = ['rolePm', 'roleDelivery', 'roleService', 'roleScrum', 'roleProgram', 'workRemote', 'workHybrid', 'keepReposts', 'immediateStart'];
  for (const key of booleanKeys) {
    if (key in input) {
      if (typeof input[key] !== 'boolean') throw Object.assign(new Error(`${key} must be boolean`), { status: 400 });
      output[key] = input[key];
    }
  }

  if ('freshness' in input) {
    const value = Number(input.freshness);
    if (![24, 48].includes(value)) throw Object.assign(new Error('freshness must be 24 or 48'), { status: 400 });
    output.freshness = value;
  }
  if ('fitThreshold' in input) {
    const value = Number(input.fitThreshold);
    if (!Number.isInteger(value) || value < 50 || value > 100) throw Object.assign(new Error('fitThreshold must be 50-100'), { status: 400 });
    output.fitThreshold = value;
  }
  for (const [key, min, max] of [['rateMin', 0, 5000], ['rateMax', 0, 5000]]) {
    if (key in input) {
      const value = Number(input[key]);
      if (!Number.isFinite(value) || value < min || value > max) throw Object.assign(new Error(`${key} is invalid`), { status: 400 });
      output[key] = value;
    }
  }
  if ('rateMin' in output && 'rateMax' in output && output.rateMin > output.rateMax) {
    throw Object.assign(new Error('rateMin cannot exceed rateMax'), { status: 400 });
  }
  if ('exclusions' in input) {
    if (!Array.isArray(input.exclusions) || input.exclusions.length > 20 || input.exclusions.some((x) => typeof x !== 'string' || x.length > 200)) {
      throw Object.assign(new Error('exclusions must be an array of at most 20 short strings'), { status: 400 });
    }
    output.exclusions = [...new Set(input.exclusions.map((x) => x.trim()).filter(Boolean))];
  }
  return output;
}

function applyUserConfigPatch(config, patch) {
  const groups = config.role_groups || {};
  const mapping = {
    rolePm: 'pm',
    roleDelivery: 'delivery',
    roleService: 'service',
    roleScrum: 'scrum',
    roleProgram: 'program',
  };
  for (const [inputKey, groupKey] of Object.entries(mapping)) {
    if (inputKey in patch && groups[groupKey]) groups[groupKey].enabled = patch[inputKey];
  }
  config.role_groups = groups;

  config.work_modes ||= {};
  if ('workRemote' in patch) config.work_modes.remote = patch.workRemote;
  if ('workHybrid' in patch) config.work_modes.hybrid = patch.workHybrid;
  if ('freshness' in patch) config.freshness_hours = patch.freshness;
  if ('fitThreshold' in patch) config.fit_threshold = patch.fitThreshold;
  if ('keepReposts' in patch) config.keep_reposts = patch.keepReposts;
  if ('rateMin' in patch) config.rate_min_eur_day = patch.rateMin;
  if ('rateMax' in patch) config.rate_max_eur_day = patch.rateMax;
  if ('immediateStart' in patch) config.immediate_start = patch.immediateStart;
  if ('exclusions' in patch) config.exclusions = patch.exclusions;
  return config;
}

async function updateSearchConfig(env, patch) {
  const path = env.SEARCH_CONFIG_PATH;
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  const current = await githubRequest(env, `/contents/${encodedPath}?ref=${encodeURIComponent(env.GITHUB_REF)}`);
  if (!current?.sha || !current?.content) throw Object.assign(new Error('Current search configuration could not be loaded'), { status: 502 });

  const config = JSON.parse(decodeBase64Utf8(current.content));
  if (config.schema_version !== '1.0') throw Object.assign(new Error('Unsupported search configuration schema'), { status: 409 });
  const updated = applyUserConfigPatch(config, patch);

  return githubRequest(env, `/contents/${encodedPath}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'Update search config from command API',
      content: encodeBase64Utf8(`${JSON.stringify(updated, null, 2)}\n`),
      sha: current.sha,
      branch: env.GITHUB_REF,
    }),
  });
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
      if (request.method === 'GET' && url.pathname === '/health') {
        return json({ status: 'ok' }, 200, cors);
      }

      if (request.method === 'GET' && url.pathname === '/auth/bootstrap') {
        return bootstrapPage(env);
      }

      if (request.method === 'POST' && url.pathname === '/auth/whoami') {
        if (env.ALLOWED_GOOGLE_SUB) return json({ error: 'Bootstrap disabled' }, 404, cors);
        assertAllowedOrigin(request, env);
        const user = await verifyGoogleToken(request, env);
        return json({ sub: user.sub, email: user.email || null }, 200, cors);
      }

      assertAllowedOrigin(request, env);
      const user = await authenticate(request, env);

      if (request.method === 'POST' && url.pathname === '/commands/run') {
        const run = await dispatchRun(env);
        return json({ status: 'accepted', requested_by: user.sub, workflow_run: run || null }, 202, cors);
      }

      if (request.method === 'PUT' && url.pathname === '/config') {
        const input = validateUserConfigPatch(await request.json());
        const result = await updateSearchConfig(env, input);
        return json({ status: 'saved', commit: result?.commit?.sha || null }, 200, cors);
      }

      return json({ error: 'Not found' }, 404, cors);
    } catch (error) {
      const status = Number(error?.status) || (error?.code === 'ERR_JWT_EXPIRED' ? 401 : 500);
      const publicMessage = status >= 500 ? 'Command API error' : error.message;
      console.error(error);
      return json({ error: publicMessage }, status, cors);
    }
  },
};
