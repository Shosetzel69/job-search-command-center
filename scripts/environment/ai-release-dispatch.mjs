export const OWNER_LOGIN = "Shosetzel69";
export const DEPLOY_WORKFLOW = "deploy-environment.yml";

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

function cli() {
  const command = parseDeployCommand(process.env.COMMENT_BODY, {
    actor:process.env.ACTOR,
    issueNumber:Number(process.env.ISSUE_NUMBER),
    commentId:Number(process.env.COMMENT_ID),
  });
  process.stdout.write(JSON.stringify(workflowDispatchPayload(command)));
}

if (import.meta.url === `file://${process.argv[1]}`) cli();
