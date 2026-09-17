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

export async function verifyCloudflareCredential(runtime, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const headers = {
    accept: 'application/json',
    authorization: `Bearer ${runtime.cloudflareToken}`,
  };
  const base = 'https://api.cloudflare.com/client/v4';

  const verifyResponse = await fetchImpl(
    `${base}/accounts/${runtime.cloudflareAccountId}/tokens/verify`,
    { headers },
  );
  const verifyPayload = await readJson(verifyResponse);
  if (!verifyResponse.ok || verifyPayload?.success !== true || verifyPayload?.result?.status !== 'active') {
    throw new Error(`${label(runtime)} Cloudflare account token is not active for the selected account (HTTP ${verifyResponse.status})`);
  }

  // Use the exact Worker Deployments API as the non-mutating authorization probe.
  // Cloudflare documents this endpoint as accepting Workers Scripts Read/Write,
  // which maps cleanly to granular per-Worker roles without requiring account-wide listing.
  const deploymentResponse = await fetchImpl(
    `${base}/accounts/${runtime.cloudflareAccountId}/workers/scripts/${encodeURIComponent(runtime.workerName)}/deployments`,
    { headers },
  );
  const deploymentPayload = await readJson(deploymentResponse);
  if (!deploymentResponse.ok || deploymentPayload?.success !== true) {
    throw new Error(
      `${label(runtime)} Cloudflare token cannot access Worker ${runtime.workerName} deployments (HTTP ${deploymentResponse.status})`,
    );
  }

  return Object.freeze({
    status: 'PASS',
    environment: runtime.environment,
    worker: runtime.workerName,
    authorization_probe: 'workers deployments API',
  });
}
