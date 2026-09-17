import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const cutover = readFileSync(resolve(ROOT, '.github/workflows/prod-cutover.yml'), 'utf8');
const runtime = readFileSync(resolve(ROOT, 'config/runtime-template/runtime.yml'), 'utf8');

test('Phase 7 cutover workflow is manual-only and binds to PROD environment', () => {
  assert.match(cutover, /workflow_dispatch:/);
  assert.doesNotMatch(cutover, /schedule:/);
  assert.match(cutover, /environment:\s*prod/);
});

test('Phase 7 PROD mutation requires a distinct explicit owner gate', () => {
  assert.match(cutover, /owner_gate=PHASE7_APPROVED/);
  assert.match(cutover, /inputs\.owner_gate/);
  assert.doesNotMatch(cutover, /owner_gate=APPROVED/);
});

test('Phase 7 verifies immutable source and runtime anchors before mutation', () => {
  assert.match(cutover, /expected_runtime_sha/);
  assert.match(cutover, /merge-base --is-ancestor/);
  assert.match(cutover, /job-search-prod main moved/);
  assert.match(cutover, /SOURCE_READ_TOKEN/);
});

test('PROD deployment keeps trusted control-plane separate from candidate payload', () => {
  assert.match(cutover, /Checkout trusted control-plane from main/);
  assert.match(cutover, /Checkout immutable candidate source as inert payload/);
  assert.match(cutover, /Prepare sanitized candidate payload on trusted baseline/);
  assert.match(cutover, /cmp control-plane\/command-api\/wrangler\.jsonc/);
});

test('PROD runtime executes search from immutable source then publishes and redeploys exact runtime snapshot', () => {
  assert.match(runtime, /Collect normalize filter and score in PROD/);
  assert.match(runtime, /Publish PROD runtime results safely/);
  assert.match(runtime, /RUNTIME_DATA_SHA/);
  assert.match(runtime, /Redeploy PROD with published runtime snapshot/);
  assert.match(runtime, /Verify PROD health after runtime redeploy/);
  assert.match(runtime, /TEST smoke policy verified immutable source checkout only/);
});
