import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const promotion = readFileSync(resolve(ROOT, '.github/workflows/prod-cutover.yml'), 'utf8');
const runtime = readFileSync(resolve(ROOT, 'config/runtime-template/runtime.yml'), 'utf8');
const readiness = readFileSync(resolve(ROOT, '.github/workflows/prod-readiness.yml'), 'utf8');

test('legacy PROD workflow is manual-only, PROD-scoped and verify-only', () => {
  assert.match(promotion, /name: PROD promotion/);
  assert.match(promotion, /workflow_dispatch:/);
  assert.doesNotMatch(promotion, /schedule:/);
  assert.doesNotMatch(promotion, /push:/);
  assert.match(promotion, /options: \[verify-deployed-status\]/);
  assert.match(promotion, /environment:\s*prod/);
  assert.match(promotion, /group: deploy-prod/);
  assert.match(promotion, /cancel-in-progress: false/);
});

test('legacy PROD workflow contains no mutation authority or deployment secrets', () => {
  assert.doesNotMatch(promotion, /prod-promotion:/);
  assert.doesNotMatch(promotion, /id-token:\s*write/);
  assert.doesNotMatch(promotion, /secrets\./);
  assert.doesNotMatch(promotion, /PROD_GO|bootstrap-deploy|test_pass_run_id|rollback_reference/);
  assert.doesNotMatch(promotion, /wrangler|gcloud\s+run|git push/);
});

test('PROD status verification remains source runtime and database bound', () => {
  assert.match(promotion, /source_sha must be a full immutable commit SHA/);
  assert.match(promotion, /expected_runtime_sha must be a full immutable commit SHA/);
  assert.match(promotion, /\/health/);
  assert.match(promotion, /\/health\/db/);
  assert.match(promotion, /jobsearch_prod/);
  assert.match(promotion, /canonical GCP promotion path/);
});

test('PROD readiness remains explicitly non-mutating', () => {
  assert.match(readiness, /name: PROD Readiness \(Non-Mutating\)/);
  assert.match(readiness, /Phase 6 readiness only/);
  assert.match(readiness, /no PROD mutation is performed/);
  assert.doesNotMatch(readiness, /id-token:\s*write/);
});

test('legacy PROD runtime cannot redeploy Command API to Cloudflare', () => {
  assert.match(runtime, /Block retired Cloudflare PROD deployment/);
  assert.match(runtime, /CLOUDFLARE_COMMAND_API_DEPLOY_RETIRED/);
  assert.doesNotMatch(runtime, /\bnpx\s+wrangler\s+deploy\b/);
});
