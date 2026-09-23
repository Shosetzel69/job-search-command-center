import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const workflow = readFileSync(resolve(ROOT, '.github/workflows/deploy-environment.yml'), 'utf8');
const provision = readFileSync(resolve(ROOT, 'scripts/environment/provision.mjs'), 'utf8');

test('runtime snapshots use the runtime role rather than the bootstrap/admin role', () => {
  assert.match(provision, /function githubRuntimeEnv/);
  assert.match(provision, /function runtimeSnapshot\(runtime\)[\s\S]*const ghEnv = githubRuntimeEnv\(runtime\)/);
  assert.doesNotMatch(provision, /function runtimeSnapshot\(runtime\)[\s\S]{0,180}githubBootstrapEnv\(runtime\)/);
});

test('bootstrap secret configuration stays inside trusted provision path and non-bootstrap gets no real bootstrap credential', () => {
  assert.match(workflow, /inputs\.action == 'bootstrap' && secrets\.GH_BOOTSTRAP_TOKEN \|\| 'bootstrap-not-required'/);
  assert.doesNotMatch(workflow, /- name: Configure runtime and Worker secrets with separated roles/);
  assert.match(provision, /function configureBootstrapRuntimeSecrets\(runtime\)/);
  assert.match(provision, /deployCandidateWithReconciliation\(runtime, \{ configureBootstrapSecrets: true \}\)/);
  assert.match(provision, /const deployment = await deployCandidateWithReconciliation\(runtime\);/);
  assert.match(workflow, /Verify credential role separation and final health[\s\S]*if: \$\{\{ inputs\.action == 'bootstrap' \}\}/);
});

test('fine-grained PAT verification uses repository boundaries instead of account-level role inference', () => {
  assert.doesNotMatch(workflow, /gh repo view[^\n]*viewerPermission/);
  assert.match(workflow, /Source-read token must be a fine-grained PAT/);
  assert.match(workflow, /Runtime token must not access source repository/);
  assert.match(workflow, /Source-read token must not access runtime repository/);
  assert.match(workflow, /repos\/\$source_repo\/commits\/\$SOURCE_SHA/);
});

test('bootstrap Worker credentials are configured before deployed protected-data verification', () => {
  const deployAt = provision.indexOf('const runtimeDataSha = deployWorker(runtime)');
  const configureAt = provision.indexOf('if (configureBootstrapSecrets) configureBootstrapRuntimeSecrets(runtime)');
  const functionalAt = provision.indexOf('verifyProtectedFunctionalVisibility(runtime, reconciliation');
  assert.ok(deployAt > -1 && configureAt > deployAt && functionalAt > configureAt);
  assert.match(provision, /wrangler', 'secret', 'put', 'GITHUB_TOKEN'/);
  assert.match(provision, /wrangler', 'secret', 'put', 'ALLOWED_GOOGLE_SUB'/);
});
