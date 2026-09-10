import test from "node:test";
import assert from "node:assert/strict";
import { githubIssueRequest } from "../src/mcp.js";

const issuePayload = {
  number: 136,
  title: "Remote MCP",
  state: "open",
  body: "body",
  html_url: "https://github.com/Shosetzel69/job-search-command-center/issues/136",
  user: { login: "jobsearch-claude-agent[bot]" },
  labels: [{ name: "ai-generated" }],
  created_at: "2026-09-10T00:00:00Z",
  updated_at: "2026-09-10T00:00:00Z",
};

function deps(assertRequest) {
  return {
    tokenProvider: async () => "installation-token",
    fetchImpl: async (url, init) => {
      assertRequest(url, init);
      return new Response(JSON.stringify(issuePayload), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  };
}

test("get_issue calls GitHub directly with the Claude installation token", async () => {
  const result = await githubIssueRequest({}, "GET", 136, undefined, deps((url, init) => {
    assert.equal(url, "https://api.github.com/repos/Shosetzel69/job-search-command-center/issues/136");
    assert.equal(init.method, "GET");
    assert.equal(init.headers.authorization, "Bearer installation-token");
    assert.equal(init.body, undefined);
  }));

  assert.equal(result.actor, "claude");
  assert.equal(result.issue.number, 136);
});

test("create_issue enforces ai-generated and calls GitHub directly", async () => {
  const result = await githubIssueRequest({}, "POST", null, { title: "test", labels: ["bug"] }, deps((url, init) => {
    assert.equal(url, "https://api.github.com/repos/Shosetzel69/job-search-command-center/issues");
    assert.equal(init.method, "POST");
    assert.deepEqual(JSON.parse(init.body), {
      title: "test",
      labels: ["bug", "ai-generated"],
    });
  }));

  assert.equal(result.issue.author, "jobsearch-claude-agent[bot]");
});

test("update_issue preserves ai-generated when labels are replaced", async () => {
  await githubIssueRequest({}, "PATCH", 136, { labels: ["bug"] }, deps((url, init) => {
    assert.equal(url, "https://api.github.com/repos/Shosetzel69/job-search-command-center/issues/136");
    assert.equal(init.method, "PATCH");
    assert.deepEqual(JSON.parse(init.body), { labels: ["bug", "ai-generated"] });
  }));
});

test("GitHub API error message is surfaced to the MCP tool", async () => {
  await assert.rejects(
    githubIssueRequest({}, "GET", 136, undefined, {
      tokenProvider: async () => "installation-token",
      fetchImpl: async () => new Response(JSON.stringify({ message: "Forbidden" }), {
        status: 403,
        headers: { "content-type": "application/json" },
      }),
    }),
    /Forbidden/,
  );
});
