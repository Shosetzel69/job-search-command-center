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

test('Cloudflare preflight verifies active account token and selected Worker through deployments API', async () => {
  const calls = [];
  const fakeFetch = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/tokens/verify')) {
      return response(200, { success: true, result: { status: 'active' } });
    }
    return response(200, { success: true, result: { deployments: [] } });
  };

  const result = await verifyCloudflareCredential(runtime, { fetchImpl: fakeFetch });
  assert.equal(result.status, 'PASS');
  assert.equal(result.authorization_probe, 'workers deployments API');
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /accounts\/1{32}\/tokens\/verify$/);
  assert.match(calls[1].url, /accounts\/1{32}\/workers\/scripts\/job-search-command-api\/deployments$/);
  assert.equal(calls[0].options.headers.authorization, 'Bearer secret-token');
  assert.equal(calls[1].options.headers.authorization, 'Bearer secret-token');
});

test('Cloudflare preflight fails closed on invalid token before Worker authorization probe', async () => {
  let calls = 0;
  const fakeFetch = async () => {
    calls += 1;
    return response(401, { success: false });
  };
  await assert.rejects(
    () => verifyCloudflareCredential(runtime, { fetchImpl: fakeFetch }),
    /token is not active/,
  );
  assert.equal(calls, 1);
});

test('Cloudflare preflight fails closed when deployments API cannot access selected Worker', async () => {
  let calls = 0;
  const fakeFetch = async url => {
    calls += 1;
    if (url.endsWith('/tokens/verify')) {
      return response(200, { success: true, result: { status: 'active' } });
    }
    return response(403, { success: false });
  };
  await assert.rejects(
    () => verifyCloudflareCredential(runtime, { fetchImpl: fakeFetch }),
    /cannot access Worker.*deployments \(HTTP 403\)/,
  );
  assert.equal(calls, 2);
});

test('Cloudflare preflight uses Worker deployments endpoint and no account-wide Worker listing', () => {
  const source = readFileSync(resolve(import.meta.dirname, 'environment', 'cloudflare-preflight.mjs'), 'utf8');
  assert.match(source, /workers\/scripts\/\$\{encodeURIComponent\(runtime\.workerName\)\}\/deployments/);
  assert.doesNotMatch(source, /wrangler', 'deployments'/);
  assert.doesNotMatch(source, /workers\/scripts\/.*\/settings/);
});

test('legacy bootstrap and deploy fail closed before Cloudflare preflight or mutation', () => {
  const source = readFileSync(resolve(import.meta.dirname, 'environment.mjs'), 'utf8');

  const bootstrap = source.match(/if \(command === 'bootstrap'\) \{[\s\S]*?(?=\n  if \(command === 'bootstrap-all'\))/)?.[0] || '';
  assert.match(bootstrap, /blockLegacyCloudflareCommandApiMutation\('bootstrap'\)/);
  assert.doesNotMatch(bootstrap, /verifyCloudflareCredential/);
  assert.doesNotMatch(bootstrap, /provisionEnvironment/);

  const deploy = source.match(/if \(command === 'deploy'\) \{[\s\S]*?(?=\n  if \(command === 'status'\))/)?.[0] || '';
  assert.match(deploy, /blockLegacyCloudflareCommandApiMutation\('deploy'\)/);
  assert.doesNotMatch(deploy, /verifyCloudflareCredential/);
  assert.doesNotMatch(deploy, /deployEnvironment/);
});
