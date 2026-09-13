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
import { assertPhase5LiveGate } from './environment/live.mjs';
import { runtimeSeedPayload, shouldRefreshPristineSeed } from './environment/seed.mjs';

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
    values[cfg.google_client_id_env] = `${name}-google-client-id.apps.googleusercontent.com`;
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

test('Google client ID is an explicit environment input', () => {
  const values = envInputs();
  delete values.TEST_GOOGLE_CLIENT_ID;
  assert.throws(() => resolveEnvironment(manifest, 'test', SHA, values), /Google OAuth client ID is missing/);
});

test('DEV and TEST can never resolve live search mode', () => {
  const values = envInputs();
  assert.equal(resolveEnvironment(manifest, 'dev', SHA, values).searchMode, 'disabled');
  assert.equal(resolveEnvironment(manifest, 'test', SHA, values).searchMode, 'smoke');
});

test('TEST resolves only the canonical isolated TEST runtime target', () => {
  const runtime = resolveEnvironment(manifest, 'test', SHA, envInputs());
  assert.equal(runtime.environment, 'test');
  assert.equal(runtime.runtimeRepository, 'Shosetzel69/job-search-runtime-test');
  assert.equal(runtime.searchMode, 'smoke');
});

test('PROD requires an explicit owner gate for gated operations', () => {
  assert.throws(() => assertProdGate('prod'), /owner-gate/);
  assert.doesNotThrow(() => assertProdGate('prod', 'APPROVED'));
});

test('Phase 5 live gate permits DEV/TEST and blocks PROD', () => {
  assert.doesNotThrow(() => assertPhase5LiveGate('dev', false));
  assert.doesNotThrow(() => assertPhase5LiveGate('test', false));
  assert.throws(() => assertPhase5LiveGate('prod', false), /DEV\/TEST only/);
  assert.doesNotThrow(() => assertPhase5LiveGate('prod', true));
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
  for (const path of runtimeDataFiles()) {
    const payload = runtimeSeedPayload(path.replace('data/', ''), { sourceSha: SHA, generatedAt: '2026-09-13T00:00:00.000Z' });
    assert.equal(payload.schema_version, '1.0');
  }
});

test('isolated non-PROD seed contains no jobs, applications or search history', () => {
  assert.deepEqual(runtimeSeedPayload('jobs.json').jobs, []);
  assert.deepEqual(runtimeSeedPayload('applications.json').applications, []);
  assert.deepEqual(runtimeSeedPayload('run-history.json').runs, []);
  assert.equal(runtimeSeedPayload('search-config.json').jobspipe_mode, 'disabled');
});

test('TEST seed metadata is TEST/smoke and never inherits DEV identity', () => {
  const options = {
    sourceSha: SHA,
    generatedAt: '2026-09-13T00:00:00.000Z',
    environment: 'test',
    searchMode: 'smoke',
  };
  const jobs = runtimeSeedPayload('jobs.json', options);
  const status = runtimeSeedPayload('run-status.json', options);
  const config = runtimeSeedPayload('search-config.json', options);
  assert.deepEqual(jobs.criteria, { environment: 'test', search_mode: 'smoke' });
  assert.equal(status.run_id, 'test-seed');
  assert.deepEqual(status.limitations, ['Isolated TEST seed. Search policy: smoke.']);
  assert.equal(config.source_strategy, 'TEST seed - smoke policy');
});

test('pristine mismatched TEST seed can be refreshed but operational data cannot', () => {
  const runtime = { environment: 'test', searchMode: 'smoke' };
  const devJobsSeed = runtimeSeedPayload('jobs.json', { environment: 'dev', searchMode: 'disabled' });
  assert.equal(shouldRefreshPristineSeed('jobs.json', devJobsSeed, runtime), true);
  const operationalJobs = { ...devJobsSeed, records_inspected: 1, jobs: [{ id: 'keep-me' }] };
  assert.equal(shouldRefreshPristineSeed('jobs.json', operationalJobs, runtime), false);
  const devStatusSeed = runtimeSeedPayload('run-status.json', { environment: 'dev', searchMode: 'disabled' });
  assert.equal(shouldRefreshPristineSeed('run-status.json', devStatusSeed, runtime), true);
  const devConfigSeed = runtimeSeedPayload('search-config.json', { environment: 'dev', searchMode: 'disabled' });
  assert.equal(shouldRefreshPristineSeed('search-config.json', devConfigSeed, runtime), true);
});

test('isolated seed preserves canonical nomenclature domains', () => {
  const domains = runtimeSeedPayload('nomenclatures.json').domains;
  assert.deepEqual(Object.keys(domains).sort(), ['application_statuses', 'contract_types', 'countries', 'regions', 'seniority', 'work_modes']);
  assert.ok(domains.countries.values.some(item => item.code === 'RO'));
  assert.ok(domains.regions.values.some(item => item.code === 'EU'));
});

test('bootstrap plan keeps source and TEST runtime repository identities distinct', () => {
  const runtime = resolveEnvironment(manifest, 'test', SHA, envInputs());
  const plan = bootstrapPlan(runtime);
  assert.notEqual(runtime.sourceRepository, runtime.runtimeRepository);
  assert.equal(plan.find(item => item.id === 'runtime-repository').target, 'Shosetzel69/job-search-runtime-test');
});

test('static isolation plan covers DEV->TEST, DEV->PROD and TEST->PROD', () => {
  const pairs = isolationPlan(manifest).map(item => `${item.from}->${item.to}`);
  assert.deepEqual(pairs, ['dev->test', 'dev->prod', 'test->prod']);
});

test('manifest rejects non-canonical runtime targets', () => {
  const copy = JSON.parse(JSON.stringify(manifest));
  copy.environments.test.runtime_repository = 'Shosetzel69/job-search-runtime-prod';
  assert.throws(() => validateManifest(copy), /canonical environment target/);
});

test('manifest rejects unresolved placeholders', () => {
  const copy = JSON.parse(JSON.stringify(manifest));
  copy.environments.test.worker_name = '<required>';
  assert.throws(() => validateManifest(copy), /placeholder/);
});

test('runtime workflow template enforces DEV disabled and TEST smoke policies', () => {
  const workflow = readFileSync(resolve(ROOT, 'config/runtime-template/runtime.yml'), 'utf8');
  assert.match(workflow, /DEV must remain SEARCH_MODE=disabled/);
  assert.match(workflow, /TEST must remain SEARCH_MODE=smoke/);
  assert.match(workflow, /TEST smoke policy verified immutable source checkout only/);
  assert.match(workflow, /source_sha must be a full immutable commit SHA/);
});

test('deploy workflow never defaults environment to PROD', () => {
  const workflow = readFileSync(resolve(ROOT, '.github/workflows/deploy-environment.yml'), 'utf8');
  assert.match(workflow, /environment:[\s\S]*required: true/);
  assert.doesNotMatch(workflow, /default:\s*prod/);
});

test('Phase 5 deploy workflow uses one generic DEV/TEST live path and keeps PROD blocked', () => {
  const workflow = readFileSync(resolve(ROOT, '.github/workflows/deploy-environment.yml'), 'utf8');
  assert.match(workflow, /Resolve live DEV\/TEST configuration/);
  assert.match(workflow, /Execute live environment action/);
  assert.match(workflow, /Phase 5 live execution permits DEV\/TEST only; PROD remains blocked/);
  assert.doesNotMatch(workflow, /Execute live DEV action/);
  assert.match(workflow, /TEST must use a Cloudflare account distinct from DEV/);
  assert.match(workflow, /TEST must use a runtime token distinct from DEV/);
});

test('environment deploy health verification retries propagation and pins runtime snapshot identity', () => {
  const provision = readFileSync(resolve(ROOT, 'scripts/environment/provision.mjs'), 'utf8');
  assert.match(provision, /HEALTH_PROPAGATION_ATTEMPTS/);
  assert.match(provision, /HEALTH_PROPAGATION_DELAY_MS/);
  assert.match(provision, /expectedRuntimeDataSha/);
  assert.match(provision, /probeDeployedHealth/);
  assert.match(provision, /provisionEnvironment/);
  assert.match(provision, /deployEnvironment/);
  assert.match(provision, /environment: runtime\.environment/);
  assert.match(provision, /searchMode: runtime\.searchMode/);
  assert.match(provision, /shouldRefreshPristineSeed/);
});
