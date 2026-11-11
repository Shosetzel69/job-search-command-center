import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const workflow = readFileSync(resolve(ROOT, '.github/workflows/deploy-environment.yml'), 'utf8');
const buildIdentity = readFileSync(resolve(ROOT, 'command-api/scripts/write-build-identity.mjs'), 'utf8');

test('retired legacy environment workflow cannot execute caller-selected candidate payloads', () => {
  assert.doesNotMatch(workflow, /Checkout immutable candidate source/);
  assert.doesNotMatch(workflow, /candidate-source/);
  assert.doesNotMatch(workflow, /deployment-source/);
  assert.doesNotMatch(workflow, /SOURCE_WORKSPACE/);
  assert.doesNotMatch(workflow, /id-token:\s*write/);
});

test('build identity still requires explicit trusted-payload attestation where used by canonical tooling', () => {
  assert.match(buildIdentity, /TRUSTED_PAYLOAD_BUILD/);
  assert.match(buildIdentity, /SOURCE_SHA is required for trusted payload builds/);
  assert.match(buildIdentity, /\.candidate-source-sha/);
  assert.match(buildIdentity, /Trusted payload source attestation does not match SOURCE_SHA/);
});
