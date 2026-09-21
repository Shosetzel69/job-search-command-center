import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const promotion = readFileSync(resolve(ROOT, '.github/workflows/prod-cutover.yml'), 'utf8');
const runtime = readFileSync(resolve(ROOT, 'config/runtime-template/runtime.yml'), 'utf8');
const commandApi = readFileSync(resolve(ROOT, 'command-api/src/index.js'), 'utf8');

test('PROD promotion is manual-only, PROD-scoped and serialized', () => {
  assert.match(promotion, /name: PROD promotion/);
  assert.match(promotion, /workflow_dispatch:/);
  assert.doesNotMatch(promotion, /schedule:/);
  assert.doesNotMatch(promotion, /push:/);
  assert.match(promotion, /environment:\s*prod/);
  assert.match(promotion, /group: deploy-prod/);
  assert.match(promotion, /cancel-in-progress: false/);
});

test('PROD mutation requires explicit owner GO and release-specific rollback reference', () => {
  assert.match(promotion, /owner_gate=PROD_GO/);
  assert.match(promotion, /rollback_reference/);
  assert.match(promotion, /PROD mutation requires rollback_reference/);
  assert.doesNotMatch(promotion, /PHASE7_APPROVED/);
});

test('PROD requires exact TEST PASS evidence for the same immutable candidate', () => {
  assert.match(promotion, /test_pass_run_id/);
  assert.match(promotion, /promotion-test-pass/);
  assert.match(promotion, /verify-test-pass/);
  assert.match(promotion, /CANDIDATE_SHA/);
  assert.match(promotion, /merge-base --is-ancestor/);
  assert.match(promotion, /TEST-passed candidate is not reachable from approved main/);
});

test('PROD captures previous known-good source/runtime anchors before mutation', () => {
  assert.match(promotion, /previous-prod-health\.json/);
  assert.match(promotion, /Previous PROD source_sha is invalid/);
  assert.match(promotion, /Previous PROD runtime_data_sha is invalid/);
  assert.match(promotion, /expected_runtime_sha/);
  assert.match(promotion, /job-search-prod main moved/);
});

test('PROD release record is generated after exact candidate health verification', () => {
  assert.match(promotion, /prod-health\.json/);
  assert.match(promotion, /create-release/);
  assert.match(promotion, /release-record\.json/);
  assert.match(promotion, /name: release-record/);
  assert.match(promotion, /owner-go-reference/);
});

test('configuration and destructive DB changes fail closed without rollback evidence', () => {
  assert.match(promotion, /bootstrap-deploy requires config_rollback_reference/);
  assert.match(promotion, /database_change/);
  assert.match(promotion, /Destructive DB change requires migration_version/);
  assert.match(promotion, /Destructive DB change requires db_backup_reference/);
  assert.match(promotion, /Destructive DB change requires SHA-256 checksum verification/);
  assert.match(promotion, /Destructive DB change requires non-PROD restore evidence/);
});

test('PROD deployment keeps trusted control-plane separate from candidate payload', () => {
  assert.match(promotion, /Checkout trusted control-plane from main/);
  assert.match(promotion, /Checkout immutable candidate source as inert payload/);
  assert.match(promotion, /Prepare sanitized candidate payload on trusted baseline/);
  assert.match(promotion, /cmp control-plane\/command-api\/wrangler\.jsonc/);
  assert.match(promotion, /Deploy exact TEST-passed candidate to dedicated PROD/);
});

test('PROD runtime executes search from immutable source then publishes and redeploys exact runtime snapshot', () => {
  assert.match(runtime, /Collect normalize filter and score in PROD/);
  assert.match(runtime, /Publish PROD runtime results safely/);
  assert.match(runtime, /RUNTIME_DATA_SHA/);
  assert.match(runtime, /Redeploy PROD with published runtime snapshot/);
  assert.match(runtime, /Verify PROD health after runtime redeploy/);
  assert.match(runtime, /TEST smoke policy verified immutable source checkout only/);
});


test('PROD mutation refreshes Worker runtime secrets before health verification', () => {
  const block = promotion.match(/- name: Configure PROD Worker runtime secrets[\s\S]*?- name: Verify dedicated PROD application health/)?.[0] || '';
  assert.match(block, /if: \$\{\{ inputs\.action != 'status' \}\}/);
  assert.match(block, /wrangler secret put GITHUB_TOKEN/);
  assert.match(block, /wrangler secret put ALLOWED_GOOGLE_SUB/);
});

test('health validates live runtime repository access rather than token presence only', () => {
  assert.match(commandApi, /github_configured:await canAccessRuntimeRepository\(env, runtime\)/);
  assert.doesNotMatch(commandApi, /github_configured:Boolean\(env\.GITHUB_TOKEN\)/);
  assert.match(promotion, /contents\/data\/search-config\.json\?ref=main/);
  assert.match(promotion, /Runtime token cannot read canonical runtime contents/);
});


test('pre-deploy rollback anchor capture does not block credential remediation', () => {
  const block = promotion.match(/Capture previous known-good PROD anchors before mutation[\s\S]*?- name: Verify credential boundaries before mutation/)?.[0] || '';
  assert.match(block, /auth_configured == true/);
  assert.doesNotMatch(block, /github_configured == true/);
  assert.match(block, /Previous PROD identity\/rollback anchors are invalid/);
});
