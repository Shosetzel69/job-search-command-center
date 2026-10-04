import { decodeJwt } from 'jose';
import { protectedDataPaths } from '../../shared/runtime-data.mjs';
import commandApi from './index.js';
import nomenclatureApi from './nomenclature-api.js';
import { manualSearchExecutionMode } from './environment-config.js';
import { withInternalAuthContext } from './internal-auth-context.js';
import { handleAuthRoute, handleAuthenticatedRoute, sessionContext } from './multiuser-api.js';
import { clearSessionCookie } from './session-cookie.js';
import { databaseReadiness } from './db/readiness.js';

const GITHUB_ACTIONS_OIDC_ISSUER = 'https://token.actions.githubusercontent.com';
const PROTECTED_DATA = protectedDataPaths();
const ADMIN_DATA = new Set(['/data/run-status.json','/data/run-history.json','/data/promotion-status.json','/data/sources.json','/data/source-categories.json','/data/nomenclatures.json']);

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers:{ 'content-type':'application/json; charset=utf-8', 'cache-control':'no-store' },
  });
}

function noStoreResponse(response) {
  const headers = new Headers(response.headers);
  headers.set('cache-control', 'no-store');
  headers.set('x-content-type-options', 'nosniff');
  return new Response(response.body, { status:response.status, statusText:response.statusText, headers });
}

function bearer(request) {
  const match = String(request.headers.get('Authorization') || '').match(/^Bearer\s+(.+)$/i);
  return match?.[1] || null;
}

function isGithubOidc(request) {
  const token = bearer(request);
  if (!token) return false;
  try { return decodeJwt(token)?.iss === GITHUB_ACTIONS_OIDC_ISSUER; }
  catch { return false; }
}

function mutation(request) {
  return !['GET','HEAD','OPTIONS'].includes(request.method);
}

function adminOnlyPath(pathname) {
  return pathname === '/commands/run'
    || pathname === '/sources'
    || pathname.startsWith('/sources/')
    || pathname === '/source-categories'
    || pathname.startsWith('/source-categories/')
    || pathname === '/nomenclatures'
    || pathname.startsWith('/nomenclatures/');
}

function requireAdmin(context) {
  if (context?.role !== 'ADMIN') throw Object.assign(new Error('ADMIN role required'), { status:403 });
}

function stripCommandBody(request) {
  const headers = new Headers(request.headers);
  headers.delete('content-length');
  headers.delete('content-type');
  return new Request(request.url, { method:'POST', headers });
}

export function fullSearchAllowed(searchMode, appEnv) {
  return Boolean(manualSearchExecutionMode(appEnv, searchMode));
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);

      if (url.pathname === '/health') return noStoreResponse(await commandApi.fetch(request, env));
      if (request.method === 'GET' && url.pathname === '/health/db') {
        return noStoreResponse(json(await databaseReadiness(env)));
      }

      const authRoute = await handleAuthRoute(request, env);
      if (authRoute) return noStoreResponse(authRoute);

      // Candidate reconciliation keeps its narrowly-scoped GitHub OIDC path.
      // Google bearer credentials never reach ordinary protected routes.
      if (request.method === 'GET' && url.pathname.startsWith('/data/') && isGithubOidc(request)) {
        return noStoreResponse(await commandApi.fetch(request, env));
      }

      if (url.pathname.startsWith('/data/') && !PROTECTED_DATA.has(url.pathname)) {
        return noStoreResponse(json({ error:'Not found' }, 404));
      }

      const context = await sessionContext(request, env);
      if (ADMIN_DATA.has(url.pathname)) requireAdmin(context);
      const multiuser = await handleAuthenticatedRoute(request, env, context);
      if (multiuser) return noStoreResponse(multiuser);

      if (adminOnlyPath(url.pathname) && mutation(request)) requireAdmin(context);
      if (url.pathname === '/commands/run') requireAdmin(context);

      if (url.pathname === '/nomenclatures' || url.pathname.startsWith('/nomenclatures/')) {
        const response = await nomenclatureApi.fetch(request, env);
        return noStoreResponse(response);
      }

      const forwarded = withInternalAuthContext(
        url.pathname === '/commands/run' ? stripCommandBody(request) : request,
        context,
      );
      return noStoreResponse(await commandApi.fetch(forwarded, env));
    } catch (error) {
      const status = Number(error?.status) || 500;
      const response = noStoreResponse(json({ error:error?.message || 'Command API error' }, status));
      if (status === 401 || (status === 403 && /deactivated/i.test(String(error?.message || '')))) {
        const headers = new Headers(response.headers);
        headers.append('set-cookie', clearSessionCookie());
        return new Response(response.body, { status:response.status, statusText:response.statusText, headers });
      }
      return response;
    }
  },
};
