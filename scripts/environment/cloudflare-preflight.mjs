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

export async function verifyCloudflareCredential(runtime, fetchImpl = fetch) {
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

  const workerResponse = await fetchImpl(
    `${base}/accounts/${runtime.cloudflareAccountId}/workers/scripts/${encodeURIComponent(runtime.workerName)}/settings`,
    { headers },
  );
  if (!workerResponse.ok) {
    throw new Error(`${label(runtime)} Cloudflare token cannot access Worker ${runtime.workerName} (HTTP ${workerResponse.status})`);
  }

  return Object.freeze({
    status: 'PASS',
    environment: runtime.environment,
    worker: runtime.workerName,
  });
}
