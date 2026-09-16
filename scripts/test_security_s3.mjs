import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const workflow = readFileSync(resolve(ROOT, '.github/workflows/deploy-environment.yml'), 'utf8');
const provision = readFileSync(resolve(ROOT, 'scripts/environment/provision.mjs'), 'utf8');
const buildIdentity = readFileSync(resolve(ROOT, 'command-api/scripts/write-build-identity.mjs'), 'utf8');

test('candidate checkout is inert and never supplies executable deployment tooling', () => {
  assert.match(workflow, /Checkout immutable candidate source as inert payload/);
  assert.match(workflow, /persist-credentials:\s*false/);
  assert.match(workflow, /Prepare sanitized candidate payload on trusted build baseline/);
  assert.match(workflow, /cp -a control-plane deployment-source/);
  assert.match(workflow, /candidate-source\/command-api\/src deployment-source\/command-api\/src/);
  assert.match(workflow, /candidate-source\/frontend\/src deployment-source\/frontend\/src/);
  assert.match(workflow, /SOURCE_WORKSPACE: \$\{\{ github\.workspace \}\}\/deployment-source/);
  assert.doesNotMatch(workflow, /npm --prefix candidate-source/);
  assert.doesNotMatch(workflow, /SOURCE_WORKSPACE: \$\{\{ github\.workspace \}\}\/candidate-source/);
});

test('trusted executable build and deploy files are explicitly preserved from main', () => {
  for (const trustedFile of [
    'command-api/package.json',
    'command-api/wrangler.jsonc',
    'command-api/scripts/write-build-identity.mjs',
    'frontend/package.json',
    'frontend/vite.config.js',
  ]) {
    const escaped = trustedFile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(workflow, new RegExp(`cmp control-plane/${escaped} deployment-source/${escaped}`));
  }
});

test('deployment workspace source identity is attested before privileged deploy', () => {
  assert.match(workflow, /\.candidate-source-sha/);
  assert.match(provision, /verifyDeploymentWorkspaceSource/);
  assert.match(provision, /Prepared deployment payload does not match immutable SOURCE_SHA/);
  assert.match(provision, /TRUSTED_PAYLOAD_BUILD: trustedPayloadBuild \? '1' : '0'/);
});

test('build identity trusts only explicit workflow attestation in sanitized payload mode', () => {
  assert.match(buildIdentity, /TRUSTED_PAYLOAD_BUILD/);
  assert.match(buildIdentity, /SOURCE_SHA is required for trusted payload builds/);
  assert.match(buildIdentity, /\.candidate-source-sha/);
  assert.match(buildIdentity, /Trusted payload source attestation does not match SOURCE_SHA/);
});
