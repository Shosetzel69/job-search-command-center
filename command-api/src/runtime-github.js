const GITHUB_API_VERSION = '2026-03-10';

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

async function runtimeGithubResponse(env, runtime, path, init = {}) {
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
  return response;
}

export async function runtimeGithubRequest(env, runtime, path, init = {}) {
  const response = await runtimeGithubResponse(env, runtime, path, init);
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function runtimeGithubTextRequest(env, runtime, path, init = {}) {
  const response = await runtimeGithubResponse(env, runtime, path, init);
  if (response.status === 204) return '';
  return response.text();
}

export async function canAccessRuntimeRepository(env, runtime) {
  if (!env.GITHUB_TOKEN) return false;
  try {
    await readRuntimeJson(env, runtime, 'data/search-config.json');
    return true;
  } catch {
    return false;
  }
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
  const apiPath = `/contents/${encodePath(path)}?ref=${encodeURIComponent(runtime.runtimeRef)}`;
  const current = await runtimeGithubRequest(env, runtime, apiPath);
  if (!current?.sha) {
    throw Object.assign(new Error(`Repository file could not be loaded: ${path}`), { status: 502 });
  }
  if (current.content) {
    return { sha: current.sha, payload: JSON.parse(decodeBase64Utf8(current.content)) };
  }

  const raw = await runtimeGithubTextRequest(env, runtime, apiPath, {
    headers: { Accept: 'application/vnd.github.raw+json' },
  });
  if (!raw) {
    throw Object.assign(new Error(`Repository file could not be loaded: ${path}`), { status: 502 });
  }
  return { sha: current.sha, payload: JSON.parse(raw) };
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
