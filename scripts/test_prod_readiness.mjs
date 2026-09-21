import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const workflow = readFileSync(resolve(ROOT, '.github/workflows/prod-readiness.yml'), 'utf8');

test('PROD readiness is environment-scoped and manual-only', () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /environment:\s*prod/);
  assert.doesNotMatch(workflow, /\n\s+push:/);
  assert.doesNotMatch(workflow, /\n\s+schedule:/);
});

test('PROD readiness uses environment-scoped credential names', () => {
  for (const name of [
    'secrets.CLOUDFLARE_TOKEN',
    'secrets.GH_BOOTSTRAP_TOKEN',
    'secrets.GH_RUNTIME_TOKEN',
    'secrets.SOURCE_READ_TOKEN',
    'secrets.ALLOWED_GOOGLE_SUB',
    'vars.CLOUDFLARE_ACCOUNT_ID',
    'vars.GOOGLE_CLIENT_ID',
    'vars.FRONTEND_ORIGIN',
  ]) assert.ok(workflow.includes(name), `${name} missing`);
});

test('PROD readiness remains strictly non-mutating', () => {
  assert.match(workflow, /Phase 7 remains blocked; no PROD mutation is performed/);
  assert.match(workflow, /npm run env:validate -- --env prod/);
  assert.match(workflow, /npm run env:prod-preflight/);
  assert.doesNotMatch(workflow, /npm run env:bootstrap/);
  assert.doesNotMatch(workflow, /npm run env:deploy/);
  assert.doesNotMatch(workflow, /wrangler\s+(deploy|secret put|delete)/);
  assert.doesNotMatch(workflow, /gh\s+secret\s+set/);
  assert.doesNotMatch(workflow, /gh\s+variable\s+set/);
});

test('PROD readiness verifies trusted-main ancestry and credential segregation', () => {
  assert.match(workflow, /ref:\s*main/);
  assert.match(workflow, /merge-base --is-ancestor/);
  assert.match(workflow, /Bootstrap and runtime GitHub tokens must be distinct/);
  assert.match(workflow, /Runtime token unexpectedly has Actions secrets read permission/);
  assert.match(workflow, /Runtime token unexpectedly has Actions variables read permission/);
  assert.match(workflow, /Source-read token must be a fine-grained PAT/);
  assert.match(workflow, /Runtime token must not access source repository/);
  assert.match(workflow, /contents\/data\/search-config\.json\?ref=main/);
  assert.match(workflow, /Runtime token cannot read canonical runtime contents/);
  assert.match(workflow, /Source-read token must not access runtime repository/);
  assert.doesNotMatch(workflow, /gh repo view[^\n]*viewerPermission/);
  assert.match(workflow, /job-search-command-api\.job-search-prod\.workers\.dev/);
});

test('PROD readiness verifies active Cloudflare account token and target Worker without overclaiming cross-account isolation', () => {
  assert.match(workflow, /accounts\/\$CLOUDFLARE_ACCOUNT_ID\/tokens\/verify/);
  assert.match(workflow, /\.result\.status == "active"/);
  assert.match(workflow, /workers\/scripts\/job-search-command-api\/settings/);
  assert.match(workflow, /Cross-account negative isolation remains an independent G6 QA check/);
  assert.doesNotMatch(workflow, /reaches only the dedicated PROD target context/);
});
