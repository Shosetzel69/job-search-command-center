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

test('legacy environment workflow cannot dispatch Command API bootstrap/deploy', () => {
  assert.match(environmentWorkflow, /options: \[validate, status, isolation-test, prod-preflight\]/);
  assert.match(environmentWorkflow, /CLOUDFLARE_COMMAND_API_DEPLOY_RETIRED/);
  const guard = environmentWorkflow.indexOf('CLOUDFLARE_COMMAND_API_DEPLOY_RETIRED');
  const live = environmentWorkflow.indexOf('  live-environment:');
  assert.ok(guard >= 0 && live > guard);
});

test('legacy PROD cutover exposes verify-only and fails closed before mutation', () => {
  assert.match(prodWorkflow, /options: \[verify-deployed-status\]/);
  const block = prodWorkflow.indexOf('Block retired Cloudflare Command API promotion');
  const legacyGuard = prodWorkflow.indexOf('Guard immutable candidate, TEST gate and rollback readiness');
  assert.ok(block >= 0 && legacyGuard > block);
  assert.match(prodWorkflow, /CLOUDFLARE_COMMAND_API_DEPLOY_RETIRED/);
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
