import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertEnvironmentConfig } from '../src/environment-config.js';
import commandApi from '../src/index.js';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const base = {
  APP_ENV: 'prod',
  FRONTEND_ORIGIN: 'https://app.example.test',
  GITHUB_RUNTIME_OWNER: 'runtime-owner',
  GITHUB_RUNTIME_REPO: 'runtime-repo',
  GITHUB_RUNTIME_REF: 'main',
  GITHUB_WORKFLOW: 'job-search-full.yml',
  SOURCE_SHA: SHA_A,
  RUNTIME_DATA_SHA: SHA_B,
  SEARCH_MODE: 'live',
};

test('environment contract accepts explicit PROD identity', () => {
  const config = assertEnvironmentConfig(base);
  assert.equal(config.appEnv, 'prod');
  assert.equal(config.runtimeRepository, 'runtime-owner/runtime-repo');
  assert.equal(config.runtimeRef, 'main');
  assert.equal(config.sourceSha, SHA_A);
  assert.equal(config.runtimeDataSha, SHA_B);
  assert.equal(config.searchMode, 'live');
  assert.equal(Object.isFrozen(config), true);
});

test('missing or invalid APP_ENV fails closed with no PROD fallback', () => {
  assert.throws(() => assertEnvironmentConfig({ ...base, APP_ENV: '' }), /APP_ENV is required/);
  assert.throws(() => assertEnvironmentConfig({ ...base, APP_ENV: 'stage' }), /APP_ENV must be dev, test or prod/);
});

test('missing runtime repository/ref fails closed', () => {
  assert.throws(() => assertEnvironmentConfig({ ...base, GITHUB_RUNTIME_OWNER: '' }), /GITHUB_RUNTIME_OWNER is required/);
  assert.throws(() => assertEnvironmentConfig({ ...base, GITHUB_RUNTIME_REPO: '' }), /GITHUB_RUNTIME_REPO is required/);
  assert.throws(() => assertEnvironmentConfig({ ...base, GITHUB_RUNTIME_REF: '' }), /GITHUB_RUNTIME_REF is required/);
});

test('missing or invalid immutable SHA identity fails closed', () => {
  assert.throws(() => assertEnvironmentConfig({ ...base, SOURCE_SHA: '' }), /SOURCE_SHA is required/);
  assert.throws(() => assertEnvironmentConfig({ ...base, SOURCE_SHA: 'main' }), /SOURCE_SHA must be a full 40-character commit SHA/);
  assert.throws(() => assertEnvironmentConfig({ ...base, RUNTIME_DATA_SHA: '' }), /RUNTIME_DATA_SHA is required/);
});

test('generated build identity is accepted but cannot disagree with explicit runtime identity', () => {
  const withoutSha = { ...base };
  delete withoutSha.SOURCE_SHA;
  delete withoutSha.RUNTIME_DATA_SHA;
  const config = assertEnvironmentConfig(withoutSha, { sourceSha:SHA_A, runtimeDataSha:SHA_B });
  assert.equal(config.sourceSha, SHA_A);
  assert.throws(() => assertEnvironmentConfig(base, { sourceSha:'c'.repeat(40), runtimeDataSha:SHA_B }), /does not match/);
});

test('search mode is environment-aware', () => {
  assert.throws(() => assertEnvironmentConfig({ ...base, APP_ENV:'dev', SEARCH_MODE:'live' }), /DEV\/TEST cannot use/);
  assert.throws(() => assertEnvironmentConfig({ ...base, APP_ENV:'prod', SEARCH_MODE:'smoke' }), /PROD requires/);
  assert.equal(assertEnvironmentConfig({ ...base, APP_ENV:'test', SEARCH_MODE:'smoke' }).searchMode, 'smoke');
});

test('/health exposes non-secret identity contract', async () => {
  const env = { ...base, GOOGLE_CLIENT_ID:'client', ALLOWED_GOOGLE_SUB:'user', GITHUB_TOKEN:'super-secret' };
  const response = await commandApi.fetch(new Request('https://app.example.test/health'), env);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual({
    environment:payload.environment,
    source_sha:payload.source_sha,
    runtime_repo:payload.runtime_repo,
    runtime_ref:payload.runtime_ref,
    runtime_data_sha:payload.runtime_data_sha,
    search_mode:payload.search_mode,
  }, {
    environment:'prod', source_sha:SHA_A, runtime_repo:'runtime-owner/runtime-repo', runtime_ref:'main', runtime_data_sha:SHA_B, search_mode:'live',
  });
  assert.equal(JSON.stringify(payload).includes('super-secret'), false);
});

test('/health fails closed when APP_ENV is missing', async () => {
  const env = { ...base };
  delete env.APP_ENV;
  const response = await commandApi.fetch(new Request('https://app.example.test/health'), env);
  assert.equal(response.status, 503);
});

test('legacy GITHUB_REF responsibilities are removed from runtime code/config', () => {
  for (const path of ['src/index.js','src/nomenclature-api.js','wrangler.jsonc']) {
    const text = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
    assert.doesNotMatch(text, /\bGITHUB_REF\b/, path);
  }
});
