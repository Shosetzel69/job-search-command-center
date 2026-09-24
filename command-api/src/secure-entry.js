import { protectedDataPaths } from '../../shared/runtime-data.mjs';
import commandApi from './index.js';
import { manualSearchExecutionMode } from './environment-config.js';
import nomenclatureApi from './nomenclature-api.js';
import {
  clearSessionCookie,
  sessionCookie,
  sessionTokenFromRequest,
  withSessionAuthorization,
} from './session-cookie.js';

const PROTECTED_DATA = protectedDataPaths();

function noStoreResponse(response) {
  const headers = new Headers(response.headers);
  headers.set('cache-control', 'no-store');
  headers.set('x-content-type-options', 'nosniff');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function copyAuthCors(response, authResponse) {
  const headers = new Headers(response.headers);
  for (const name of ['access-control-allow-origin', 'vary']) {
    const value = authResponse.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(response.body, { status:response.status, statusText:response.statusText, headers });
}

function withSetCookie(response, value) {
  const headers = new Headers(response.headers);
  headers.append('set-cookie', value);
  return new Response(response.body, { status:response.status, statusText:response.statusText, headers });
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type':'application/json; charset=utf-8', 'cache-control':'no-store' },
  });
}

function sameOriginAllowed(request, env) {
  const origin = request.headers.get('Origin');
  return !origin || origin === env.FRONTEND_ORIGIN;
}

async function verifyProtectedDataRequest(request, env) {
  const sessionUrl = new URL('/auth/session', request.url);
  const sessionRequest = new Request(sessionUrl, { method: 'POST', headers: request.headers });
  return commandApi.fetch(sessionRequest, env);
}

export function fullSearchAllowed(searchMode, appEnv) {
  return Boolean(manualSearchExecutionMode(appEnv, searchMode));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/auth/logout' && request.method === 'POST') {
      if (!sameOriginAllowed(request, env)) return noStoreResponse(jsonResponse({ error:'Origin not allowed' }, 403));
      return noStoreResponse(withSetCookie(jsonResponse({ status:'signed-out' }), clearSessionCookie()));
    }

    const authorizedRequest = withSessionAuthorization(request);

    if (url.pathname === '/auth/session' && request.method === 'POST') {
      const response = await commandApi.fetch(authorizedRequest, env);
      if (!response.ok) return noStoreResponse(response);
      const token = sessionTokenFromRequest(request);
      if (!token) return noStoreResponse(response);
      return noStoreResponse(withSetCookie(response, sessionCookie(token)));
    }

    if (url.pathname.startsWith('/data/')) {
      if (request.method !== 'GET') {
        return new Response(JSON.stringify({ error: 'Method not allowed' }), {
          status: 405,
          headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', Allow: 'GET' },
        });
      }
      if (!PROTECTED_DATA.has(url.pathname)) {
        return new Response(JSON.stringify({ error: 'Not found' }), {
          status: 404,
          headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
        });
      }
      return noStoreResponse(await commandApi.fetch(authorizedRequest, env));
    }

    if (url.pathname === '/nomenclatures' || url.pathname.startsWith('/nomenclatures/')) {
      if (request.method === 'OPTIONS') return commandApi.fetch(request, env);
      const authResponse = await verifyProtectedDataRequest(authorizedRequest, env);
      if (!authResponse.ok) return noStoreResponse(authResponse);
      const response = await nomenclatureApi.fetch(request, env);
      return noStoreResponse(copyAuthCors(response, authResponse));
    }

    if (url.pathname === '/commands/run' && request.method === 'POST' && !fullSearchAllowed(env.SEARCH_MODE, env.APP_ENV)) {
      const authResponse = await verifyProtectedDataRequest(authorizedRequest, env);
      if (!authResponse.ok) return noStoreResponse(authResponse);
      const response = jsonResponse({ error:'Full search is disabled for this environment' }, 403);
      return noStoreResponse(copyAuthCors(response, authResponse));
    }

    return commandApi.fetch(authorizedRequest, env);
  },
};
