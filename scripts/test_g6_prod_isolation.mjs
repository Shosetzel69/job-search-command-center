import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const workflow = readFileSync(resolve(ROOT, '.github/workflows/g6-prod-isolation.yml'), 'utf8');

test('G6 PROD isolation QA is manual-only and prod-environment scoped', () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /environment:\s*prod/);
  assert.doesNotMatch(workflow, /\n\s+push:/);
  assert.doesNotMatch(workflow, /\n\s+schedule:/);
  assert.match(workflow, /owner_gate/);
  assert.match(workflow, /G6_QA/);
});

test('G6 PROD isolation QA requires explicit legacy account identity and distinct target accounts', () => {
  assert.match(workflow, /legacy_account_id:/);
  assert.match(workflow, /LEGACY_ACCOUNT_ID/);
  assert.match(workflow, /8364666c7cf48cd1852e2e29a682bfb6/);
  assert.match(workflow, /f5e9f2faf4d567f41baae8404058fbc2/);
  assert.match(workflow, /G6 account identities must all be distinct/);
});

test('G6 PROD isolation QA proves positive PROD access and negative cross-account access', () => {
  assert.match(workflow, /secrets\.CLOUDFLARE_TOKEN/);
  assert.match(workflow, /vars\.CLOUDFLARE_ACCOUNT_ID/);
  assert.match(workflow, /tokens\/verify/);
  assert.match(workflow, /workers\/scripts\/job-search-command-api\/settings/);
  assert.match(workflow, /deny_worker_settings dev/);
  assert.match(workflow, /deny_worker_settings test/);
  assert.match(workflow, /deny_worker_settings legacy/);
  assert.match(workflow, /403\|404/);
  assert.match(workflow, /cross-account negative isolation PASS/);
});

test('G6 PROD isolation QA is structurally non-mutating', () => {
  assert.match(workflow, /GET requests only and does not mutate any Cloudflare resource/);
  assert.doesNotMatch(workflow, /curl[^\n]*(--request|-X)\s*(POST|PUT|PATCH|DELETE)/i);
  assert.doesNotMatch(workflow, /wrangler\s+(deploy|delete|secret put)/);
  assert.doesNotMatch(workflow, /npm run env:(bootstrap|deploy)/);
  assert.doesNotMatch(workflow, /gh\s+(secret|variable)\s+set/);
});
