import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  assertProdGate,
  CANONICAL_RUNTIME_REPOSITORIES,
  loadManifest,
  requireEnvironment,
  requireSourceSha,
  resolveEnvironment,
  validateManifest,
} from './environment/contract.mjs';
import { bootstrapPlan, isolationPlan, runtimeDataFiles } from './environment/plans.mjs';
import { assertPreCutoverLiveGate } from './environment/live.mjs';
import { buildProdPreparationReport } from './environment/prod-preflight.mjs';
import { runtimeSeedPayload, shouldRefreshPristineSeed } from './environment/seed.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const manifest = loadManifest('config/environments.json', ROOT);
const SHA = 'a'.repeat(40);
function envInputs() {
  const values = {};
  for (const [name, cfg] of Object.entries(manifest.environments)) {
    values[cfg.cloudflare_account_id_env] = name === 'dev' ? '1'.repeat(32) : name === 'test' ? '2'.repeat(32) : '3'.repeat(32);
    values[cfg.cloudflare_token_env] = `${name}-cf-token`;
    values[cfg.github_bootstrap_token_env] = `${name}-gh-bootstrap-token`;
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
    assert.equal(manifest.environments[name].runtime_repository, CANONICAL_RUNTIME_REPOSITORIES[name]);
  }
  assert.equal(manifest.environments.prod.runtime_repository, 'Shosetzel69/job-search-prod');
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

test('bootstrap and runtime GitHub roles must be distinct', () => {
  const values = envInputs();
  values.DEV_GITHUB_BOOTSTRAP_TOKEN = values.DEV_GITHUB_RUNTIME_TOKEN;
  assert.throws(() => resolveEnvironment(manifest, 'dev', SHA, values), /must be distinct/);
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

test('pre-cutover live gate permits DEV/TEST and blocks PROD', () => {
  assert.doesNotThrow(() => assertPreCutoverLiveGate('dev', false));
  assert.doesNotThrow(() => assertPreCutoverLiveGate('test', false));
  assert.throws(() => assertPreCutoverLiveGate('prod', false), /Phase 7 GO/);
  assert.doesNotThrow(() => assertPreCutoverLiveGate('prod', true));
});

test('Phase 6 PROD preparation identifies legacy source-backed runtime and isolated target', () => {
  const wrangler = JSON.parse(readFileSync(resolve(ROOT, 'command-api/wrangler.jsonc'), 'utf8'));
  const report = buildProdPreparationReport({ manifest, wrangler, sourceSha: SHA });
  assert.equal(report.status, 'PASS');
  assert.equal(report.phase, 6);
  assert.equal(report.live_prod_mutation_authorized, false);
  assert.equal(report.phase7_cutover_authorized, false);
  assert.equal(report.current_prod.environment, 'prod');
  assert.equal(report.current_prod.runtime_repository, 'Shosetzel69/job-search-command-center');
  assert.equal(report.target_prod.runtime_repository, 'Shosetzel69/job-search-prod');
  assert.equal(report.target_prod.workflow, 'runtime.yml');
  assert.equal(report.target_prod.search_mode, 'live');
  assert.equal(report.migration_required, true);
  assert.ok(report.checks.every(check => check.result === 'PASS'));
});

test('Phase 6 PROD preparation rejects a target that aliases DEV runtime data', () => {
  const badManifest = JSON.parse(JSON.stringify(manifest));
  badManifest.environments.prod.runtime_repository = badManifest.environments.dev.runtime_repository;
  const wrangler = JSON.parse(readFileSync(resolve(ROOT, 'command-api/wrangler.jsonc'), 'utf8'));
  assert.throws(() => buildProdPreparationReport({ manifest: badManifest, wrangler, sourceSha: SHA }), /canonical environment target|preflight failed/);
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
  copy.environments.prod.runtime_repository = 'Shosetzel69/job-search-runtime-prod';
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

test('live deployment is GitHub-Environment scoped and does not multiplex repository-scoped environment secrets', () => {
  const workflow = readFileSync(resolve(ROOT, '.github/workflows/deploy-environment.yml'), 'utf8');
  assert.match(workflow, /live-environment:[\s\S]*environment: \$\{\{ inputs\.environment \}\}/);
  assert.match(workflow, /secrets\.GH_BOOTSTRAP_TOKEN/);
  assert.match(workflow, /secrets\.GH_RUNTIME_TOKEN/);
  assert.match(workflow, /secrets\.SOURCE_READ_TOKEN/);
  assert.doesNotMatch(workflow, /secrets\.DEV_/);
  assert.doesNotMatch(workflow, /secrets\.TEST_/);
  assert.doesNotMatch(workflow, /secrets\.PROD_/);
});

test('live DEV and TEST deployment uses trusted main control-plane and exact pre-merge candidate payload', () => {
  const workflow = readFileSync(resolve(ROOT, '.github/workflows/deploy-environment.yml'), 'utf8');
  assert.match(workflow, /Checkout trusted control-plane from main/);
  assert.match(workflow, /ref: main/);
  assert.match(workflow, /path: control-plane/);
  assert.match(workflow, /Checkout immutable candidate source/);
  assert.match(workflow, /ref: \$\{\{ inputs\.source_sha \}\}/);
  assert.match(workflow, /path: candidate-source/);
  assert.match(workflow, /candidate checkout does not match source_sha/);
  assert.match(workflow, /SOURCE_WORKSPACE/);
  assert.doesNotMatch(workflow, /Live deployment source_sha must already be reachable from trusted main/);
});

test('promotion evidence normalizes FRONTEND_ORIGIN before curl', () => {
  const workflow = readFileSync(resolve(ROOT, '.github/workflows/deploy-environment.yml'), 'utf8');
  assert.match(workflow, /String\(process\.env\.FRONTEND_ORIGIN \|\| ""\)\.trim\(\)\.replace/);
  assert.match(workflow, /FRONTEND_ORIGIN is empty after normalization/);
  assert.match(workflow, /curl --fail --silent --show-error "\$frontend_origin\/health"/);
  assert.doesNotMatch(workflow, /curl --fail --silent --show-error "\$FRONTEND_ORIGIN\/health"/);
});

test('DEV freezes candidate evidence and TEST requires the same DEV-passed candidate', () => {
  const workflow = readFileSync(resolve(ROOT, '.github/workflows/deploy-environment.yml'), 'utf8');
  assert.match(workflow, /issue_pr/);
  assert.match(workflow, /dev_evidence_run_id/);
  assert.match(workflow, /promotion-dev-pass/);
  assert.match(workflow, /verify-dev/);
  assert.match(workflow, /create-test-deployed/);
  assert.match(workflow, /promotion-test-deployed/);
  assert.match(workflow, /group: deploy-\$\{\{ inputs\.environment \}\}/);
  assert.match(workflow, /cancel-in-progress: false/);
});

test('independent TEST PASS attestation is main-controlled and candidate-bound', () => {
  const workflow = readFileSync(resolve(ROOT, '.github/workflows/record-test-pass.yml'), 'utf8');
  assert.match(workflow, /name: TEST PASS attestation/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /environment: test/);
  assert.match(workflow, /test_evidence_reference/);
  assert.match(workflow, /test_verdict/);
  assert.match(workflow, /refs\/heads\/main/);
  assert.match(workflow, /promotion-test-deployed/);
  assert.match(workflow, /verify-test-deployed/);
  assert.match(workflow, /create-test-pass/);
  assert.match(workflow, /promotion-test-pass/);
  assert.doesNotMatch(workflow, /push:/);
});

test('environment automation blocks live PROD and delegates mutation to permanent PROD promotion', () => {
  const workflow = readFileSync(resolve(ROOT, '.github/workflows/deploy-environment.yml'), 'utf8');
  assert.match(workflow, /prod-preflight/);
  assert.match(workflow, /Live PROD uses the dedicated permanent promotion workflow/);
  assert.match(workflow, /prod-preflight requires environment=prod/);
  assert.match(workflow, /inputs\.environment == 'dev' \|\| inputs\.environment == 'test'/);
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
  assert.match(provision, /assertPreCutoverLiveGate/);
});

test('trusted control-plane uses bootstrap role and does not inherit all secrets into child processes', () => {
  const provision = readFileSync(resolve(ROOT, 'scripts/environment/provision.mjs'), 'utf8');
  assert.match(provision, /githubBootstrapEnv/);
  assert.match(provision, /runtime\.githubBootstrapToken/);
  assert.match(provision, /SOURCE_WORKSPACE/);
  assert.match(provision, /safeChildEnv/);
  assert.doesNotMatch(provision, /\.\.\.process\.env/);
});
