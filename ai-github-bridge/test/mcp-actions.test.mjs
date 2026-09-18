import test from "node:test";
import assert from "node:assert/strict";
import { githubEnvironmentDeployRequest } from "../src/mcp.js";

function deps(assertRequest) {
  return {
    tokenProvider: async () => "installation-token",
    fetchImpl: async (url, init) => {
      assertRequest(String(url), init);
      return new Response(null, { status: 204 });
    },
  };
}

test("MCP DEV dispatch is hard-bound to main and deploy-environment.yml", async () => {
  const sha = "a".repeat(40);
  const result = await githubEnvironmentDeployRequest(
    {},
    { environment:"dev", source_sha:sha, issue_pr:"#204 / PR candidate" },
    deps((url, init) => {
      assert.equal(
        url,
        "https://api.github.com/repos/Shosetzel69/job-search-command-center/actions/workflows/deploy-environment.yml/dispatches",
      );
      assert.equal(init.method, "POST");
      assert.equal(init.headers.authorization, "Bearer installation-token");
      assert.deepEqual(JSON.parse(init.body), {
        ref:"main",
        inputs:{
          action:"deploy",
          environment:"dev",
          source_sha:sha,
          dry_run:false,
          issue_pr:"#204 / PR candidate",
        },
      });
    }),
  );
  assert.deepEqual(result, {
    actor:"claude",
    workflow:"deploy-environment.yml",
    ref:"main",
    environment:"dev",
    source_sha:sha,
  });
});

test("MCP TEST dispatch requires numeric DEV evidence", async () => {
  const sha = "b".repeat(40);
  await githubEnvironmentDeployRequest(
    {},
    { environment:"test", source_sha:sha, dev_evidence_run_id:"35290000001" },
    deps((_url, init) => {
      assert.deepEqual(JSON.parse(init.body), {
        ref:"main",
        inputs:{
          action:"deploy",
          environment:"test",
          source_sha:sha,
          dry_run:false,
          dev_evidence_run_id:"35290000001",
        },
      });
    }),
  );

  await assert.rejects(
    githubEnvironmentDeployRequest(
      {},
      { environment:"test", source_sha:sha },
      { tokenProvider: async () => { throw new Error("must not authenticate"); } },
    ),
    /requires numeric dev_evidence_run_id/,
  );
});

test("MCP environment dispatch rejects PROD before token acquisition", async () => {
  let tokenRequested = false;
  await assert.rejects(
    githubEnvironmentDeployRequest(
      {},
      { environment:"prod", source_sha:"c".repeat(40), issue_pr:"#204" },
      { tokenProvider: async () => { tokenRequested = true; return "token"; } },
    ),
    /environment must be dev or test/,
  );
  assert.equal(tokenRequested, false);
});
