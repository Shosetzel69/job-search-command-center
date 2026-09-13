import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  assertProdGate,
  loadManifest,
  requireEnvironment,
  requireSourceSha,
  resolveEnvironment,
  validateManifest,
} from './environment/contract.mjs';
import { bootstrapPlan, isolationPlan, runtimeDataFiles } from './environment/plans.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const manifest = loadManifest('config/environments.json', ROOT);
const SHA = 'a'.repeat(40);
function envInputs() {
  const values = {};
  for (const [name, cfg] of Object.entries(manifest.environments)) {
    values[cfg.cloudflare_account_id_env] = name === 'dev' ? '1'.repeat(32) : name === 'test' ? '2'.repeat(32) : '3'.repeat(32);
    values[cfg.cloudflare_token_env] = `${name}-cf-token`;
    values[cfg.github_runtime_token_env] = `${name}-gh-runtime-token`;
    values[cfg.source_read_token_env] = `${name}-source-read-token`;
    values[cfg.allowed_google_sub_env] = `${name}-google-sub`;
    values[cfg.frontend_origin_env] = `https://${name}.example.test`;
  }
  return values;
}

test('manifest defines exactly three canonical runtime repositories', () => {
  assert.deepEqual(Object.keys(manifest.environments).sort(), ['dev', 'prod', 'test']);
  for (const name of ['dev', 'test', 'prod']) {
    assert.equal(manifest.environments[name].runtime_repository, `Shosetzel69/job-search-runtime-${name}`);
  }
});

test('missing environment fails closed', () => assert.throws(() => requireEnvironment(), /Explicit --env/));
test('invalid environment fails closed', () => assert.throws(() => requireEnvironment('production'), /Explicit --env/));
test('missing source SHA fails closed', () => assert.throws(() => requireSourceSha(), /immutable/));
test('mutable source ref fails closed', () => assert.throws(() => requireSourceSha('main'), /immutable/));

test('missing runtime inputs fail closed', () => {
  assert.throws(() => resolveEnvironment(manifest, 'dev', SHA, {}), /Cloudflare account ID is missing/);
});

test('invalid Cloudflare account ID fails closed', () => {
  const values = envInputs();
  values.DEV_CLOUDFLARE_ACCOUNT_ID = 'wrong';
  assert.throws(() => resolveEnvironment(manifest, 'dev', SHA, values), /32 hex/);
});

test('DEV and TEST can never resolve live search mode', () => {
  const values = envInputs();
  assert.equal(resolveEnvironment(manifest, 'dev', SHA, values).searchMode, 'disabled');
  assert.equal(resolveEnvironment(manifest, 'test', SHA, values).searchMode, 'smoke');
});

test('PROD requires an explicit owner gate for gated operations', () => {
  assert.throws(() => assertProdGate('prod'), /owner-gate/);
  assert.doesNotThrow(() => assertProdGate('prod', 'APPROVED'));
});

test('bootstrap-all scope is structurally DEV + TEST only', () => {
  const targets = ['dev', 'test'].map(name => resolveEnvironment(manifest, name, SHA, envInputs()).environment);
  assert.deepEqual(targets, ['dev', 'test']);
  assert.ok(!targets.includes('prod'));
});

test('runtime seed derives files from the shared runtime-data contract', () => {
  assert.ok(runtimeDataFiles().includes('data/jobs.json'));
  assert.ok(runtimeDataFiles().includes('data/search-state.json'));
  assert.equal(new Set(runtimeDataFiles()).size, runtimeDataFiles().length);
});

test('bootstrap plan keeps source and runtime repository identities distinct', () => {
  const runtime = resolveEnvironment(manifest, 'dev', SHA, envInputs());
  const plan = bootstrapPlan(runtime);
  assert.notEqual(runtime.sourceRepository, runtime.runtimeRepository);
  assert.equal(plan.find(item => item.id === 'runtime-repository').target, 'Shosetzel69/job-search-runtime-dev');
});

test('static isolation plan covers DEV->TEST, DEV->PROD and TEST->PROD', () => {
  const pairs = isolationPlan(manifest).map(item => `${item.from}->${item.to}`);
  assert.deepEqual(pairs, ['dev->test', 'dev->prod', 'test->prod']);
});

test('manifest rejects non-canonical runtime targets', () => {
  const copy = JSON.parse(JSON.stringify(manifest));
  copy.environments.dev.runtime_repository = 'Shosetzel69/job-search-runtime-prod';
  assert.throws(() => validateManifest(copy), /canonical environment target/);
});

test('manifest rejects unresolved placeholders', () => {
  const copy = JSON.parse(JSON.stringify(manifest));
  copy.environments.test.worker_name = '<required>';
  assert.throws(() => validateManifest(copy), /placeholder/);
});

test('deploy workflow is dry-run by default and never defaults environment', () => {
  const workflow = readFileSync(resolve(ROOT, '.github/workflows/deploy-environment.yml'), 'utf8');
  assert.match(workflow, /dry_run:[\s\S]*default: true/);
  assert.match(workflow, /environment:[\s\S]*required: true/);
  assert.doesNotMatch(workflow, /default:\s*prod/);
});
