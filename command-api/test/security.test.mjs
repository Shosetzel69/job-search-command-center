import test from 'node:test';
import assert from 'node:assert/strict';

import { INTERNAL_DATA_FILES, PROTECTED_DATA_FILES } from '../../shared/runtime-data.mjs';
import commandApi from '../src/index.js';
import secureEntry from '../src/secure-entry.js';

const env = {
  APP_ENV: 'test',
  FRONTEND_ORIGIN: 'https://app.example.test',
  GITHUB_RUNTIME_OWNER: 'runtime-owner',
  GITHUB_RUNTIME_REPO: 'runtime-repo',
  GITHUB_RUNTIME_REF: 'main',
  GITHUB_WORKFLOW: 'job-search-full.yml',
  SOURCE_SHA: 'a'.repeat(40),
  RUNTIME_DATA_SHA: 'b'.repeat(40),
  SEARCH_MODE: 'smoke',
  GOOGLE_CLIENT_ID: 'test-client-id',
  ALLOWED_GOOGLE_SUB: 'allowed-test-user',
};

const protectedDataPaths = PROTECTED_DATA_FILES.map(file => `/data/${file}`);

test('all protected data assets reject missing bearer token before asset lookup', async () => {
  assert.ok(protectedDataPaths.includes('/data/nomenclatures.json'));
  for (const path of protectedDataPaths) {
    const response = await secureEntry.fetch(new Request(`https://app.example.test${path}`), env);
    assert.equal(response.status, 401, `${path} must be protected and must not return 404`);
    assert.match(response.headers.get('cache-control') || '', /no-store/i);
  }
});

test('nomenclature admin API rejects missing bearer token before GitHub access', async () => {
  for (const [method,path] of [
    ['GET','/nomenclatures'],
    ['POST','/nomenclatures/application_statuses'],
    ['PUT','/nomenclatures/regions/EU'],
    ['DELETE','/nomenclatures/application_statuses/applied'],
  ]) {
    const response = await secureEntry.fetch(new Request(`https://app.example.test${path}`, {
      method,
      headers: method === 'GET' ? {} : { 'Content-Type':'application/json' },
      body: method === 'GET' ? undefined : JSON.stringify({ label:'Test' }),
    }), env);
    assert.equal(response.status, 401, `${method} ${path} must require authentication`);
    assert.match(response.headers.get('cache-control') || '', /no-store/i);
  }
});

test('internal data assets are never part of the protected/public manifest', () => {
  for (const file of INTERNAL_DATA_FILES) {
    assert.equal(PROTECTED_DATA_FILES.includes(file), false, `${file} must remain internal`);
  }
  assert.ok(INTERNAL_DATA_FILES.includes('search-state.json'));
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
