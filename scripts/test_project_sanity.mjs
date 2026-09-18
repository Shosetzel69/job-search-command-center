import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildProjectSnapshot,
  classifyRelatedIssues,
  deriveLifecycle,
  extractIssueNumbers,
  formatProjectSnapshot,
  parseReleaseTitle,
} from "./project_sanity.mjs";

test("release checkpoint and FRC titles are parsed deterministically", () => {
  assert.deepEqual(parseReleaseTitle("[Release 1 Wave 2] Candidate"), {
    release: 1,
    wave: 2,
    cycle_type: "checkpoint",
    label: "Release 1 Wave 2",
  });
  assert.deepEqual(parseReleaseTitle("[Release 1 FRC] Final candidate"), {
    release: 1,
    wave: null,
    cycle_type: "frc",
    label: "Release 1 Final Release Candidate",
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

test("DEV deployment evidence is not overstated as functional DEV PASS", () => {
  const sha = "a".repeat(40);
  assert.deepEqual(deriveLifecycle(sha, {
    dev: { candidate_sha: sha },
    testDeploy: null,
    testPass: null,
    prod: null,
  }, "checkpoint"), {
    dev: "DEPLOYED",
    test: "NOT_DEPLOYED",
    prod: "NOT_APPLICABLE",
    next_gate: "DEV_FUNCTIONAL_VERIFICATION",
  });
});

test("checkpoint TEST PASS stops before PROD", () => {
  const sha = "b".repeat(40);
  assert.deepEqual(deriveLifecycle(sha, {
    dev: { candidate_sha: sha },
    testDeploy: { candidate_sha: sha },
    testPass: { candidate_sha: sha },
    prod: null,
  }, "checkpoint"), {
    dev: "DEPLOYED",
    test: "PASS",
    prod: "NOT_APPLICABLE",
    next_gate: "CHECKPOINT_COMPLETE_NEXT_WAVE",
  });
});

test("FRC TEST PASS advances to PROD GO gate", () => {
  const sha = "c".repeat(40);
  assert.equal(deriveLifecycle(sha, {
    dev: { candidate_sha: sha },
    testDeploy: { candidate_sha: sha },
    testPass: { candidate_sha: sha },
    prod: null,
  }, "frc").next_gate, "PROD_GO_AND_ROLLBACK_CHECK");
});

test("snapshot derives current Wave checkpoint state without mutation", async () => {
  const sha = "d".repeat(40);
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
  assert.equal(snapshot.release.cycle_type, "checkpoint");
  assert.equal(snapshot.environments.dev.status, "DEPLOYED");
  assert.equal(snapshot.environments.test.status, "NOT_DEPLOYED");
  assert.equal(snapshot.environments.prod.status, "NOT_APPLICABLE");
  assert.equal(snapshot.next_gate, "DEV_FUNCTIONAL_VERIFICATION");
  assert.deepEqual(snapshot.blockers.map((item) => item.number), [193]);
  assert.deepEqual(snapshot.qa.map((item) => item.number), [188]);
  assert.equal(snapshot.legacy.status, "UNTOUCHED");
  assert.equal(snapshot.chat_deletion.verdict, "REQUIRES_CHAT_COMPARISON");
  assert.match(formatProjectSnapshot(snapshot), /Cycle: checkpoint/);
});

test("multiple active release PRs fail visibly instead of guessing", async () => {
  const api = {
    listOpenPullRequests: async () => [
      { number: 1, title: "[Release 1 Wave 2] A", head: { sha: "a".repeat(40) }, html_url: "a" },
      { number: 2, title: "[Release 1 FRC] B", head: { sha: "b".repeat(40) }, html_url: "b" },
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

test("checkpoint PROD evidence is flagged as invalid", async () => {
  const sha = "e".repeat(40);
  const api = {
    listOpenPullRequests: async () => [{
      number: 209,
      title: "[Release 1 Wave 2] Candidate",
      body: "",
      html_url: "https://example/209",
      head: { sha },
    }],
    getIssue: async () => null,
    listWorkflowRuns: async (workflow) => workflow === "prod-cutover.yml"
      ? [{ id: 99, conclusion: "success", html_url: "https://example/99" }]
      : [],
    listRunArtifacts: async (runId) => runId === 99 ? [{ name: "release-record", expired: false }] : [],
  };
  const snapshot = await buildProjectSnapshot({
    api,
    readArtifact: async (_runId, artifactName) => {
      if (artifactName !== "release-record") throw new Error("not found");
      return { candidate_sha: sha, stage: "prod_pass" };
    },
  });
  assert.equal(snapshot.status, "WARNING");
  assert.equal(snapshot.environments.prod.status, "INVALID_FOR_CHECKPOINT");
  assert.match(snapshot.warnings[0], /forbids checkpoint promotion/i);
});

test("snapshot reports the stage-specific TEST deployment run instead of inherited DEV evidence", async () => {
  const sha = "f".repeat(40);
  const api = {
    listOpenPullRequests: async () => [{
      number: 209,
      title: "[Release 1 Wave 2] Candidate",
      body: "",
      html_url: "https://example/209",
      head: { sha },
    }],
    getIssue: async () => null,
    listWorkflowRuns: async (workflow) => workflow === "deploy-environment.yml"
      ? [
          { id: 20, conclusion: "success", html_url: "https://example/run/20" },
          { id: 10, conclusion: "success", html_url: "https://example/run/10" },
        ]
      : [],
    listRunArtifacts: async (runId) => runId === 20
      ? [{ name: "promotion-test-deployed", expired: false }]
      : [{ name: "promotion-dev-pass", expired: false }],
  };
  const readArtifact = async (runId, artifactName) => {
    if (runId === 20 && artifactName === "promotion-test-deployed") {
      return {
        stage: "test_deployed",
        candidate_sha: sha,
        dev_pass: { run_id: "10", run_url: "https://example/run/10" },
        test_deploy: { run_id: "20", run_url: "https://example/run/20" },
      };
    }
    if (runId === 10 && artifactName === "promotion-dev-pass") {
      return {
        stage: "dev_pass",
        candidate_sha: sha,
        dev_pass: { run_id: "10", run_url: "https://example/run/10" },
      };
    }
    throw new Error("not found");
  };

  const snapshot = await buildProjectSnapshot({ api, readArtifact });
  assert.equal(snapshot.environments.dev.evidence.run_id, 10);
  assert.equal(snapshot.environments.test.deployment_evidence.run_id, 20);
  assert.equal(snapshot.environments.test.deployment_evidence.run_url, "https://example/run/20");
});

test("chat sanity contract is chat-first and keeps project status secondary", () => {
  const contract = readFileSync(new URL("../docs/project-sanity.md", import.meta.url), "utf8");
  const requiredInOrder = [
    "Last material action:",
    "Result:",
    "Subject:",
    "Relevance: CURRENT | PARTIALLY_CURRENT | SUPERSEDED | CLOSED",
    "CHANGED SINCE",
    "CURRENT RELEVANT STATE",
    "NEXT",
    "UNIQUE / PERSISTENCE",
    "CHAT VERDICT",
  ];

  let previous = -1;
  for (const marker of requiredInOrder) {
    const index = contract.indexOf(marker);
    assert.ok(index > previous, `Expected sanity contract marker in order: ${marker}`);
    previous = index;
  }

  assert.match(contract, /Do not start with release\/DEV\/TEST\/PROD status\./);
  assert.match(contract, /Do not dump the full project snapshot by default\./);
  assert.match(contract, /PARTIALLY_CURRENT/);
  assert.match(contract, /SUPERSEDED/);
  assert.match(contract, /CLOSED never implies .*SAFE TO DELETE.* by itself\./);
  assert.match(contract, /SANITY: BLOCKED/);
});
