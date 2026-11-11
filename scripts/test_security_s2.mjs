import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const workflow = readFileSync(resolve(ROOT, '.github/workflows/deploy-environment.yml'), 'utf8');
const provision = readFileSync(resolve(ROOT, 'scripts/environment/provision.mjs'), 'utf8');

test('runtime snapshot helper still separates runtime and bootstrap roles', () => {
  assert.match(provision, /function githubRuntimeEnv/);
  assert.match(provision, /function runtimeSnapshot\(runtime\)[\s\S]*const ghEnv = githubRuntimeEnv\(runtime\)/);
  assert.doesNotMatch(provision, /function runtimeSnapshot\(runtime\)[\s\S]{0,180}githubBootstrapEnv\(runtime\)/);
});

test('legacy environment workflow exposes no bootstrap or deployment authority', () => {
  assert.match(workflow, /options: \[validate, status, isolation-test, prod-preflight\]/);
  assert.match(workflow, /live-readonly:/);
  assert.doesNotMatch(workflow, /live-environment:/);
  assert.doesNotMatch(workflow, /GH_BOOTSTRAP_TOKEN/);
  assert.doesNotMatch(workflow, /id-token:\s*write/);
  assert.doesNotMatch(workflow, /npm run env:deploy|npm run env:bootstrap/);
});

test('legacy environment workflow keeps source repository permission read-only', () => {
  assert.match(workflow, /permissions:[\s\S]*contents:\s*read/);
  assert.doesNotMatch(workflow, /contents:\s*write/);
});
