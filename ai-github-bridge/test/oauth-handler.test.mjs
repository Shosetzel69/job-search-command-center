import test from "node:test";
import assert from "node:assert/strict";
import { handleAuthorization } from "../src/oauth-handler.js";

function env(completed = []) {
  return {
    MCP_OWNER_ACCESS_CODE: "owner-secret",
    OAUTH_PROVIDER: {
      async parseAuthRequest() {
        return { clientId: "claude-test", scope: ["mcp"] };
      },
      async lookupClient(clientId) {
        return clientId === "claude-test" ? { clientName: "Claude Test" } : null;
      },
      async completeAuthorization(options) {
        completed.push(options);
        return { redirectTo: "https://claude.ai/callback?code=test-code" };
      },
    },
  };
}

async function authorizationState(testEnv) {
  const response = await handleAuthorization(new Request("https://bridge.example/authorize?client_id=claude-test"), testEnv);
  assert.equal(response.status, 200);
  const html = await response.text();
  const match = html.match(/name="state" value="([^"]+)"/);
  assert.ok(match);
  assert.ok(!html.includes("owner-secret"));
  return match[1];
}

test("authorization page never exposes the owner access code", async () => {
  await authorizationState(env());
});

test("invalid owner access code cannot create an OAuth grant", async () => {
  const completed = [];
  const testEnv = env(completed);
  const state = await authorizationState(testEnv);
  const body = new URLSearchParams({ state, access_code: "wrong" });
  const response = await handleAuthorization(new Request("https://bridge.example/authorize", { method: "POST", body }), testEnv);
  assert.equal(response.status, 403);
  assert.equal(completed.length, 0);
});

test("valid owner authorization binds the grant to Claude server-side", async () => {
  const completed = [];
  const testEnv = env(completed);
  const state = await authorizationState(testEnv);
  const body = new URLSearchParams({ state, access_code: "owner-secret" });
  const response = await handleAuthorization(new Request("https://bridge.example/authorize", { method: "POST", body }), testEnv);
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "https://claude.ai/callback?code=test-code");
  assert.equal(completed.length, 1);
  assert.equal(completed[0].userId, "job-search-owner");
  assert.deepEqual(completed[0].props, { actor: "claude" });
  assert.equal(completed[0].revokeExistingGrants, false);
});
