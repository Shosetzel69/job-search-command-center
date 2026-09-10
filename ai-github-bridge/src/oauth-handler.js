const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function timingSafeEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const max = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;
  for (let index = 0; index < max; index += 1) {
    diff |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return diff === 0;
}

function encodeState(value) {
  const bytes = textEncoder.encode(JSON.stringify(value));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function decodeState(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return JSON.parse(textDecoder.decode(bytes));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function page(clientName, state, scopes) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Authorize Claude GitHub Agent</title>
<style>
body{font-family:system-ui,sans-serif;max-width:560px;margin:48px auto;padding:0 20px;background:#111827;color:#f9fafb}
.card{border:1px solid #374151;border-radius:12px;padding:24px;background:#1f2937}
input,button{box-sizing:border-box;width:100%;padding:12px;margin-top:12px;border-radius:8px;border:1px solid #4b5563}
input{background:#111827;color:#f9fafb}button{background:#2563eb;color:white;border:0;font-weight:600;cursor:pointer}.muted{color:#9ca3af;font-size:14px}
</style>
</head>
<body><div class="card">
<h2>Authorize Claude GitHub Agent</h2>
<p><strong>${escapeHtml(clientName)}</strong> requests access to the project MCP tools.</p>
<p class="muted">Scopes: ${escapeHtml(scopes.join(", ") || "default")}</p>
<form method="post" action="/authorize">
<input type="hidden" name="state" value="${escapeHtml(state)}">
<label>Owner access code</label>
<input type="password" name="access_code" autocomplete="current-password" required>
<button type="submit">Authorize</button>
</form>
</div></body></html>`;
}

export async function handleAuthorization(request, env) {
  if (!env.OAUTH_PROVIDER) return new Response("OAuth provider unavailable", { status: 503 });
  if (!env.MCP_OWNER_ACCESS_CODE) return new Response("MCP owner authentication is not configured", { status: 503 });

  if (request.method === "GET") {
    const oauthRequest = await env.OAUTH_PROVIDER.parseAuthRequest(request);
    const client = await env.OAUTH_PROVIDER.lookupClient(oauthRequest.clientId);
    if (!client) return new Response("Invalid OAuth client", { status: 400 });
    return new Response(page(client.clientName || "Claude", encodeState(oauthRequest), oauthRequest.scope || []), {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  }

  if (request.method === "POST") {
    const form = await request.formData();
    const state = form.get("state");
    const accessCode = form.get("access_code");
    if (typeof state !== "string" || typeof accessCode !== "string") return new Response("Invalid authorization request", { status: 400 });
    if (!timingSafeEqual(accessCode, env.MCP_OWNER_ACCESS_CODE)) return new Response("Access denied", { status: 403 });

    let oauthRequest;
    try {
      oauthRequest = decodeState(state);
    } catch {
      return new Response("Invalid authorization state", { status: 400 });
    }

    const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
      request: oauthRequest,
      userId: "job-search-owner",
      metadata: { label: "Claude GitHub Agent" },
      scope: oauthRequest.scope || [],
      props: { actor: "claude" },
      revokeExistingGrants: false,
    });
    return Response.redirect(redirectTo, 302);
  }

  return new Response("Method not allowed", { status: 405, headers: { allow: "GET, POST" } });
}
