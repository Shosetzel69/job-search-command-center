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

test('non-bootstrap live actions do not receive the real bootstrap credential', () => {
  assert.match(workflow, /inputs\.action == 'bootstrap' && secrets\.GH_BOOTSTRAP_TOKEN \|\| 'bootstrap-not-required'/);
  assert.match(workflow, /Configure runtime and Worker secrets with separated roles[\s\S]*if: \$\{\{ inputs\.action == 'bootstrap' \}\}/);
  assert.match(workflow, /Verify credential role separation and final health[\s\S]*if: \$\{\{ inputs\.action == 'bootstrap' \}\}/);
});

test('fine-grained PAT verification uses repository boundaries instead of viewerPermission', () => {
  assert.doesNotMatch(workflow, /viewerPermission/);
  assert.match(workflow, /Source-read token must be a fine-grained PAT/);
  assert.match(workflow, /Runtime token must not access source repository/);
  assert.match(workflow, /Source-read token must not access runtime repository/);
  assert.match(workflow, /repos\/\$source_repo\/commits\/\$SOURCE_SHA/);
});
