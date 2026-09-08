import test from 'node:test';
import assert from 'node:assert/strict';

import commandApi from '../src/index.js';
import secureEntry from '../src/secure-entry.js';

const env = {
  FRONTEND_ORIGIN: 'https://app.example.test',
  GOOGLE_CLIENT_ID: 'test-client-id',
  ALLOWED_GOOGLE_SUB: 'allowed-test-user',
};

const protectedDataPaths = [
  '/data/jobs.json',
  '/data/run-status.json',
  '/data/run-history.json',
  '/data/search-config.json',
  '/data/sources.json',
  '/data/source-categories.json',
  '/data/applications.json',
];

test('all protected data assets reject missing bearer token before asset lookup', async () => {
  for (const path of protectedDataPaths) {
    const response = await secureEntry.fetch(new Request(`https://app.example.test${path}`), env);
    assert.equal(response.status, 401, `${path} must be protected and must not return 404`);
    assert.match(response.headers.get('cache-control') || '', /no-store/i);
  }
});

test('unknown data asset is not exposed', async () => {
  const response = await secureEntry.fetch(new Request('https://app.example.test/data/unknown.json'), env);
  assert.equal(response.status, 404);
});

test('privileged request from a forbidden origin is rejected before auth', async () => {
  const response = await commandApi.fetch(new Request('https://app.example.test/commands/run', {
    method: 'POST',
    headers: { Origin: 'https://evil.example.test' },
  }), env);
  assert.equal(response.status, 403);
  const payload = await response.json();
  assert.match(payload.error, /origin not allowed/i);
});

test('preflight from a forbidden origin is rejected', async () => {
  const response = await commandApi.fetch(new Request('https://app.example.test/config', {
    method: 'OPTIONS',
    headers: { Origin: 'https://evil.example.test' },
  }), env);
  assert.equal(response.status, 403);
});
