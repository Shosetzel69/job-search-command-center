import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { verifyCloudflareCredential } from './environment/cloudflare-preflight.mjs';

const runtime = {
  environment: 'dev',
  cloudflareAccountId: '1'.repeat(32),
  cloudflareToken: 'secret-token',
  workerName: 'job-search-command-api',
};

function response(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return payload; },
  };
}

test('Cloudflare preflight verifies active account token and selected Worker through non-mutating Wrangler probe', async () => {
  const fetchCalls = [];
  const runCalls = [];
  const fakeFetch = async (url, options) => {
    fetchCalls.push({ url, options });
    return response(200, { success: true, result: { status: 'active' } });
  };
  const fakeRun = (command, args, options) => {
    runCalls.push({ command, args, options });
    return '[]';
  };
  const result = await verifyCloudflareCredential(runtime, { fetchImpl: fakeFetch, runImpl: fakeRun });
  assert.equal(result.status, 'PASS');
  assert.equal(result.authorization_probe, 'wrangler deployments list');
  assert.equal(fetchCalls.length, 1);
  assert.match(fetchCalls[0].url, /accounts\/1{32}\/tokens\/verify$/);
  assert.equal(fetchCalls[0].options.headers.authorization, 'Bearer secret-token');
  assert.equal(runCalls.length, 1);
  assert.equal(runCalls[0].command, 'npx');
  assert.deepEqual(runCalls[0].args, ['wrangler', 'deployments', 'list', '--name', 'job-search-command-api', '--json']);
  assert.equal(runCalls[0].options.env.CLOUDFLARE_ACCOUNT_ID, '1'.repeat(32));
  assert.equal(runCalls[0].options.env.CLOUDFLARE_API_TOKEN, 'secret-token');
});

test('Cloudflare preflight fails closed on invalid token before Worker authorization probe', async () => {
  let fetchCalls = 0;
  let runCalls = 0;
  const fakeFetch = async () => {
    fetchCalls += 1;
    return response(401, { success: false });
  };
  const fakeRun = () => {
    runCalls += 1;
    return '[]';
  };
  await assert.rejects(
    () => verifyCloudflareCredential(runtime, { fetchImpl: fakeFetch, runImpl: fakeRun }),
    /token is not active/,
  );
  assert.equal(fetchCalls, 1);
  assert.equal(runCalls, 0);
});

test('Cloudflare preflight fails closed when Wrangler granular authorization cannot access selected Worker', async () => {
  const fakeFetch = async () => response(200, { success: true, result: { status: 'active' } });
  const fakeRun = () => {
    throw new Error('forbidden');
  };
  await assert.rejects(
    () => verifyCloudflareCredential(runtime, { fetchImpl: fakeFetch, runImpl: fakeRun }),
    /cannot access Worker.*Wrangler granular authorization/,
  );
});

test('Cloudflare preflight no longer uses legacy script settings endpoint as granular authorization proof', () => {
  const source = readFileSync(resolve(import.meta.dirname, 'environment', 'cloudflare-preflight.mjs'), 'utf8');
  assert.doesNotMatch(source, /workers\/scripts\/.*\/settings/);
  assert.match(source, /wrangler', 'deployments', 'list'/);
});

test('bootstrap and deploy invoke Cloudflare preflight before mutating operations', () => {
  const source = readFileSync(resolve(import.meta.dirname, 'environment.mjs'), 'utf8');
  const bootstrap = source.indexOf("if (command === 'bootstrap')");
  const bootstrapPreflight = source.indexOf('await verifyCloudflareCredential(runtime);', bootstrap);
  const bootstrapProvision = source.indexOf('await provisionEnvironment(runtime)', bootstrap);
  assert.ok(bootstrapPreflight > bootstrap && bootstrapPreflight < bootstrapProvision);

  const deploy = source.indexOf("if (command === 'deploy')");
  const deployPreflight = source.indexOf('await verifyCloudflareCredential(runtime);', deploy);
  const deployMutation = source.indexOf('await deployEnvironment(runtime)', deploy);
  assert.ok(deployPreflight > deploy && deployPreflight < deployMutation);
});
