import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';

const MIME = Object.freeze({
  '.html':'text/html; charset=utf-8',
  '.js':'text/javascript; charset=utf-8',
  '.mjs':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8',
  '.json':'application/json; charset=utf-8',
  '.webmanifest':'application/manifest+json; charset=utf-8',
  '.svg':'image/svg+xml',
  '.png':'image/png',
  '.jpg':'image/jpeg',
  '.jpeg':'image/jpeg',
  '.webp':'image/webp',
  '.ico':'image/x-icon',
  '.woff':'font/woff',
  '.woff2':'font/woff2',
});

const API_PREFIXES = [
  '/auth/',
  '/data/',
  '/commands/',
  '/me/',
  '/admin/',
  '/applications/',
  '/sources',
  '/source-categories',
  '/nomenclatures',
];

const API_EXACT = new Set(['/health','/health/db','/auth/config','/auth/session','/auth/logout','/config','/me','/applications']);

export function isApiPath(pathname) {
  if (API_EXACT.has(pathname)) return true;
  return API_PREFIXES.some(prefix => pathname === prefix.replace(/\/$/, '') || pathname.startsWith(prefix));
}

function safeAssetPath(root, pathname) {
  const decoded = decodeURIComponent(pathname);
  const relative = decoded.replace(/^\/+/, '');
  const candidate = resolve(root, relative || 'index.html');
  const normalizedRoot = resolve(root);
  if (candidate !== normalizedRoot && !candidate.startsWith(normalizedRoot + sep)) {
    throw Object.assign(new Error('Invalid static path'), { status:400 });
  }
  return candidate;
}

function responseFor(bytes, path, method='GET') {
  const headers = new Headers({
    'content-type': MIME[extname(path).toLowerCase()] || 'application/octet-stream',
    'x-content-type-options':'nosniff',
  });
  if (path.endsWith('index.html') || path.endsWith('manifest.webmanifest') || path.endsWith('sw.js')) {
    headers.set('cache-control','no-store');
  } else {
    headers.set('cache-control','public, max-age=31536000, immutable');
  }
  if (path.endsWith('sw.js')) headers.set('service-worker-allowed','/');
  return new Response(method === 'HEAD' ? null : bytes, { status:200, headers });
}

export async function staticFrontendResponse(request, { root = resolve(process.cwd(), 'frontend/dist') } = {}) {
  if (!['GET','HEAD'].includes(request.method)) return null;
  const url = new URL(request.url);
  if (isApiPath(url.pathname)) return null;

  const requested = safeAssetPath(root, url.pathname);
  try {
    return responseFor(await readFile(requested), requested, request.method);
  } catch (error) {
    if (error?.code !== 'ENOENT' && error?.code !== 'EISDIR') throw error;
  }

  if (extname(url.pathname)) {
    return new Response('Not found', {
      status:404,
      headers:{ 'content-type':'text/plain; charset=utf-8', 'cache-control':'no-store' },
    });
  }

  const indexPath = resolve(root, 'index.html');
  return responseFor(await readFile(indexPath), indexPath, request.method);
}