import { assertNomenclatures } from '../../shared/nomenclatures.mjs';
import {
  addNomenclatureValue,
  deleteNomenclatureValue,
  updateNomenclatureValue,
} from './nomenclature-governance.js';

const GITHUB_API_VERSION = '2026-03-10';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type':'application/json; charset=utf-8',
      'cache-control':'no-store',
      'x-content-type-options':'nosniff',
    },
  });
}

function githubHeaders(env) {
  return {
    Accept:'application/vnd.github+json',
    Authorization:`Bearer ${env.GITHUB_TOKEN}`,
    'X-GitHub-Api-Version':GITHUB_API_VERSION,
    'User-Agent':'job-search-command-api',
  };
}

function githubBase(env) {
  return `https://api.github.com/repos/${encodeURIComponent(env.GITHUB_OWNER)}/${encodeURIComponent(env.GITHUB_REPO)}`;
}

async function githubRequest(env, path, init = {}) {
  if (!env.GITHUB_TOKEN) throw Object.assign(new Error('GitHub token is not configured'), { status:503 });
  const response = await fetch(`${githubBase(env)}${path}`, {
    ...init,
    headers:{ ...githubHeaders(env), ...(init.headers || {}) },
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 1000);
    throw Object.assign(new Error(`GitHub ${response.status}: ${detail}`), { status:response.status === 409 ? 409 : 502 });
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

async function readRepoJson(env, path) {
  const result = await githubRequest(env, `/contents/${encodePath(path)}?ref=${encodeURIComponent(env.GITHUB_REF)}`);
  if (!result?.sha || !result?.content) throw Object.assign(new Error(`Repository file could not be loaded: ${path}`), { status:502 });
  return { sha:result.sha, payload:JSON.parse(decodeBase64Utf8(result.content)) };
}

async function writeRepoJson(env, path, sha, payload, message) {
  const result = await githubRequest(env, `/contents/${encodePath(path)}`, {
    method:'PUT',
    headers:{ 'Content-Type':'application/json' },
    body:JSON.stringify({
      message,
      content:encodeBase64Utf8(`${JSON.stringify(payload, null, 2)}\n`),
      sha,
      branch:env.GITHUB_REF,
    }),
  });
  return result?.commit?.sha || null;
}

async function readCatalog(env) {
  const path = env.NOMENCLATURES_PATH || 'data/nomenclatures.json';
  const { sha, payload } = await readRepoJson(env, path);
  try {
    return { path, sha, catalog:assertNomenclatures(payload) };
  } catch (error) {
    throw Object.assign(new Error(`Invalid nomenclatures contract: ${error.message}`), { status:409 });
  }
}

async function readContext(env) {
  const configPath = env.SEARCH_CONFIG_PATH || 'data/search-config.json';
  const applicationsPath = env.APPLICATIONS_PATH || 'data/applications.json';
  const [{ payload:searchConfig }, { payload:applications }] = await Promise.all([
    readRepoJson(env, configPath),
    readRepoJson(env, applicationsPath),
  ]);
  return { searchConfig, applications };
}

async function parseJson(request) {
  try { return await request.json(); }
  catch { throw Object.assign(new Error('Invalid JSON payload'), { status:400 }); }
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (request.method === 'GET' && url.pathname === '/nomenclatures') {
        const { catalog } = await readCatalog(env);
        return json({ status:'ok', catalog });
      }

      const domainMatch = url.pathname.match(/^\/nomenclatures\/([^/]+)$/);
      if (domainMatch && request.method === 'POST') {
        const domain = decodeURIComponent(domainMatch[1]);
        const { path, sha, catalog } = await readCatalog(env);
        addNomenclatureValue(catalog, domain, await parseJson(request));
        const commit = await writeRepoJson(env, path, sha, catalog, `Add ${domain} nomenclature value`);
        return json({ status:'created', commit, catalog }, 201);
      }

      const valueMatch = url.pathname.match(/^\/nomenclatures\/([^/]+)\/([^/]+)$/);
      if (valueMatch && request.method === 'PUT') {
        const domain = decodeURIComponent(valueMatch[1]);
        const code = decodeURIComponent(valueMatch[2]);
        const { path, sha, catalog } = await readCatalog(env);
        const context = await readContext(env);
        updateNomenclatureValue(catalog, domain, code, await parseJson(request), context);
        const commit = await writeRepoJson(env, path, sha, catalog, `Update ${domain}:${code} nomenclature value`);
        return json({ status:'saved', commit, catalog });
      }

      if (valueMatch && request.method === 'DELETE') {
        const domain = decodeURIComponent(valueMatch[1]);
        const code = decodeURIComponent(valueMatch[2]);
        const { path, sha, catalog } = await readCatalog(env);
        const context = await readContext(env);
        deleteNomenclatureValue(catalog, domain, code, context);
        const commit = await writeRepoJson(env, path, sha, catalog, `Delete ${domain}:${code} nomenclature value`);
        return json({ status:'deleted', commit, catalog });
      }

      return json({ error:'Not found' }, 404);
    } catch (error) {
      const status = Number(error?.status) || 500;
      const publicMessage = status >= 500 ? 'Command API error' : error.message;
      console.error(error);
      return json({
        error:publicMessage,
        ...(Array.isArray(error?.references) ? { references:error.references } : {}),
      }, status);
    }
  },
};
