export const OWNER_LOGIN = "Shosetzel69";
export const DEPLOY_WORKFLOW = "deploy-environment.yml";
export const SEARCH_WORKFLOW = "test-full-search.yml";

export function parseDeployCommand(body, { actor, issueNumber, commentId } = {}) {
  if (actor !== OWNER_LOGIN) throw new Error("Only the repository owner may dispatch release environments.");
  if (!Number.isSafeInteger(Number(issueNumber)) || Number(issueNumber) < 1) throw new Error("Valid issue number is required.");
  if (!Number.isSafeInteger(Number(commentId)) || Number(commentId) < 1) throw new Error("Valid comment id is required.");
  const text = typeof body === "string" ? body.trim() : "";

  const dev = text.match(/^\/jscc-deploy[ \t]+dev[ \t]+([0-9a-fA-F]{40})$/);
  if (dev) {
    return {
      environment:"dev",
      sourceSha:dev[1].toLowerCase(),
      issuePr:`issue #${Number(issueNumber)} / comment ${Number(commentId)}`,
      devEvidenceRunId:null,
    };
  }

  const test = text.match(/^\/jscc-deploy[ \t]+test[ \t]+([0-9a-fA-F]{40})[ \t]+([0-9]+)$/);
  if (test) {
    return {
      environment:"test",
      sourceSha:test[1].toLowerCase(),
      issuePr:null,
      devEvidenceRunId:test[2],
    };
  }

  throw new Error("Invalid release command. Use /jscc-deploy dev <40-char-sha> or /jscc-deploy test <40-char-sha> <dev-run-id>.");
}

export function workflowDispatchPayload(command) {
  if (!command || !["dev","test"].includes(command.environment)) throw new Error("Unsupported environment.");
  if (!/^[0-9a-f]{40}$/.test(command.sourceSha || "")) throw new Error("Invalid source SHA.");

  return {
    ref:"main",
    inputs:{
      action:"deploy",
      environment:command.environment,
      source_sha:command.sourceSha,
      dry_run:false,
      ...(command.environment === "dev" ? { issue_pr:command.issuePr } : {}),
      ...(command.environment === "test" ? { dev_evidence_run_id:command.devEvidenceRunId } : {}),
    },
  };
}

export function parseSearchCommand(body, { actor, issueNumber, commentId } = {}) {
  if (actor !== OWNER_LOGIN) throw new Error("Only the repository owner may dispatch controlled TEST search.");
  if (!Number.isSafeInteger(Number(issueNumber)) || Number(issueNumber) < 1) throw new Error("Valid issue number is required.");
  if (!Number.isSafeInteger(Number(commentId)) || Number(commentId) < 1) throw new Error("Valid comment id is required.");
  const text = typeof body === "string" ? body.trim() : "";
  const match = text.match(/^\/jscc-search[ \t]+test[ \t]+([0-9a-fA-F]{40})$/);
  if (!match) throw new Error("Invalid search command. Use /jscc-search test <40-char-sha>.");
  return { environment:"test", sourceSha:match[1].toLowerCase() };
}

export function searchWorkflowDispatchPayload(command) {
  if (!command || command.environment !== "test") throw new Error("Only TEST search is supported.");
  if (!/^[0-9a-f]{40}$/.test(command.sourceSha || "")) throw new Error("Invalid source SHA.");
  return {
    ref:"main",
    inputs:{
      source_sha:command.sourceSha,
      owner_gate:"APPROVED",
    },
  };
}

export function dispatchEnvelope(body, context = {}) {
  const text = typeof body === "string" ? body.trim() : "";
  if (text.startsWith("/jscc-search")) {
    return { workflow:SEARCH_WORKFLOW, payload:searchWorkflowDispatchPayload(parseSearchCommand(text, context)) };
  }
  return { workflow:DEPLOY_WORKFLOW, payload:workflowDispatchPayload(parseDeployCommand(text, context)) };
}

function cli() {
  const context = {
    actor:process.env.ACTOR,
    issueNumber:Number(process.env.ISSUE_NUMBER),
    commentId:Number(process.env.COMMENT_ID),
  };
  process.stdout.write(JSON.stringify(dispatchEnvelope(process.env.COMMENT_BODY, context)));
}

if (import.meta.url === `file://${process.argv[1]}`) cli();
