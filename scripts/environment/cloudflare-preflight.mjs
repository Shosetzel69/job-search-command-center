import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

function label(runtime) {
  return String(runtime.environment || 'unknown').toUpperCase();
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function trustedWorkerWorkspace() {
  return resolve(String(process.env.SOURCE_WORKSPACE || process.cwd()), 'command-api');
}

function wranglerEnv(runtime) {
  const allow = [
    'PATH', 'HOME', 'USER', 'SHELL', 'CI', 'GITHUB_ACTIONS', 'RUNNER_TEMP', 'RUNNER_TOOL_CACHE',
    'RUNNER_OS', 'TMPDIR', 'TEMP', 'TMP', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT',
    'NODE_OPTIONS', 'NPM_CONFIG_CACHE',
  ];
  const env = {};
  for (const key of allow) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return {
    ...env,
    CLOUDFLARE_ACCOUNT_ID: runtime.cloudflareAccountId,
    CLOUDFLARE_API_TOKEN: runtime.cloudflareToken,
    WRANGLER_SEND_METRICS: 'false',
  };
}

export async function verifyCloudflareCredential(runtime, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const runImpl = options.runImpl || execFileSync;
  const headers = {
    accept: 'application/json',
    authorization: `Bearer ${runtime.cloudflareToken}`,
  };
  const base = 'https://api.cloudflare.com/client/v4';

  // Account-owned token verification is non-mutating and confirms the token is active
  // for the selected account. Worker authorization is validated separately through
  // Wrangler so the preflight follows the same granular Worker role model as deploy.
  const verifyResponse = await fetchImpl(
    `${base}/accounts/${runtime.cloudflareAccountId}/tokens/verify`,
    { headers },
  );
  const verifyPayload = await readJson(verifyResponse);
  if (!verifyResponse.ok || verifyPayload?.success !== true || verifyPayload?.result?.status !== 'active') {
    throw new Error(`${label(runtime)} Cloudflare account token is not active for the selected account (HTTP ${verifyResponse.status})`);
  }

  try {
    runImpl(
      'npx',
      ['wrangler', 'deployments', 'list', '--name', runtime.workerName, '--json'],
      {
        cwd: trustedWorkerWorkspace(),
        env: wranglerEnv(runtime),
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
  } catch {
    throw new Error(`${label(runtime)} Cloudflare token cannot access Worker ${runtime.workerName} through Wrangler granular authorization`);
  }

  return Object.freeze({
    status: 'PASS',
    environment: runtime.environment,
    worker: runtime.workerName,
    authorization_probe: 'wrangler deployments list',
  });
}
