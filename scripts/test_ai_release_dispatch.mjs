import assert from "node:assert/strict";
import test from "node:test";
import { OWNER_LOGIN, DEPLOY_WORKFLOW, SEARCH_WORKFLOW, parseDeployCommand, workflowDispatchPayload, parseSearchCommand, searchWorkflowDispatchPayload, dispatchEnvelope } from "./environment/ai-release-dispatch.mjs";

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


test("TEST search command is owner-only, SHA-bound and dispatches only controlled TEST workflow", () => {
  const command = parseSearchCommand(`/jscc-search test ${SHA}`, { actor:OWNER_LOGIN, issueNumber:412, commentId:20001 });
  assert.deepEqual(command, { environment:"test", sourceSha:"a".repeat(40) });
  assert.deepEqual(searchWorkflowDispatchPayload(command), {
    ref:"main",
    inputs:{ source_sha:"a".repeat(40), owner_gate:"APPROVED" },
  });
  assert.deepEqual(dispatchEnvelope(`/jscc-search test ${SHA}`, { actor:OWNER_LOGIN, issueNumber:412, commentId:20001 }), {
    workflow:SEARCH_WORKFLOW,
    payload:{ ref:"main", inputs:{ source_sha:"a".repeat(40), owner_gate:"APPROVED" } },
  });
  assert.equal(dispatchEnvelope(`/jscc-deploy dev ${SHA}`, { actor:OWNER_LOGIN, issueNumber:412, commentId:20002 }).workflow, DEPLOY_WORKFLOW);
});

test("TEST search rejects non-owner, malformed SHA, extra args and any non-TEST target", () => {
  assert.throws(
    () => parseSearchCommand(`/jscc-search test ${SHA}`, { actor:"someone-else", issueNumber:412, commentId:20001 }),
    /Only the repository owner/,
  );
  for (const body of [
    "/jscc-search test short",
    `/jscc-search test ${SHA} extra`,
    `/jscc-search dev ${SHA}`,
    `/jscc-search prod ${SHA}`,
  ]) {
    assert.throws(
      () => parseSearchCommand(body, { actor:OWNER_LOGIN, issueNumber:412, commentId:20001 }),
      /Invalid search command/,
    );
  }
});
