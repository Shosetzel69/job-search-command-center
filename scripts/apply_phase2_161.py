#!/usr/bin/env python3
from pathlib import Path
import json
import re


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"pattern not found in {path}: {old[:120]!r}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


def regex_once(path, pattern, replacement):
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f"regex expected once in {path}, got {count}: {pattern}")
    p.write_text(updated, encoding="utf-8")


Path("command-api/src/environment-config.js").write_text(r'''const ENVIRONMENTS = new Set(['dev', 'test', 'prod']);
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

export function assertEnvironmentConfig(env = {}, buildIdentity = {}) {
  const appEnv = requiredString(env.APP_ENV, 'APP_ENV').toLowerCase();
  if (!ENVIRONMENTS.has(appEnv)) throw configError('APP_ENV must be dev, test or prod');

  const runtimeOwner = requiredString(env.GITHUB_RUNTIME_OWNER, 'GITHUB_RUNTIME_OWNER');
  const runtimeRepo = requiredString(env.GITHUB_RUNTIME_REPO, 'GITHUB_RUNTIME_REPO');
  const runtimeRef = requiredString(env.GITHUB_RUNTIME_REF, 'GITHUB_RUNTIME_REF');
  const workflow = requiredString(env.GITHUB_WORKFLOW, 'GITHUB_WORKFLOW');
  const sourceSha = identitySha('SOURCE_SHA', env.SOURCE_SHA, buildIdentity.sourceSha);
  const runtimeDataSha = identitySha('RUNTIME_DATA_SHA', env.RUNTIME_DATA_SHA, buildIdentity.runtimeDataSha);
  const searchMode = requiredString(env.SEARCH_MODE, 'SEARCH_MODE').toLowerCase();
  if (!SEARCH_MODES.has(searchMode)) throw configError('SEARCH_MODE must be disabled, smoke or live');
  if (appEnv === 'prod' && searchMode !== 'live') throw configError('PROD requires SEARCH_MODE=live');
  if (appEnv !== 'prod' && searchMode === 'live') throw configError('DEV/TEST cannot use SEARCH_MODE=live');

  const frontendOrigin = requiredOrigin(env.FRONTEND_ORIGIN);
  return Object.freeze({
    appEnv,
    runtimeOwner,
    runtimeRepo,
    runtimeRef,
    workflow,
    sourceSha,
    runtimeDataSha,
    searchMode,
    frontendOrigin,
    runtimeRepository: `${runtimeOwner}/${runtimeRepo}`,
  });
}

export { SHA_RE };
''', encoding="utf-8")

Path("command-api/src/runtime-github.js").write_text(r'''const GITHUB_API_VERSION = '2026-03-10';

function githubHeaders(env) {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    'X-GitHub-Api-Version': GITHUB_API_VERSION,
    'User-Agent': 'job-search-command-api',
  };
}

export function runtimeGithubBase(runtime) {
  return `https://api.github.com/repos/${encodeURIComponent(runtime.runtimeOwner)}/${encodeURIComponent(runtime.runtimeRepo)}`;
}

export async function runtimeGithubRequest(env, runtime, path, init = {}) {
  if (!env.GITHUB_TOKEN) throw Object.assign(new Error('GitHub token is not configured'), { status: 503 });
  const response = await fetch(`${runtimeGithubBase(runtime)}${path}`, {
    ...init,
    headers: { ...githubHeaders(env), ...(init.headers || {}) },
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 1000);
    const status = response.status === 409 ? 409 : 502;
    throw Object.assign(new Error(`GitHub ${response.status}: ${detail}`), { status });
  }
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

function decodeBase64Utf8(value) {
  const binary = atob(String(value || '').replace(/\n/g, ''));
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function encodeBase64Utf8(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function encodePath(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}

export async function readRuntimeJson(env, runtime, path) {
  const current = await runtimeGithubRequest(env, runtime, `/contents/${encodePath(path)}?ref=${encodeURIComponent(runtime.runtimeRef)}`);
  if (!current?.sha || !current?.content) {
    throw Object.assign(new Error(`Repository file could not be loaded: ${path}`), { status: 502 });
  }
  return { sha: current.sha, payload: JSON.parse(decodeBase64Utf8(current.content)) };
}

export async function writeRuntimeJson(env, runtime, path, sha, payload, message) {
  return runtimeGithubRequest(env, runtime, `/contents/${encodePath(path)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      content: encodeBase64Utf8(`${JSON.stringify(payload, null, 2)}\n`),
      sha,
      branch: runtime.runtimeRef,
    }),
  });
}

export async function hasActiveWorkflowRun(env, runtime) {
  const workflow = encodeURIComponent(runtime.workflow);
  const payload = await runtimeGithubRequest(env, runtime, `/actions/workflows/${workflow}/runs?per_page=10`);
  return (payload?.workflow_runs || []).some(run => run.status === 'queued' || run.status === 'in_progress');
}

export async function dispatchWorkflow(env, runtime, runTrigger = 'manual-ui', checkActive = true) {
  if (checkActive && await hasActiveWorkflowRun(env, runtime)) {
    throw Object.assign(new Error('A search run is already queued or running'), { status: 409 });
  }
  if (!['manual-ui', 'scheduled', 'system'].includes(runTrigger)) {
    throw Object.assign(new Error('Invalid run trigger'), { status: 400 });
  }
  const workflow = encodeURIComponent(runtime.workflow);
  return runtimeGithubRequest(env, runtime, `/actions/workflows/${workflow}/dispatches`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ref: runtime.runtimeRef,
      inputs: { run_trigger: runTrigger, source_sha: runtime.sourceSha },
    }),
  });
}
''', encoding="utf-8")

Path("command-api/src/build-identity.generated.js").write_text(
    "export const BUILD_IDENTITY = Object.freeze({\n  sourceSha: null,\n  runtimeDataSha: null,\n});\n",
    encoding="utf-8",
)

Path("command-api/scripts/write-build-identity.mjs").write_text(r'''import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SHA_RE = /^[0-9a-f]{40}$/i;
const projectDir = process.cwd();
const repoRoot = resolve(projectDir, '..');
const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim().toLowerCase();
if (!SHA_RE.test(sourceSha)) throw new Error('Could not resolve immutable SOURCE_SHA from git HEAD');

const requestedSourceSha = String(process.env.SOURCE_SHA || '').trim().toLowerCase();
if (requestedSourceSha && requestedSourceSha !== sourceSha) {
  throw new Error(`SOURCE_SHA ${requestedSourceSha} does not match checked-out source ${sourceSha}`);
}

// Phase 2 transition: runtime data are built from the same repository checkout.
// Phase 3 must provide RUNTIME_DATA_SHA explicitly once runtime repositories are separated.
const runtimeDataSha = String(process.env.RUNTIME_DATA_SHA || sourceSha).trim().toLowerCase();
if (!SHA_RE.test(runtimeDataSha)) throw new Error('RUNTIME_DATA_SHA must be a full 40-character commit SHA');

const output = `export const BUILD_IDENTITY = Object.freeze({\n  sourceSha: '${sourceSha}',\n  runtimeDataSha: '${runtimeDataSha}',\n});\n`;
writeFileSync(resolve(projectDir, 'src/build-identity.generated.js'), output, 'utf8');
console.log(`Build identity: SOURCE_SHA=${sourceSha} RUNTIME_DATA_SHA=${runtimeDataSha}`);
''', encoding="utf-8")

# Command API uses shared environment identity + runtime transport.
replace_once(
    "command-api/src/index.js",
    "} from './source-governance.js';\n\nconst GOOGLE_JWKS",
    "} from './source-governance.js';\nimport { assertEnvironmentConfig } from './environment-config.js';\nimport { BUILD_IDENTITY } from './build-identity.generated.js';\nimport { dispatchWorkflow, hasActiveWorkflowRun, readRuntimeJson, writeRuntimeJson } from './runtime-github.js';\n\nconst GOOGLE_JWKS",
)
replace_once("command-api/src/index.js", "const GITHUB_API_VERSION = '2026-03-10';\n", "")
regex_once(
    "command-api/src/index.js",
    r"function githubHeaders\(env\) \{.*?async function readNomenclatures\(env\) \{",
    """function runtimeConfig(env) {\n  return assertEnvironmentConfig(env, BUILD_IDENTITY);\n}\n\nasync function hasActiveRun(env) {\n  return hasActiveWorkflowRun(env, runtimeConfig(env));\n}\n\nasync function dispatchRun(env, runTrigger = 'manual-ui', checkActive = true) {\n  return dispatchWorkflow(env, runtimeConfig(env), runTrigger, checkActive);\n}\n\nasync function readRepoJson(env, path) {\n  return readRuntimeJson(env, runtimeConfig(env), path);\n}\n\nasync function writeRepoJson(env, path, sha, payload, message) {\n  return writeRuntimeJson(env, runtimeConfig(env), path, sha, payload, message);\n}\n\nasync function readNomenclatures(env) {""",
)
replace_once(
    "command-api/src/index.js",
    "export default {\n  async fetch(request, env) {\n    const cors = corsHeaders(request, env);\n    if (request.method === 'OPTIONS') {\n      if (request.headers.get('Origin') !== env.FRONTEND_ORIGIN) return new Response(null, { status: 403 });\n      return new Response(null, { status: 204, headers: cors });\n    }\n\n    try {\n      const url = new URL(request.url);\n      if (request.method === 'GET' && url.pathname === '/health') {\n        return json({ status:'ok', auth_configured:googleConfigured(env), github_configured:Boolean(env.GITHUB_TOKEN) }, 200, cors);\n      }",
    "export default {\n  async fetch(request, env) {\n    let cors = {};\n    try {\n      const runtime = runtimeConfig(env);\n      cors = corsHeaders(request, env);\n      if (request.method === 'OPTIONS') {\n        if (request.headers.get('Origin') !== runtime.frontendOrigin) return new Response(null, { status: 403 });\n        return new Response(null, { status: 204, headers: cors });\n      }\n\n      const url = new URL(request.url);\n      if (request.method === 'GET' && url.pathname === '/health') {\n        return json({\n          status:'ok',\n          environment:runtime.appEnv,\n          source_sha:runtime.sourceSha,\n          runtime_repo:runtime.runtimeRepository,\n          runtime_ref:runtime.runtimeRef,\n          runtime_data_sha:runtime.runtimeDataSha,\n          search_mode:runtime.searchMode,\n          auth_configured:googleConfigured(env),\n          github_configured:Boolean(env.GITHUB_TOKEN),\n        }, 200, cors);\n      }",
)
replace_once(
    "command-api/src/index.js",
    "      if (request.method === 'POST' && url.pathname === '/commands/run') {\n        if (await hasActiveRun(env)) throw Object.assign(new Error('A search run is already queued or running'), { status: 409 });",
    "      if (request.method === 'POST' && url.pathname === '/commands/run') {\n        if (runtime.searchMode !== 'live') throw Object.assign(new Error('Full search is disabled for this environment'), { status: 409 });\n        if (await hasActiveRun(env)) throw Object.assign(new Error('A search run is already queued or running'), { status: 409 });",
)
replace_once(
    "command-api/src/index.js",
    "        return json({ status:'accepted', requested_by:user.sub, trigger:'manual-ui', config_commit:configCommit }, 202, cors);",
    "        return json({ status:'accepted', requested_by:user.sub, trigger:'manual-ui', source_sha:runtime.sourceSha, config_commit:configCommit }, 202, cors);",
)

# Nomenclature API uses exactly the same runtime GitHub mechanism.
replace_once(
    "command-api/src/nomenclature-api.js",
    "} from './nomenclature-governance.js';\n\nconst GITHUB_API_VERSION = '2026-03-10';",
    "} from './nomenclature-governance.js';\nimport { assertEnvironmentConfig } from './environment-config.js';\nimport { BUILD_IDENTITY } from './build-identity.generated.js';\nimport { readRuntimeJson, writeRuntimeJson } from './runtime-github.js';",
)
regex_once(
    "command-api/src/nomenclature-api.js",
    r"function githubHeaders\(env\) \{.*?async function readCatalog\(env\) \{",
    """function runtimeConfig(env) {\n  return assertEnvironmentConfig(env, BUILD_IDENTITY);\n}\n\nasync function readRepoJson(env, path) {\n  return readRuntimeJson(env, runtimeConfig(env), path);\n}\n\nasync function writeRepoJson(env, path, sha, payload, message) {\n  const result = await writeRuntimeJson(env, runtimeConfig(env), path, sha, payload, message);\n  return result?.commit?.sha || null;\n}\n\nasync function readCatalog(env) {""",
)
replace_once(
    "command-api/src/nomenclature-api.js",
    "  async fetch(request, env) {\n    try {\n      const url = new URL(request.url);",
    "  async fetch(request, env) {\n    try {\n      runtimeConfig(env);\n      const url = new URL(request.url);",
)

# Build identity is generated from exact checkout, never committed stale.
package_path = Path("command-api/package.json")
package = json.loads(package_path.read_text(encoding="utf-8"))
package["scripts"]["build:identity"] = "node scripts/write-build-identity.mjs"
package["scripts"]["build"] = "npm run build:identity && npm run build:frontend && node scripts/build-static.mjs"
package_path.write_text(json.dumps(package, indent=2) + "\n", encoding="utf-8")

# Transitional PROD mapping; immutable SHAs come from the real build checkout.
wrangler = Path("command-api/wrangler.jsonc")
text = wrangler.read_text(encoding="utf-8")
text = text.replace(
    '    "FRONTEND_ORIGIN": "https://job-search-command-api.myeboda.workers.dev",\n    "GITHUB_OWNER": "Shosetzel69",\n    "GITHUB_REPO": "job-search-command-center",\n    "GITHUB_REF": "main",\n    "GITHUB_WORKFLOW": "job-search-full.yml",',
    '    "APP_ENV": "prod",\n    "FRONTEND_ORIGIN": "https://job-search-command-api.myeboda.workers.dev",\n    "GITHUB_RUNTIME_OWNER": "Shosetzel69",\n    "GITHUB_RUNTIME_REPO": "job-search-command-center",\n    "GITHUB_RUNTIME_REF": "main",\n    "GITHUB_WORKFLOW": "job-search-full.yml",\n    "SEARCH_MODE": "live",',
)
if '"GITHUB_OWNER"' in text or '"GITHUB_REPO"' in text or re.search(r'"GITHUB_REF"\s*:', text):
    raise SystemExit("legacy GitHub runtime variables remain in wrangler config")
wrangler.write_text(text, encoding="utf-8")

# Full search executes exact source SHA while Phase 2 runtime data still come from dispatch ref.
Path(".github/workflows/job-search-full.yml").write_text(r'''name: Full job search

on:
  workflow_dispatch:
    inputs:
      run_trigger:
        description: Canonical run trigger
        required: false
        default: manual-ui
        type: choice
        options:
          - manual-ui
          - scheduled
          - system
      source_sha:
        description: Immutable source commit SHA accepted by the Worker
        required: true
        type: string

concurrency:
  group: full-job-search
  cancel-in-progress: false

permissions:
  contents: write

jobs:
  collect-filter-publish-data:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    env:
      JOBSPIPE_API_KEY: ${{ secrets.JOBSPIPE_API_KEY }}
      APIFY_TOKEN: ${{ secrets.APIFY_TOKEN }}
      RUN_TRIGGER: ${{ inputs.run_trigger || 'manual-ui' }}
      SOURCE_SHA: ${{ inputs.source_sha }}
      RUNTIME_REF: ${{ github.ref_name }}
      PUBLISH_BRANCH: ${{ github.ref_name }}
    steps:
      - name: Validate source identity
        run: |
          if [[ ! "$SOURCE_SHA" =~ ^[0-9a-fA-F]{40}$ ]]; then
            echo "source_sha must be a full immutable commit SHA" >&2
            exit 1
          fi

      - name: Check out exact source commit
        uses: actions/checkout@v4
        with:
          ref: ${{ inputs.source_sha }}
          fetch-depth: 0

      - name: Verify source checkout and load runtime data snapshot
        run: |
          actual="$(git rev-parse HEAD)"
          if [ "${actual,,}" != "${SOURCE_SHA,,}" ]; then
            echo "Checked-out source SHA does not match requested source_sha" >&2
            exit 1
          fi
          git fetch origin "$RUNTIME_REF"
          runtime_sha="$(git rev-parse "origin/$RUNTIME_REF")"
          echo "PUBLISH_BASE_SHA=$runtime_sha" >> "$GITHUB_ENV"
          git checkout "origin/$RUNTIME_REF" -- data

      - name: Validate search engine syntax
        run: python3 -m py_compile scripts/job_search.py scripts/job_search_optimized.py scripts/job_search_apify.py scripts/job_search_runner.py scripts/source_orchestration.py scripts/job_search_web.py scripts/web_browser.py scripts/web_transport.py scripts/test_publish_concurrency.py

      - name: Install browser fallback
        run: |
          python3 -m pip install --disable-pip-version-check -r requirements-search.txt
          python3 -m playwright install --with-deps chromium

      - name: Collect, normalize, filter and score
        id: search
        continue-on-error: true
        run: python3 scripts/job_search_runner.py

      - name: Validate published JSON contract
        if: always()
        run: python3 scripts/job_search_runner.py --validate-only

      - name: Save results and run status safely
        if: always()
        run: bash scripts/publish_results.sh

      - name: Mark total collection failure
        if: steps.search.outcome != 'success'
        run: |
          echo "All configured collection queries failed. Run status was persisted."
          exit 1
''', encoding="utf-8")

# Publication concurrency baseline is the explicit runtime snapshot, not the source checkout.
replace_once(
    "scripts/publish_results.sh",
    'base_sha="$(git rev-parse HEAD)"',
    'base_sha="${PUBLISH_BASE_SHA:-$(git rev-parse HEAD)}"',
)

# Run state carries exact source identity.
replace_once(
    "scripts/job_search_runner.py",
    '    trigger = os.environ.get("RUN_TRIGGER") or os.environ.get("GITHUB_EVENT_NAME") or "unknown"\n    status["trigger"] = trigger\n',
    '    trigger = os.environ.get("RUN_TRIGGER") or os.environ.get("GITHUB_EVENT_NAME") or "unknown"\n    source_sha = (os.environ.get("SOURCE_SHA") or "").strip().lower()\n    status["trigger"] = trigger\n    if source_sha:\n        status["source_sha"] = source_sha\n',
)
replace_once(
    "scripts/job_search_runner.py",
    '        "trigger": trigger,\n        "started_at": status.get("started_at"),',
    '        "trigger": trigger,\n        "source_sha": status.get("source_sha"),\n        "started_at": status.get("started_at"),',
)

# Frontend environment marker is driven by public /health identity.
Path("frontend/src/environment-marker.mjs").write_text(r'''export function environmentBadge(environment) {
  const value = String(environment || '').trim().toLowerCase();
  if (value === 'dev') return 'DEV';
  if (value === 'test') return 'TEST';
  return null;
}
''', encoding="utf-8")
replace_once(
    "frontend/src/main.jsx",
    "import { googleIdentityOptions, readGoogleLoginHint, rememberGoogleLoginHint } from './auth-session.mjs';\nimport { reviewRowsForFilters } from './review-selection.mjs';",
    "import { googleIdentityOptions, readGoogleLoginHint, rememberGoogleLoginHint } from './auth-session.mjs';\nimport { environmentBadge } from './environment-marker.mjs';\nimport { reviewRowsForFilters } from './review-selection.mjs';",
)
replace_once(
    "frontend/src/main.jsx",
    "function Header({view,email,running,onRun,onLogout}){const titles={jobs:'Joburi noi',review:'De evaluat',applications:'Aplicari',criteria:'Criterii de selectie',admin:'Administrare'};const date=new Intl.DateTimeFormat('ro-RO',{weekday:'long',day:'numeric',month:'long',timeZone:'Europe/Bucharest'}).format(new Date()).toUpperCase();return<header className=\"flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between\"><div><div className=\"text-xs font-semibold tracking-[0.16em] text-slate-400\">{date}</div><h1 className=\"mt-1 font-display text-2xl font-bold tracking-tight text-slate-950\">{titles[view]}</h1></div><div className=\"flex items-center gap-2\"><button",
    "function EnvironmentMarker({environment,className=''}){const label=environmentBadge(environment);if(!label)return null;return<span className={cx('inline-flex rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-bold tracking-wide text-amber-800',className)}>{`[ ${label} ]`}</span>;}\nfunction Header({view,email,running,onRun,onLogout,environment}){const titles={jobs:'Joburi noi',review:'De evaluat',applications:'Aplicari',criteria:'Criterii de selectie',admin:'Administrare'};const date=new Intl.DateTimeFormat('ro-RO',{weekday:'long',day:'numeric',month:'long',timeZone:'Europe/Bucharest'}).format(new Date()).toUpperCase();return<header className=\"flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between\"><div><div className=\"text-xs font-semibold tracking-[0.16em] text-slate-400\">{date}</div><div className=\"mt-1 flex items-center gap-2\"><h1 className=\"font-display text-2xl font-bold tracking-tight text-slate-950\">{titles[view]}</h1><EnvironmentMarker environment={environment}/></div></div><div className=\"flex items-center gap-2\"><button",
)
replace_once(
    "frontend/src/main.jsx",
    "  const[clientId,setClientId]=useState(null),[auth,setAuth]=useState({status:'signed-out',token:null,email:null,error:null}),[dataState,setDataState]=useState({status:'idle',error:null});",
    "  const[clientId,setClientId]=useState(null),[environment,setEnvironment]=useState(null),[auth,setAuth]=useState({status:'signed-out',token:null,email:null,error:null}),[dataState,setDataState]=useState({status:'idle',error:null});",
)
replace_once(
    "frontend/src/main.jsx",
    "  useEffect(()=>{commandApi('/auth/config',null).then(config=>{if(!config?.configured||!config?.client_id)throw new Error('Autentificarea Google nu este configurata complet.');setClientId(config.client_id);}).catch(error=>setAuth(current=>({...current,error:error.message})));},[]);",
    "  useEffect(()=>{Promise.all([commandApi('/auth/config',null),commandApi('/health',null)]).then(([config,health])=>{if(!config?.configured||!config?.client_id)throw new Error('Autentificarea Google nu este configurata complet.');setClientId(config.client_id);setEnvironment(health?.environment||null);}).catch(error=>setAuth(current=>({...current,error:error.message})));},[]);",
)
replace_once(
    "frontend/src/main.jsx",
    "  if(auth.status!=='authenticated')return<><SignedOutScreen clientId={clientId} loginHint={loginHint} allowAutoRestore={allowAutoRestore} authError={auth.error} authStatus={auth.status} onCredential={handleCredential}/><Toast toast={toast}/></>;",
    "  if(auth.status!=='authenticated')return<><SignedOutScreen clientId={clientId} loginHint={loginHint} allowAutoRestore={allowAutoRestore} authError={auth.error} authStatus={auth.status} onCredential={handleCredential}/><EnvironmentMarker environment={environment} className=\"fixed left-4 top-4 z-50\"/><Toast toast={toast}/></>;",
)
replace_once(
    "frontend/src/main.jsx",
    "<Header view={view} email={auth.email} running={running} onRun={runSearch} onLogout={logout}/>",
    "<Header view={view} email={auth.email} running={running} onRun={runSearch} onLogout={logout} environment={environment}/>",
)

# Tests.
Path("command-api/test/environment-config.test.mjs").write_text(r'''import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertEnvironmentConfig } from '../src/environment-config.js';
import commandApi from '../src/index.js';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const base = {
  APP_ENV: 'prod',
  FRONTEND_ORIGIN: 'https://app.example.test',
  GITHUB_RUNTIME_OWNER: 'runtime-owner',
  GITHUB_RUNTIME_REPO: 'runtime-repo',
  GITHUB_RUNTIME_REF: 'main',
  GITHUB_WORKFLOW: 'job-search-full.yml',
  SOURCE_SHA: SHA_A,
  RUNTIME_DATA_SHA: SHA_B,
  SEARCH_MODE: 'live',
};

test('environment contract accepts explicit PROD identity', () => {
  const config = assertEnvironmentConfig(base);
  assert.equal(config.appEnv, 'prod');
  assert.equal(config.runtimeRepository, 'runtime-owner/runtime-repo');
  assert.equal(config.runtimeRef, 'main');
  assert.equal(config.sourceSha, SHA_A);
  assert.equal(config.runtimeDataSha, SHA_B);
  assert.equal(config.searchMode, 'live');
  assert.equal(Object.isFrozen(config), true);
});

test('missing or invalid APP_ENV fails closed with no PROD fallback', () => {
  assert.throws(() => assertEnvironmentConfig({ ...base, APP_ENV: '' }), /APP_ENV is required/);
  assert.throws(() => assertEnvironmentConfig({ ...base, APP_ENV: 'stage' }), /APP_ENV must be dev, test or prod/);
});

test('missing runtime repository/ref fails closed', () => {
  assert.throws(() => assertEnvironmentConfig({ ...base, GITHUB_RUNTIME_OWNER: '' }), /GITHUB_RUNTIME_OWNER is required/);
  assert.throws(() => assertEnvironmentConfig({ ...base, GITHUB_RUNTIME_REPO: '' }), /GITHUB_RUNTIME_REPO is required/);
  assert.throws(() => assertEnvironmentConfig({ ...base, GITHUB_RUNTIME_REF: '' }), /GITHUB_RUNTIME_REF is required/);
});

test('missing or invalid immutable SHA identity fails closed', () => {
  assert.throws(() => assertEnvironmentConfig({ ...base, SOURCE_SHA: '' }), /SOURCE_SHA is required/);
  assert.throws(() => assertEnvironmentConfig({ ...base, SOURCE_SHA: 'main' }), /SOURCE_SHA must be a full 40-character commit SHA/);
  assert.throws(() => assertEnvironmentConfig({ ...base, RUNTIME_DATA_SHA: '' }), /RUNTIME_DATA_SHA is required/);
});

test('generated build identity is accepted but cannot disagree with explicit runtime identity', () => {
  const withoutSha = { ...base };
  delete withoutSha.SOURCE_SHA;
  delete withoutSha.RUNTIME_DATA_SHA;
  const config = assertEnvironmentConfig(withoutSha, { sourceSha:SHA_A, runtimeDataSha:SHA_B });
  assert.equal(config.sourceSha, SHA_A);
  assert.throws(() => assertEnvironmentConfig(base, { sourceSha:'c'.repeat(40), runtimeDataSha:SHA_B }), /does not match/);
});

test('search mode is environment-aware', () => {
  assert.throws(() => assertEnvironmentConfig({ ...base, APP_ENV:'dev', SEARCH_MODE:'live' }), /DEV\/TEST cannot use/);
  assert.throws(() => assertEnvironmentConfig({ ...base, APP_ENV:'prod', SEARCH_MODE:'smoke' }), /PROD requires/);
  assert.equal(assertEnvironmentConfig({ ...base, APP_ENV:'test', SEARCH_MODE:'smoke' }).searchMode, 'smoke');
});

test('/health exposes non-secret identity contract', async () => {
  const env = { ...base, GOOGLE_CLIENT_ID:'client', ALLOWED_GOOGLE_SUB:'user', GITHUB_TOKEN:'super-secret' };
  const response = await commandApi.fetch(new Request('https://app.example.test/health'), env);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual({
    environment:payload.environment,
    source_sha:payload.source_sha,
    runtime_repo:payload.runtime_repo,
    runtime_ref:payload.runtime_ref,
    runtime_data_sha:payload.runtime_data_sha,
    search_mode:payload.search_mode,
  }, {
    environment:'prod', source_sha:SHA_A, runtime_repo:'runtime-owner/runtime-repo', runtime_ref:'main', runtime_data_sha:SHA_B, search_mode:'live',
  });
  assert.equal(JSON.stringify(payload).includes('super-secret'), false);
});

test('/health fails closed when APP_ENV is missing', async () => {
  const env = { ...base };
  delete env.APP_ENV;
  const response = await commandApi.fetch(new Request('https://app.example.test/health'), env);
  assert.equal(response.status, 503);
});

test('legacy GITHUB_REF responsibilities are removed from runtime code/config', () => {
  for (const path of ['src/index.js','src/nomenclature-api.js','wrangler.jsonc']) {
    const text = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
    assert.doesNotMatch(text, /\bGITHUB_REF\b/, path);
  }
});
''', encoding="utf-8")

Path("command-api/test/runtime-github.test.mjs").write_text(r'''import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatchWorkflow, readRuntimeJson, writeRuntimeJson } from '../src/runtime-github.js';

const runtime = {
  runtimeOwner:'runtime-owner',
  runtimeRepo:'runtime-repo',
  runtimeRef:'runtime-ref',
  workflow:'job-search-full.yml',
  sourceSha:'a'.repeat(40),
};
const env = { GITHUB_TOKEN:'token' };

async function withFetch(mock, callback) {
  const original = globalThis.fetch;
  globalThis.fetch = mock;
  try { return await callback(); }
  finally { globalThis.fetch = original; }
}

test('runtime read targets explicit runtime repository and ref', async () => {
  let requested = null;
  await withFetch(async url => {
    requested = String(url);
    const content = btoa(JSON.stringify({ schema_version:'1.0' }));
    return new Response(JSON.stringify({ sha:'blob-sha', content }), { status:200 });
  }, async () => {
    const result = await readRuntimeJson(env, runtime, 'data/search-config.json');
    assert.equal(result.sha, 'blob-sha');
  });
  assert.equal(requested, 'https://api.github.com/repos/runtime-owner/runtime-repo/contents/data/search-config.json?ref=runtime-ref');
});

test('runtime write targets explicit runtime branch', async () => {
  let requested = null;
  let body = null;
  await withFetch(async (url, init) => {
    requested = String(url);
    body = JSON.parse(init.body);
    return new Response(JSON.stringify({ commit:{ sha:'commit-sha' } }), { status:200 });
  }, async () => {
    await writeRuntimeJson(env, runtime, 'data/search-config.json', 'blob-sha', { schema_version:'1.0' }, 'test');
  });
  assert.equal(requested, 'https://api.github.com/repos/runtime-owner/runtime-repo/contents/data/search-config.json');
  assert.equal(body.branch, 'runtime-ref');
});

test('workflow dispatch transports exact immutable source_sha', async () => {
  let requested = null;
  let body = null;
  await withFetch(async (url, init) => {
    requested = String(url);
    body = JSON.parse(init.body);
    return new Response(null, { status:204 });
  }, async () => {
    await dispatchWorkflow(env, runtime, 'manual-ui', false);
  });
  assert.equal(requested, 'https://api.github.com/repos/runtime-owner/runtime-repo/actions/workflows/job-search-full.yml/dispatches');
  assert.equal(body.ref, 'runtime-ref');
  assert.equal(body.inputs.run_trigger, 'manual-ui');
  assert.equal(body.inputs.source_sha, runtime.sourceSha);
});
''', encoding="utf-8")

Path("frontend/test/environment-marker.test.mjs").write_text(r'''import test from 'node:test';
import assert from 'node:assert/strict';
import { environmentBadge } from '../src/environment-marker.mjs';

test('DEV and TEST render explicit non-production markers', () => {
  assert.equal(environmentBadge('dev'), 'DEV');
  assert.equal(environmentBadge('test'), 'TEST');
});

test('PROD has no non-production marker', () => {
  assert.equal(environmentBadge('prod'), null);
  assert.equal(environmentBadge(null), null);
});
''', encoding="utf-8")

# Existing security tests need complete fail-closed environment identity.
replace_once(
    "command-api/test/security.test.mjs",
    "const env = {\n  FRONTEND_ORIGIN: 'https://app.example.test',\n  GOOGLE_CLIENT_ID: 'test-client-id',\n  ALLOWED_GOOGLE_SUB: 'allowed-test-user',\n};",
    "const env = {\n  APP_ENV: 'test',\n  FRONTEND_ORIGIN: 'https://app.example.test',\n  GITHUB_RUNTIME_OWNER: 'runtime-owner',\n  GITHUB_RUNTIME_REPO: 'runtime-repo',\n  GITHUB_RUNTIME_REF: 'main',\n  GITHUB_WORKFLOW: 'job-search-full.yml',\n  SOURCE_SHA: 'a'.repeat(40),\n  RUNTIME_DATA_SHA: 'b'.repeat(40),\n  SEARCH_MODE: 'smoke',\n  GOOGLE_CLIENT_ID: 'test-client-id',\n  ALLOWED_GOOGLE_SUB: 'allowed-test-user',\n};",
)

# Canonical docs.
replace_once("docs/command-api.md", "Ultima actualizare: `2026-09-09`", "Ultima actualizare: `2026-09-13`")
replace_once("docs/command-api.md", "-> workflow_dispatch(run_trigger=manual-ui)", "-> workflow_dispatch(run_trigger=manual-ui, source_sha=SOURCE_SHA)")
replace_once(
    "docs/command-api.md",
    "Porneste exact un full search manual dupa validarea configuratiei. Run activ -> 409.",
    "Porneste exact un full search manual dupa validarea configuratiei. Run activ -> 409. Dispatch-ul transporta obligatoriu `source_sha` exact al Worker-ului; workflow-ul valideaza SHA-ul si face checkout la acel commit inainte de executie.",
)
replace_once(
    "docs/command-api.md",
    "- `GITHUB_OWNER`, `GITHUB_REPO`, `GITHUB_REF`, `GITHUB_WORKFLOW`;",
    "- `APP_ENV`;\n- `GITHUB_RUNTIME_OWNER`, `GITHUB_RUNTIME_REPO`, `GITHUB_RUNTIME_REF`;\n- `GITHUB_WORKFLOW`;\n- `SEARCH_MODE`;",
)
replace_once(
    "docs/command-api.md",
    "Provider secrets raman in GitHub Actions Secrets.\n\n## Testare",
    '''Provider secrets raman in GitHub Actions Secrets.

`SOURCE_SHA` si `RUNTIME_DATA_SHA` nu sunt hard-codate in `wrangler.jsonc`. In Phase 2 ele sunt generate la build din commit-ul real al checkout-ului; in mapping-ul tranzitoriu PROD, runtime data sunt inca in acelasi repository/ref, deci snapshot-ul servit este identificat de acelasi commit. Daca Phase 3 separa runtime repository-ul, `RUNTIME_DATA_SHA` devine input explicit al build-ului.

## Environment identity - Phase 2 / #161

Configuratia este fail-closed. Lipsa sau invaliditatea oricarui element de identitate opreste request-ul; nu exista fallback implicit la PROD sau `main`.

Contract:

```text
APP_ENV = dev | test | prod
GITHUB_RUNTIME_OWNER
GITHUB_RUNTIME_REPO
GITHUB_RUNTIME_REF
GITHUB_WORKFLOW
SOURCE_SHA (40-char immutable commit SHA)
RUNTIME_DATA_SHA (40-char immutable commit SHA)
SEARCH_MODE = disabled | smoke | live
FRONTEND_ORIGIN
```

Command API si Nomenclature API folosesc acelasi modul `runtime-github.js` pentru GitHub Contents read/write. `GITHUB_REF` legacy nu mai este folosit functional.

`GET /health` expune numai metadata non-secret:

```json
{
  "status": "ok",
  "environment": "prod",
  "source_sha": "<sha>",
  "runtime_repo": "Shosetzel69/job-search-command-center",
  "runtime_ref": "main",
  "runtime_data_sha": "<sha>",
  "search_mode": "live"
}
```

DEV/TEST nu pot folosi `SEARCH_MODE=live`; PROD necesita `live`. Full Search este blocat de Command API daca search mode nu este `live`.

## Testare''',
)

arch = Path("ARCHITECTURE.md")
text = arch.read_text(encoding="utf-8")
text = text.replace("Versiune document: `v1.11`", "Versiune document: `v1.12`", 1)
text = text.replace("Ultima actualizare: `2026-09-11`", "Ultima actualizare: `2026-09-13`", 1)
text = text.replace(
    "- `docs/adr/ADR-002-ai-github-bridge.md` — decizia pentru identitati GitHub App operationale;",
    "- `docs/adr/ADR-002-ai-github-bridge.md` — decizia pentru identitati GitHub App operationale;\n- `docs/adr/ADR-003-environment-isolation.md` — decizia acceptata pentru izolarea DEV / TEST / PROD;",
)
text += r'''

## 19. Phase 2 - Environment-awareness (#161)

Baseline: `865aebfc73f3b78491972c2d0989c2f9e052c500`; G0 si G1 COMPLETE.

Phase 2 introduce numai contractul environment-aware. Nu provision-eaza DEV/TEST si nu muta runtime data.

Concepte separate explicit:

```text
APP_ENV
GITHUB_RUNTIME_OWNER
GITHUB_RUNTIME_REPO
GITHUB_RUNTIME_REF
GITHUB_WORKFLOW
SOURCE_SHA
RUNTIME_DATA_SHA
SEARCH_MODE
FRONTEND_ORIGIN
```

Reguli implementate:
- lipsa/invaliditatea environment identity -> fail closed;
- fara fallback implicit la PROD;
- `SOURCE_SHA` este immutable si este transportat de `POST /commands/run` pana in `workflow_dispatch`;
- workflow-ul valideaza `source_sha` si executa codul din checkout-ul exact al acelui SHA;
- runtime Contents read/write folosesc exclusiv runtime repository/ref explicit;
- Command API si Nomenclature API folosesc acelasi transport `runtime-github.js`;
- `/health` expune environment, source SHA, runtime repo/ref, runtime data SHA si search mode fara secrete;
- DEV/TEST au marker UI `[ DEV ]` / `[ TEST ]`; PROD nu afiseaza marker non-production.

Mapping tranzitoriu Phase 2 PROD:

```text
APP_ENV=prod
GITHUB_RUNTIME_OWNER=Shosetzel69
GITHUB_RUNTIME_REPO=job-search-command-center
GITHUB_RUNTIME_REF=main
SEARCH_MODE=live
```

`SOURCE_SHA` si `RUNTIME_DATA_SHA` sunt generate la build din SHA-ul real al checkout-ului, nu hard-codate. In Phase 2, source si runtime data sunt inca in acelasi repository; separarea fizica este Phase 3+.

**Gate G2:** toate testele/CI/build trebuie sa fie green si PROD trebuie sa ramana functional identic baseline-ului stabilizat. Dupa G2 se opreste; provisioning-ul necesita faza urmatoare explicita.
'''
arch.write_text(text, encoding="utf-8")

changelog = Path("CHANGELOG.md")
text = changelog.read_text(encoding="utf-8")
marker = "### Functionalitati\n\n"
entry = "- #161 / Phase 2: introdus contract environment-aware fail-closed (`APP_ENV`, runtime repo/ref, immutable `SOURCE_SHA`, `RUNTIME_DATA_SHA`, `SEARCH_MODE`, `FRONTEND_ORIGIN`), `/health` identity, dispatch cu `source_sha` si marker UI DEV/TEST; fara provisioning DEV/TEST si fara schimbarea functionala a PROD.\n"
if marker not in text:
    raise SystemExit("changelog Functionalitati marker missing")
changelog.write_text(text.replace(marker, marker + entry, 1), encoding="utf-8")

print("Phase 2 scoped patch applied")
