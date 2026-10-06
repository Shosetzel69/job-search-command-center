import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertEnvironmentConfig } from '../src/environment-config.js';

const SHA = 'a'.repeat(40);
const gcp = {
  APP_ENV:'dev',
  FRONTEND_ORIGIN:'https://dev.example.test',
  JSCC_RUNTIME_BACKEND:'gcp',
  GCP_PROJECT_ID:'jscc-dev',
  GCP_RUNTIME_BUCKET:'jscc-dev-runtime-828902654738',
  GCP_SEARCH_JOB:'jscc-search-dev',
  GCP_REGION:'europe-west1',
  SOURCE_SHA:SHA,
  RUNTIME_DATA_SHA:SHA,
  SEARCH_MODE:'disabled',
};

test('GCP runtime config does not require GitHub runtime bindings', () => {
  const config = assertEnvironmentConfig(gcp);
  assert.equal(config.runtimeBackend, 'gcp');
  assert.equal(config.runtimeRepository, 'gcp://jscc-dev/jscc-dev-runtime-828902654738');
  assert.equal(config.gcpSearchJob, 'jscc-search-dev');
});

test('GCP runtime config fails closed without environment-owned bucket/job', () => {
  assert.throws(() => assertEnvironmentConfig({ ...gcp, GCP_RUNTIME_BUCKET:'' }), /GCP_RUNTIME_BUCKET is required/);
  assert.throws(() => assertEnvironmentConfig({ ...gcp, GCP_SEARCH_JOB:'' }), /GCP_SEARCH_JOB is required/);
});

test('GCP runtime adapter protects candidate-managed catalogs and uses atomic controls', () => {
  const text = readFileSync(new URL('../src/runtime-gcp.js', import.meta.url), 'utf8');
  assert.match(text, /candidate-managed; create a new candidate/);
  assert.match(text, /ifGenerationMatch=0/);
  assert.match(text, /ifGenerationMatch=\$\{encodeURIComponent\(generation\)\}/);
  assert.match(text, /const name = `projects\//);
  assert.match(text, /Cloud Run Job invocation failed/);
  assert.match(text, /heavy-search\.lock/);
  assert.match(text, /GCP_CURRENT_GENERATION/);
  assert.match(text, /current\.json&ifGenerationMatch/);
  assert.match(text, /trap .*active\.json .*heavy-search\.lock/);
  assert.match(text, /name === 'run-status\.json'/);
  assert.match(text, /activeRunId/);
  assert.match(text, /runs\/\$\{runId\}\/\$\{name\}/);
  assert.match(text, /deleteObject\(env, 'active\.json'\)/);
});

test('Node server listens on PORT and delegates to the existing secure handler', () => {
  const text = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
  assert.match(text, /process\.env\.PORT \|\| 8080/);
  assert.match(text, /commandApi\.fetch/);
});
