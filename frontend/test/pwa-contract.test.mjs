import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8'));
const worker = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('PWA manifest is standalone with required icon sizes and maskable icon', () => {
  assert.equal(manifest.display,'standalone');
  assert.equal(manifest.start_url,'/');
  assert.ok(manifest.icons.some(icon => icon.sizes === '192x192'));
  assert.ok(manifest.icons.some(icon => icon.sizes === '512x512'));
  assert.ok(manifest.icons.some(icon => String(icon.purpose).includes('maskable')));
  assert.match(html, /rel="manifest"/);
  assert.match(html, /theme-color/);
});

test('Mobile V1 service worker is deliberately network-only', () => {
  assert.doesNotMatch(worker, /caches\.(?:open|match|delete)|cache\.put|cache\.add/i);
  assert.doesNotMatch(worker, /indexedDB|localStorage|sessionStorage/i);
});
