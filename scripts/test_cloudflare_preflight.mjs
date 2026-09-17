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

test('Cloudflare preflight verifies active account token and selected Worker without mutation', async () => {
  const calls = [];
  const fakeFetch = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/tokens/verify')) return response(200, { success: true, result: { status: 'active' } });
    return response(200, { success: true, result: {} });
  };
  const result = await verifyCloudflareCredential(runtime, fakeFetch);
  assert.equal(result.status, 'PASS');
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /accounts\/1{32}\/tokens\/verify$/);
  assert.match(calls[1].url, /workers\/scripts\/job-search-command-api\/settings$/);
  assert.equal(calls[0].options.headers.authorization, 'Bearer secret-token');
});

test('Cloudflare preflight fails closed on invalid token before Worker access', async () => {
  let calls = 0;
  const fakeFetch = async () => {
    calls += 1;
    return response(401, { success: false });
  };
  await assert.rejects(() => verifyCloudflareCredential(runtime, fakeFetch), /token is not active/);
  assert.equal(calls, 1);
});

test('Cloudflare preflight fails closed when token cannot access selected Worker', async () => {
  const fakeFetch = async url => {
    if (url.endsWith('/tokens/verify')) return response(200, { success: true, result: { status: 'active' } });
    return response(403, { success: false });
  };
  await assert.rejects(() => verifyCloudflareCredential(runtime, fakeFetch), /cannot access Worker/);
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
