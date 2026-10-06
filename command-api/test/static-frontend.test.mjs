import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isApiPath, staticFrontendResponse } from '../src/static-frontend.js';

test('API paths are never handled by the static frontend', () => {
  for (const path of ['/health','/health/db','/auth/config','/auth/session','/data/jobs.json','/commands/run','/config','/me','/me/jobs','/me/refresh','/admin/refresh','/applications','/applications/example','/sources','/source-categories/x','/nomenclatures']) {
    assert.equal(isApiPath(path), true, path);
  }
  assert.equal(isApiPath('/'), false);
  assert.equal(isApiPath('/jobs'), false);
  assert.equal(isApiPath('/assets/app.js'), false);
});

test('serves index, static assets and SPA fallback', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jscc-static-'));
  await mkdir(join(root, 'assets'));
  await writeFile(join(root, 'index.html'), '<!doctype html><div id="root"></div>');
  await writeFile(join(root, 'assets', 'app.js'), 'console.log("ok");');

  const home = await staticFrontendResponse(new Request('https://dev.example/'), { root });
  assert.equal(home.status, 200);
  assert.match(home.headers.get('content-type'), /text\/html/);
  assert.match(await home.text(), /id="root"/);

  const asset = await staticFrontendResponse(new Request('https://dev.example/assets/app.js'), { root });
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get('content-type'), /javascript/);
  assert.equal(await asset.text(), 'console.log("ok");');

  const spa = await staticFrontendResponse(new Request('https://dev.example/review'), { root });
  assert.equal(spa.status, 200);
  assert.match(await spa.text(), /id="root"/);

  const missingAsset = await staticFrontendResponse(new Request('https://dev.example/assets/missing.js'), { root });
  assert.equal(missingAsset.status, 404);
});

test('API request returns null so Command API retains authority', async () => {
  const response = await staticFrontendResponse(new Request('https://dev.example/data/jobs.json'));
  assert.equal(response, null);
});

test('manifest and service worker use explicit non-cacheable static semantics', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jscc-pwa-'));
  await writeFile(join(root, 'manifest.webmanifest'), '{"name":"JSCC"}');
  await writeFile(join(root, 'sw.js'), 'self.addEventListener("install",()=>{});');

  const manifest = await staticFrontendResponse(new Request('https://dev.example/manifest.webmanifest'), { root });
  assert.equal(manifest.status, 200);
  assert.match(manifest.headers.get('content-type'), /manifest\+json/);
  assert.equal(manifest.headers.get('cache-control'), 'no-store');

  const worker = await staticFrontendResponse(new Request('https://dev.example/sw.js'), { root });
  assert.equal(worker.status, 200);
  assert.match(worker.headers.get('content-type'), /javascript/);
  assert.equal(worker.headers.get('cache-control'), 'no-store');
  assert.equal(worker.headers.get('service-worker-allowed'), '/');
});
