import test from "node:test";
import assert from "node:assert/strict";
import {
  buildProjectSnapshot,
  classifyRelatedIssues,
  deriveLifecycle,
  extractIssueNumbers,
  formatProjectSnapshot,
  parseReleaseTitle,
} from "./project_sanity.mjs";

test("release title and issue references are parsed deterministically", () => {
  assert.deepEqual(parseReleaseTitle("[Release 1 Wave 2] Candidate"), {
    release: 1,
    wave: 2,
    label: "Release 1 Wave 2",
  });
  assert.equal(parseReleaseTitle("[DEV] something else"), null);
  assert.deepEqual(extractIssueNumbers("Refs #193 #194 #188 #193"), [193, 194, 188]);
});

test("related issue classification keeps open blockers and QA only", () => {
  const result = classifyRelatedIssues([
    { number: 193, title: "[BUG][P1][DEV] Auth", state: "open", html_url: "u1" },
    { number: 194, title: "[BUG][P3][DEV] Run", state: "closed", html_url: "u2" },
    { number: 188, title: "[QA][Phase 7] Final validation", state: "open", html_url: "u3" },
    { number: 209, title: "PR", state: "open", html_url: "u4", pull_request: {} },
  ]);
  assert.deepEqual(result.blockers.map((item) => item.number), [193]);
  assert.deepEqual(result.qa.map((item) => item.number), [188]);
});

test("lifecycle never treats DEV deployment artifact as functional DEV PASS", () => {
  const sha = "a".repeat(40);
  assert.deepEqual(deriveLifecycle(sha, {
    dev: { candidate_sha: sha },
    testDeploy: null,
    testPass: null,
    prod: null,
  }), {
    dev: "DEPLOYED",
    test: "NOT_DEPLOYED",
    prod: "NOT_DEPLOYED",
    next_gate: "DEV_FUNCTIONAL_VERIFICATION",
  });
});

test("exact promotion evidence advances TEST and PROD gates", () => {
  const sha = "b".repeat(40);
  assert.equal(deriveLifecycle(sha, {
    dev: { candidate_sha: sha },
    testDeploy: { candidate_sha: sha },
    testPass: null,
    prod: null,
  }).next_gate, "TEST_INDEPENDENT_QA");

  assert.equal(deriveLifecycle(sha, {
    dev: { candidate_sha: sha },
    testDeploy: { candidate_sha: sha },
    testPass: { candidate_sha: sha },
    prod: null,
  }).next_gate, "PROD_GO_AND_ROLLBACK_CHECK");

  assert.equal(deriveLifecycle(sha, {
    dev: { candidate_sha: sha },
    testDeploy: { candidate_sha: sha },
    testPass: { candidate_sha: sha },
    prod: { candidate_sha: sha },
  }).next_gate, "PROD_SMOKE_CLOSEOUT");
});

test("snapshot derives current Wave state from GitHub evidence without mutation", async () => {
  const sha = "c".repeat(40);
  const issues = new Map([
    [193, { number: 193, title: "[BUG][P1][DEV] Auth", state: "open", html_url: "https://example/193" }],
    [188, { number: 188, title: "[QA][Phase 7] Final validation", state: "open", html_url: "https://example/188" }],
  ]);
  const api = {
    listOpenPullRequests: async () => [{
      number: 209,
      title: "[Release 1 Wave 2] Rebase auth remediation",
      body: "Refs #193 #188",
      html_url: "https://example/209",
      updated_at: "2026-09-18T01:06:17Z",
      head: { sha },
    }],
    getIssue: async (number) => issues.get(number),
    listWorkflowRuns: async (workflow) => workflow === "deploy-environment.yml"
      ? [{ id: 10, conclusion: "success", created_at: "2026-09-18T01:05:32Z", html_url: "https://example/run/10" }]
      : [],
    listRunArtifacts: async (runId) => runId === 10
      ? [{ name: "promotion-dev-pass", expired: false }]
      : [],
  };
  const readArtifact = async (_runId, artifactName) => {
    if (artifactName !== "promotion-dev-pass") throw new Error("not found");
    return {
      schema_version: "1.0",
      stage: "dev_pass",
      candidate_sha: sha,
      dev_pass: { run_id: "10", run_url: "https://example/run/10" },
    };
  };

  const snapshot = await buildProjectSnapshot({
    api,
    readArtifact,
    now: () => "2026-09-18T08:30:00Z",
  });

  assert.equal(snapshot.status, "PASS");
  assert.equal(snapshot.release.pr_number, 209);
  assert.equal(snapshot.environments.dev.status, "DEPLOYED");
  assert.equal(snapshot.environments.test.status, "NOT_DEPLOYED");
  assert.equal(snapshot.next_gate, "DEV_FUNCTIONAL_VERIFICATION");
  assert.deepEqual(snapshot.blockers.map((item) => item.number), [193]);
  assert.deepEqual(snapshot.qa.map((item) => item.number), [188]);
  assert.equal(snapshot.legacy.status, "UNTOUCHED");
  assert.equal(snapshot.chat_deletion.verdict, "REQUIRES_CHAT_COMPARISON");
  assert.match(formatProjectSnapshot(snapshot), /Release: Release 1 Wave 2/);
});

test("multiple active release PRs fail visibly instead of guessing", async () => {
  const api = {
    listOpenPullRequests: async () => [
      { number: 1, title: "[Release 1 Wave 2] A", head: { sha: "a".repeat(40) }, html_url: "a" },
      { number: 2, title: "[Release 1 Wave 3] B", head: { sha: "b".repeat(40) }, html_url: "b" },
    ],
  };
  const snapshot = await buildProjectSnapshot({
    api,
    readArtifact: async () => null,
    now: () => "2026-09-18T08:30:00Z",
  });
  assert.equal(snapshot.status, "WARNING");
  assert.equal(snapshot.release_candidates.length, 2);
  assert.match(snapshot.warnings[0], /ambiguous/i);
});
