const DEFAULT_REPOSITORY = "Shosetzel69/job-search-command-center";
const MAX_REQUEST_BYTES = 64 * 1024;
const textEncoder = new TextEncoder();

class BridgeError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "BridgeError";
    this.status = status;
    this.code = code;
  }
}

function jsonResponse(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

function base64UrlFromBytes(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function base64UrlFromText(value) {
  return base64UrlFromBytes(textEncoder.encode(value));
}

function base64ToBytes(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function derLength(length) {
  if (length < 0x80) return Uint8Array.of(length);
  const bytes = [];
  let remaining = length;
  while (remaining > 0) {
    bytes.unshift(remaining & 0xff);
    remaining >>>= 8;
  }
  return Uint8Array.of(0x80 | bytes.length, ...bytes);
}

function concatBytes(...parts) {
  const size = parts.reduce((total, part) => total + part.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function wrapPkcs1AsPkcs8(pkcs1) {
  const version = Uint8Array.of(0x02, 0x01, 0x00);
  const rsaAlgorithmIdentifier = Uint8Array.of(
    0x30, 0x0d,
    0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01,
    0x05, 0x00,
  );
  const octetString = concatBytes(Uint8Array.of(0x04), derLength(pkcs1.length), pkcs1);
  const body = concatBytes(version, rsaAlgorithmIdentifier, octetString);
  return concatBytes(Uint8Array.of(0x30), derLength(body.length), body);
}

export function pemToPkcs8(pem) {
  if (typeof pem !== "string" || !pem.trim()) {
    throw new BridgeError(503, "bridge_not_configured", "GitHub App private key is not configured");
  }

  const normalized = pem.replace(/\r/g, "").trim();
  const pkcs8Match = normalized.match(/-----BEGIN PRIVATE KEY-----\n?([\s\S]+?)\n?-----END PRIVATE KEY-----/);
  if (pkcs8Match) return base64ToBytes(pkcs8Match[1].replace(/\s/g, ""));

  const pkcs1Match = normalized.match(/-----BEGIN RSA PRIVATE KEY-----\n?([\s\S]+?)\n?-----END RSA PRIVATE KEY-----/);
  if (pkcs1Match) {
    return wrapPkcs1AsPkcs8(base64ToBytes(pkcs1Match[1].replace(/\s/g, "")));
  }

  throw new BridgeError(503, "bridge_not_configured", "Unsupported GitHub App private key format");
}

function timingSafeEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const max = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;
  for (let index = 0; index < max; index += 1) {
    diff |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return diff === 0;
}

function bearerToken(request) {
  const authorization = request.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

function actorCandidates(env) {
  return [
    {
      actor: "chatgpt",
      bridgeToken: env.CHATGPT_BRIDGE_TOKEN,
      appId: env.CHATGPT_GITHUB_APP_ID,
      installationId: env.CHATGPT_GITHUB_INSTALLATION_ID,
      privateKey: env.CHATGPT_GITHUB_PRIVATE_KEY,
      userAgent: "jobsearch-chatgpt-agent",
    },
    {
      actor: "claude",
      bridgeToken: env.CLAUDE_BRIDGE_TOKEN,
      appId: env.CLAUDE_GITHUB_APP_ID,
      installationId: env.CLAUDE_GITHUB_INSTALLATION_ID,
      privateKey: env.CLAUDE_GITHUB_PRIVATE_KEY,
      userAgent: "jobsearch-claude-agent",
    },
  ];
}

function resolveActor(request, env) {
  const token = bearerToken(request);
  if (!token) throw new BridgeError(401, "unauthorized", "Bearer authentication required");

  const actor = actorCandidates(env).find(
    (candidate) => candidate.bridgeToken && timingSafeEqual(token, candidate.bridgeToken),
  );
  if (!actor) throw new BridgeError(401, "unauthorized", "Invalid bridge credential");

  if (!actor.appId || !actor.installationId || !actor.privateKey) {
    throw new BridgeError(503, "bridge_not_configured", "GitHub App credentials are incomplete");
  }
  return actor;
}

async function signGitHubJwt(actor, cryptoImpl, now) {
  const pkcs8 = pemToPkcs8(actor.privateKey);
  let key;
  try {
    key = await cryptoImpl.subtle.importKey(
      "pkcs8",
      pkcs8,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
  } catch {
    throw new BridgeError(503, "bridge_not_configured", "GitHub App private key cannot be imported");
  }

  const nowSeconds = Math.floor(now() / 1000);
  const header = base64UrlFromText(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64UrlFromText(JSON.stringify({
    iat: nowSeconds - 60,
    exp: nowSeconds + 540,
    iss: String(actor.appId),
  }));
  const unsigned = `${header}.${payload}`;
  const signature = await cryptoImpl.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    textEncoder.encode(unsigned),
  );
  return `${unsigned}.${base64UrlFromBytes(new Uint8Array(signature))}`;
}

async function installationToken(actor, deps) {
  const jwt = await signGitHubJwt(actor, deps.cryptoImpl, deps.now);
  const response = await deps.fetchImpl(
    `https://api.github.com/app/installations/${actor.installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${jwt}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": actor.userAgent,
      },
    },
  );

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok || !payload?.token) {
    throw new BridgeError(502, "github_auth_failed", "GitHub App authentication failed");
  }
  return payload.token;
}

function normalizedIssue(issue) {
  return {
    number: issue.number,
    title: issue.title,
    state: issue.state,
    body: issue.body ?? null,
    html_url: issue.html_url,
    author: issue.user?.login ?? null,
    labels: Array.isArray(issue.labels)
      ? issue.labels.map((label) => (typeof label === "string" ? label : label?.name)).filter(Boolean)
      : [],
    created_at: issue.created_at ?? null,
    updated_at: issue.updated_at ?? null,
  };
}

function validateLabels(labels) {
  if (labels === undefined) return undefined;
  if (!Array.isArray(labels) || labels.length > 20) {
    throw new BridgeError(400, "invalid_request", "labels must be an array with at most 20 entries");
  }
  const normalized = labels.map((label) => {
    if (typeof label !== "string" || !label.trim() || label.length > 50) {
      throw new BridgeError(400, "invalid_request", "Each label must be a non-empty string up to 50 characters");
    }
    return label.trim();
  });
  if (!normalized.includes("ai-generated")) normalized.push("ai-generated");
  return [...new Set(normalized)];
}

async function readJson(request) {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new BridgeError(415, "unsupported_media_type", "application/json is required");
  }
  const text = await request.text();
  if (textEncoder.encode(text).length > MAX_REQUEST_BYTES) {
    throw new BridgeError(413, "request_too_large", "Request body exceeds 64 KiB");
  }
  try {
    const payload = JSON.parse(text || "{}");
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("object required");
    return payload;
  } catch {
    throw new BridgeError(400, "invalid_json", "Request body must be a JSON object");
  }
}

function validateCreateIssue(payload) {
  const allowed = new Set(["title", "body", "labels"]);
  for (const key of Object.keys(payload)) {
    if (!allowed.has(key)) throw new BridgeError(400, "invalid_request", `Unsupported field: ${key}`);
  }
  if (typeof payload.title !== "string" || !payload.title.trim() || payload.title.length > 256) {
    throw new BridgeError(400, "invalid_request", "title is required and must be at most 256 characters");
  }
  if (payload.body !== undefined && (typeof payload.body !== "string" || payload.body.length > 60000)) {
    throw new BridgeError(400, "invalid_request", "body must be a string up to 60000 characters");
  }
  return {
    title: payload.title.trim(),
    ...(payload.body !== undefined ? { body: payload.body } : {}),
    labels: validateLabels(payload.labels) ?? ["ai-generated"],
  };
}

function validateUpdateIssue(payload) {
  const allowed = new Set(["title", "body", "state", "labels"]);
  for (const key of Object.keys(payload)) {
    if (!allowed.has(key)) throw new BridgeError(400, "invalid_request", `Unsupported field: ${key}`);
  }
  if (Object.keys(payload).length === 0) throw new BridgeError(400, "invalid_request", "At least one field is required");

  const output = {};
  if (payload.title !== undefined) {
    if (typeof payload.title !== "string" || !payload.title.trim() || payload.title.length > 256) {
      throw new BridgeError(400, "invalid_request", "title must be a non-empty string up to 256 characters");
    }
    output.title = payload.title.trim();
  }
  if (payload.body !== undefined) {
    if (typeof payload.body !== "string" || payload.body.length > 60000) {
      throw new BridgeError(400, "invalid_request", "body must be a string up to 60000 characters");
    }
    output.body = payload.body;
  }
  if (payload.state !== undefined) {
    if (payload.state !== "open" && payload.state !== "closed") {
      throw new BridgeError(400, "invalid_request", "state must be open or closed");
    }
    output.state = payload.state;
  }
  if (payload.labels !== undefined) output.labels = validateLabels(payload.labels);
  return output;
}

async function githubIssueRequest(actor, method, suffix, body, env, deps) {
  const token = await installationToken(actor, deps);
  const repository = env.GITHUB_REPOSITORY || DEFAULT_REPOSITORY;
  if (repository !== DEFAULT_REPOSITORY) {
    throw new BridgeError(503, "bridge_not_configured", "Repository allowlist configuration is invalid");
  }

  const response = await deps.fetchImpl(`https://api.github.com/repos/${DEFAULT_REPOSITORY}/issues${suffix}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": actor.userAgent,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const message = typeof payload?.message === "string" ? payload.message : "GitHub API request failed";
    throw new BridgeError(response.status, "github_api_error", message);
  }
  return payload;
}

function correlationId(request, cryptoImpl) {
  const incoming = request.headers.get("x-correlation-id");
  if (incoming && /^[A-Za-z0-9._-]{1,80}$/.test(incoming)) return incoming;
  if (typeof cryptoImpl.randomUUID === "function") return cryptoImpl.randomUUID();
  return `bridge-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function audit(logger, entry) {
  logger.log(JSON.stringify({ event: "ai_github_bridge", ...entry }));
}

export async function handleRequest(request, env, customDeps = {}) {
  const deps = {
    fetchImpl: customDeps.fetchImpl || fetch,
    cryptoImpl: customDeps.cryptoImpl || crypto,
    now: customDeps.now || (() => Date.now()),
    logger: customDeps.logger || console,
  };
  const correlation = correlationId(request, deps.cryptoImpl);
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/health") {
    return jsonResponse({ status: "ok", service: "ai-github-bridge" });
  }

  let actor = null;
  let operation = "unknown";
  let target = url.pathname;
  try {
    actor = resolveActor(request, env);

    if (url.pathname === "/v1/actions/environment-deploy" && request.method === "POST") {
      operation = "dispatch_environment_deploy";
      target = "gcp-promotion";
      throw new BridgeError(
        410,
        "environment_deploy_retired",
        "AI environment deployment dispatch is retired; use the approved GCP promotion path.",
      );
    }

    if (url.pathname === "/v1/issues" && request.method === "POST") {
      operation = "create_issue";
      const body = validateCreateIssue(await readJson(request));
      const issue = await githubIssueRequest(actor, "POST", "", body, env, deps);
      audit(deps.logger, { correlation_id: correlation, actor: actor.actor, operation, target: "issues", status: 201 });
      return jsonResponse({ actor: actor.actor, issue: normalizedIssue(issue), correlation_id: correlation }, 201);
    }

    const issueMatch = url.pathname.match(/^\/v1\/issues\/(\d+)$/);
    if (issueMatch) {
      const issueNumber = Number(issueMatch[1]);
      target = `issue:${issueNumber}`;
      if (!Number.isSafeInteger(issueNumber) || issueNumber < 1) {
        throw new BridgeError(400, "invalid_request", "Invalid issue number");
      }

      if (request.method === "GET") {
        operation = "get_issue";
        const issue = await githubIssueRequest(actor, "GET", `/${issueNumber}`, null, env, deps);
        audit(deps.logger, { correlation_id: correlation, actor: actor.actor, operation, target, status: 200 });
        return jsonResponse({ actor: actor.actor, issue: normalizedIssue(issue), correlation_id: correlation });
      }

      if (request.method === "PATCH") {
        operation = "update_issue";
        const body = validateUpdateIssue(await readJson(request));
        const issue = await githubIssueRequest(actor, "PATCH", `/${issueNumber}`, body, env, deps);
        audit(deps.logger, { correlation_id: correlation, actor: actor.actor, operation, target, status: 200 });
        return jsonResponse({ actor: actor.actor, issue: normalizedIssue(issue), correlation_id: correlation });
      }
    }

    throw new BridgeError(404, "not_found", "Operation is not allowlisted");
  } catch (error) {
    const bridgeError = error instanceof BridgeError
      ? error
      : new BridgeError(500, "internal_error", "Unexpected bridge error");
    audit(deps.logger, {
      correlation_id: correlation,
      actor: actor?.actor || "unknown",
      operation,
      target,
      status: bridgeError.status,
      error_code: bridgeError.code,
    });
    return jsonResponse({ error: bridgeError.code, message: bridgeError.message, correlation_id: correlation }, bridgeError.status);
  }
}

export default {
  fetch(request, env) {
    return handleRequest(request, env);
  },
};
