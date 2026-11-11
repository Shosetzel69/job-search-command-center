import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const environmentWorkflow = readFileSync(resolve(ROOT, '.github/workflows/deploy-environment.yml'), 'utf8');
const prodWorkflow = readFileSync(resolve(ROOT, '.github/workflows/prod-cutover.yml'), 'utf8');
const environmentCli = readFileSync(resolve(ROOT, 'scripts/environment.mjs'), 'utf8');
const provision = readFileSync(resolve(ROOT, 'scripts/environment/provision.mjs'), 'utf8');
const commandPackage = JSON.parse(readFileSync(resolve(ROOT, 'command-api/package.json'), 'utf8'));
const runtimeTemplate = readFileSync(resolve(ROOT, 'config/runtime-template/runtime.yml'), 'utf8');
const bridgePackage = JSON.parse(readFileSync(resolve(ROOT, 'ai-github-bridge/package.json'), 'utf8'));
const buildTrigger = readFileSync(resolve(ROOT, 'command-api/BUILD_TRIGGER.md'), 'utf8');
const environmentRunbook = readFileSync(resolve(ROOT, 'docs/environment-provisioning-runbook.md'), 'utf8');
const deliveryLifecycle = readFileSync(resolve(ROOT, 'docs/software-delivery-lifecycle.md'), 'utf8');

test('legacy environment workflow exposes read-only operations only', () => {
  assert.match(environmentWorkflow, /options: \[validate, status, isolation-test, prod-preflight\]/);
  assert.match(environmentWorkflow, /live-readonly:/);
  assert.doesNotMatch(environmentWorkflow, /live-environment:/);
  assert.doesNotMatch(environmentWorkflow, /id-token:\s*write/);
  assert.doesNotMatch(environmentWorkflow, /npm run env:deploy|npm run env:bootstrap/);
});

test('legacy PROD cutover exposes verify-only and contains no mutation job', () => {
  assert.match(prodWorkflow, /options: \[verify-deployed-status\]/);
  assert.match(prodWorkflow, /post-deploy verification only|already-deployed PROD/);
  assert.doesNotMatch(prodWorkflow, /prod-promotion:/);
  assert.doesNotMatch(prodWorkflow, /id-token:\s*write/);
  assert.doesNotMatch(prodWorkflow, /secrets\./);
});

test('legacy CLI and provisioning exports fail closed before Cloudflare mutation', () => {
  assert.match(environmentCli, /blockLegacyCloudflareCommandApiMutation\('bootstrap'\)/);
  assert.match(environmentCli, /blockLegacyCloudflareCommandApiMutation\('deploy'\)/);
  assert.match(provision, /export async function provisionEnvironment\(runtime\) \{\s*blockLegacyCloudflareCommandApiMutation\('provisionEnvironment'\)/);
  assert.match(provision, /export async function deployEnvironment\(runtime\) \{\s*blockLegacyCloudflareCommandApiMutation\('deployEnvironment'\)/);
  assert.match(provision, /export async function deployCandidateWithReconciliation[\s\S]*?\} = \{\}\) \{\s*blockLegacyCloudflareCommandApiMutation\('deployCandidateWithReconciliation'\)/);
});

test('Command API local deploy and legacy PROD runtime redeploy are retired', () => {
  assert.equal(commandPackage.scripts.deploy, 'node scripts/retired-cloudflare-deploy.mjs');
  assert.doesNotMatch(runtimeTemplate, /\bnpx\s+wrangler\s+deploy\b/);
  assert.match(runtimeTemplate, /CLOUDFLARE_COMMAND_API_DEPLOY_RETIRED/);
});

test('Cloudflare retirement is scoped to Command API and does not disable ai-github-bridge', () => {
  assert.equal(bridgePackage.scripts.deploy, 'wrangler deploy');
});


test('current Command API deployment documentation is GCP-only and legacy Cloudflare is retired', () => {
  const normalize = value => value
    .replace(/[\`*_]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  const build = normalize(buildTrigger);
  const runbook = normalize(environmentRunbook);
  const lifecycle = normalize(deliveryLifecycle);

  for (const doc of [build, runbook, lifecycle]) {
    assert.ok(doc.includes('cloudbuild.promotion.yaml'));
    assert.ok(doc.includes('ai-github-bridge'));
  }

  assert.ok(build.includes('cloudflare workers builds'));
  assert.ok(build.includes('retired'));
  assert.ok(build.includes('not authorized deployment paths'));
  assert.ok(build.includes('wrangler deploy'));
  assert.ok(build.includes('wrangler versions upload'));
  assert.doesNotMatch(buildTrigger, /Deploy command:\s*`npx wrangler versions upload`/);

  assert.ok(runbook.includes('command api prod'));
  assert.ok(runbook.includes('cloudflare deployment prohibited'));
  assert.ok(runbook.includes('blocked until an approved gcp prod promotion path exists'));

  assert.ok(lifecycle.includes('command api prod'));
  assert.ok(lifecycle.includes('cloudflare deployment prohibited'));
  assert.ok(lifecycle.includes('blocked until implemented/approved'));
});
