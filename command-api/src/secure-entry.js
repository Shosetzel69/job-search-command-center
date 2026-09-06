import commandApi from './index.js';

const PROTECTED_DATA = new Set([
  '/data/jobs.json',
  '/data/run-status.json',
  '/data/run-history.json',
  '/data/search-config.json',
  '/data/sources.json',
  '/data/applications.json',
]);

function noStoreResponse(response) {
  const headers = new Headers(response.headers);
  headers.set('cache-control', 'no-store');
  headers.set('x-content-type-options', 'nosniff');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function verifyProtectedDataRequest(request, env) {
  const sessionUrl = new URL('/auth/session', request.url);
  const sessionRequest = new Request(sessionUrl, { method: 'POST', headers: request.headers });
  return commandApi.fetch(sessionRequest, env);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
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
      const authResponse = await verifyProtectedDataRequest(request, env);
      if (!authResponse.ok) return noStoreResponse(authResponse);
      const assetRequest = new Request(request.url, { method: 'GET', headers: { Accept: request.headers.get('Accept') || 'application/json' } });
      return noStoreResponse(await env.ASSETS.fetch(assetRequest));
    }
    return commandApi.fetch(request, env);
  },
};
