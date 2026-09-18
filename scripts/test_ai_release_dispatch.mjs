import assert from "node:assert/strict";
import test from "node:test";
import { OWNER_LOGIN, parseDeployCommand, workflowDispatchPayload } from "./environment/ai-release-dispatch.mjs";

const SHA = "A".repeat(40);

test("DEV command binds issue evidence and canonical dispatch inputs", () => {
  const command = parseDeployCommand(`/jscc-deploy dev ${SHA}`, { actor:OWNER_LOGIN, issueNumber:204, commentId:12345 });
  assert.deepEqual(command, {
    environment:"dev",
    sourceSha:"a".repeat(40),
    issuePr:"issue #204 / comment 12345",
    devEvidenceRunId:null,
  });
  assert.deepEqual(workflowDispatchPayload(command), {
    ref:"main",
    inputs:{
      action:"deploy",
      environment:"dev",
      source_sha:"a".repeat(40),
      dry_run:false,
      issue_pr:"issue #204 / comment 12345",
    },
  });
});

test("TEST command requires explicit DEV evidence run id", () => {
  const command = parseDeployCommand(`/jscc-deploy test ${SHA} 35290000001`, { actor:OWNER_LOGIN, issueNumber:204, commentId:12346 });
  assert.deepEqual(workflowDispatchPayload(command), {
    ref:"main",
    inputs:{
      action:"deploy",
      environment:"test",
      source_sha:"a".repeat(40),
      dry_run:false,
      dev_evidence_run_id:"35290000001",
    },
  });
});

test("owner restriction is fail closed", () => {
  assert.throws(
    () => parseDeployCommand(`/jscc-deploy dev ${SHA}`, { actor:"someone-else", issueNumber:204, commentId:12345 }),
    /Only the repository owner/,
  );
});

test("PROD, malformed SHA and extra inputs are rejected", () => {
  for (const body of [
    `/jscc-deploy prod ${SHA}`,
    "/jscc-deploy dev short",
    `/jscc-deploy dev ${SHA} extra`,
    `/jscc-deploy test ${SHA}`,
    `/jscc-deploy test ${SHA} not-a-run`,
    `/jscc-deploy dev ${SHA}\n/prod`,
  ]) {
    assert.throws(
      () => parseDeployCommand(body, { actor:OWNER_LOGIN, issueNumber:204, commentId:12345 }),
      /Invalid release command/,
    );
  }
});
