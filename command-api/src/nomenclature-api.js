import { assertNomenclatures } from '../../shared/nomenclatures.mjs';
import {
  addNomenclatureValue,
  deleteNomenclatureValue,
  updateNomenclatureValue,
} from './nomenclature-governance.js';
import { assertEnvironmentConfig } from './environment-config.js';
import { BUILD_IDENTITY } from './build-identity.generated.js';
import { readRuntimeJson, writeRuntimeJson } from './runtime-backend.js';
import { nomenclatureReferenceCount } from './multiuser-repository.js';

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

function runtimeConfig(env) {
  return assertEnvironmentConfig(env, BUILD_IDENTITY);
}

async function readRepoJson(env, path) {
  return readRuntimeJson(env, runtimeConfig(env), path);
}

async function writeRepoJson(env, path, sha, payload, message) {
  const result = await writeRuntimeJson(env, runtimeConfig(env), path, sha, payload, message);
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

async function readContext(env, domain, code) {
  return { dbReferenceCount:await nomenclatureReferenceCount(domain, code, env) };
}

async function parseJson(request) {
  try { return await request.json(); }
  catch { throw Object.assign(new Error('Invalid JSON payload'), { status:400 }); }
}

export default {
  async fetch(request, env) {
    try {
      runtimeConfig(env);
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
        const context = await readContext(env, domain, code);
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
