import test from 'node:test';
import assert from 'node:assert/strict';

import commandApi from '../src/index.js';
import secureEntry from '../src/secure-entry.js';

const env = {
  FRONTEND_ORIGIN: 'https://app.example.test',
  GOOGLE_CLIENT_ID: 'test-client-id',
  ALLOWED_GOOGLE_SUB: 'allowed-test-user',
};

test('protected data without bearer token is rejected', async () => {
  const response = await secureEntry.fetch(new Request('https://app.example.test/data/jobs.json'), env);
  assert.equal(response.status, 401);
  assert.match(response.headers.get('cache-control') || '', /no-store/i);
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
