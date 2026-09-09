import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, webcrypto } from "node:crypto";
import { handleRequest, pemToPkcs8 } from "../src/index.js";

function privateKeyPem(type = "pkcs1") {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return privateKey.export({ type, format: "pem" }).toString();
}

function env(overrides = {}) {
  return {
    GITHUB_REPOSITORY: "Shosetzel69/job-search-command-center",
    CHATGPT_BRIDGE_TOKEN: "bridge-chatgpt",
    CHATGPT_GITHUB_APP_ID: "4884202",
    CHATGPT_GITHUB_INSTALLATION_ID: "160337921",
    CHATGPT_GITHUB_PRIVATE_KEY: privateKeyPem(),
    CLAUDE_BRIDGE_TOKEN: "bridge-claude",
    CLAUDE_GITHUB_APP_ID: "4887682",
    CLAUDE_GITHUB_INSTALLATION_ID: "160379580",
    CLAUDE_GITHUB_PRIVATE_KEY: privateKeyPem(),
    ...overrides,
  };
}

function deps(fetchImpl, logs = []) {
  return {
    fetchImpl,
    cryptoImpl: webcrypto,
    now: () => Date.UTC(2026, 8, 9, 18, 0, 0),
    logger: { log: (entry) => logs.push(entry) },
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function issuePayload(number = 132, author = "jobsearch-chatgpt-agent[bot]") {
  return {
    number,
    title: "Bridge test",
    state: "open",
    body: "body",
    html_url: `https://github.com/Shosetzel69/job-search-command-center/issues/${number}`,
    user: { login: author },
    labels: [{ name: "ai-generated" }],
    created_at: "2026-09-09T18:00:00Z",
    updated_at: "2026-09-09T18:00:00Z",
  };
}

test("pemToPkcs8 accepts GitHub-style PKCS#1 keys", () => {
  const bytes = pemToPkcs8(privateKeyPem("pkcs1"));
  assert.ok(bytes instanceof Uint8Array);
  assert.equal(bytes[0], 0x30);
});

test("health is public and performs no GitHub request", async () => {
  let called = false;
  const response = await handleRequest(
    new Request("https://bridge.example/health"),
    {},
    deps(async () => { called = true; return json({}); }),
  );
  assert.equal(response.status, 200);
  assert.equal(called, false);
  assert.deepEqual(await response.json(), { status: "ok", service: "ai-github-bridge" });
});

test("missing bearer token is rejected before GitHub access", async () => {
  let called = false;
  const response = await handleRequest(
    new Request("https://bridge.example/v1/issues/132"),
    env(),
    deps(async () => { called = true; return json({}); }),
  );
  assert.equal(response.status, 401);
  assert.equal(called, false);
  assert.equal((await response.json()).error, "unauthorized");
});

test("ChatGPT create issue uses fixed repository, app installation and ai-generated label", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).includes("/app/installations/160337921/access_tokens")) {
      assert.match(options.headers.authorization, /^Bearer [^.]+\.[^.]+\.[^.]+$/);
      return json({ token: "installation-chatgpt" }, 201);
    }
    assert.equal(String(url), "https://api.github.com/repos/Shosetzel69/job-search-command-center/issues");
    assert.equal(options.headers.authorization, "Bearer installation-chatgpt");
    const body = JSON.parse(options.body);
    assert.equal(body.title, "Created through bridge");
    assert.deepEqual(body.labels, ["requirement", "ai-generated"]);
    return json(issuePayload(140), 201);
  };

  const response = await handleRequest(
    new Request("https://bridge.example/v1/issues", {
      method: "POST",
      headers: { authorization: "Bearer bridge-chatgpt", "content-type": "application/json" },
      body: JSON.stringify({ title: "Created through bridge", labels: ["requirement"] }),
    }),
    env(),
    deps(fetchImpl),
  );

  assert.equal(response.status, 201);
  const payload = await response.json();
  assert.equal(payload.actor, "chatgpt");
  assert.equal(payload.issue.author, "jobsearch-chatgpt-agent[bot]");
  assert.equal(calls.length, 2);
});

test("Claude bearer credential maps only to Claude GitHub App", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push(String(url));
    if (String(url).includes("/app/installations/160379580/access_tokens")) {
      return json({ token: "installation-claude" }, 201);
    }
    assert.equal(options.headers.authorization, "Bearer installation-claude");
    return json(issuePayload(131, "jobsearch-claude-agent[bot]"));
  };

  const response = await handleRequest(
    new Request("https://bridge.example/v1/issues/131", {
      headers: { authorization: "Bearer bridge-claude" },
    }),
    env(),
    deps(fetchImpl),
  );

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.actor, "claude");
  assert.equal(payload.issue.author, "jobsearch-claude-agent[bot]");
  assert.ok(calls[0].includes("160379580"));
  assert.ok(!calls[0].includes("160337921"));
});

test("unsupported operations are blocked and never become a generic GitHub proxy", async () => {
  let called = false;
  const response = await handleRequest(
    new Request("https://bridge.example/v1/files/ARCHITECTURE.md", {
      method: "POST",
      headers: { authorization: "Bearer bridge-chatgpt", "content-type": "application/json" },
      body: "{}",
    }),
    env(),
    deps(async () => { called = true; return json({}); }),
  );
  assert.equal(response.status, 404);
  assert.equal(called, false);
  assert.equal((await response.json()).message, "Operation is not allowlisted");
});

test("update issue rejects unsupported fields before GitHub access", async () => {
  let called = false;
  const response = await handleRequest(
    new Request("https://bridge.example/v1/issues/132", {
      method: "PATCH",
      headers: { authorization: "Bearer bridge-chatgpt", "content-type": "application/json" },
      body: JSON.stringify({ assignees: ["someone"] }),
    }),
    env(),
    deps(async () => { called = true; return json({}); }),
  );
  assert.equal(response.status, 400);
  assert.equal(called, false);
  assert.equal((await response.json()).error, "invalid_request");
});

test("GitHub authentication failure is sanitized and does not leak secrets", async () => {
  const testEnv = env();
  const response = await handleRequest(
    new Request("https://bridge.example/v1/issues/132", {
      headers: { authorization: "Bearer bridge-chatgpt" },
    }),
    testEnv,
    deps(async () => json({ message: "bad credentials", token: "should-not-leak" }, 401)),
  );
  assert.equal(response.status, 502);
  const text = await response.text();
  assert.ok(!text.includes("bridge-chatgpt"));
  assert.ok(!text.includes("should-not-leak"));
  assert.ok(!text.includes("BEGIN RSA PRIVATE KEY"));
  assert.match(text, /github_auth_failed/);
});

test("repository allowlist cannot be redirected by environment drift", async () => {
  let issueCall = false;
  const fetchImpl = async (url) => {
    if (String(url).includes("/access_tokens")) return json({ token: "installation-chatgpt" }, 201);
    issueCall = true;
    return json(issuePayload());
  };
  const response = await handleRequest(
    new Request("https://bridge.example/v1/issues/132", {
      headers: { authorization: "Bearer bridge-chatgpt" },
    }),
    env({ GITHUB_REPOSITORY: "other/repository" }),
    deps(fetchImpl),
  );
  assert.equal(response.status, 503);
  assert.equal(issueCall, false);
  assert.equal((await response.json()).error, "bridge_not_configured");
});
