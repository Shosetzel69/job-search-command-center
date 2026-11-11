export const OWNER_LOGIN = "Shosetzel69";
export const SEARCH_WORKFLOW = "test-full-search.yml";
export const VALIDATION_WORKFLOW = "dev-source-validation.yml";

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

export function parseValidationCommand(body, { actor, issueNumber, commentId } = {}) {
  if (actor !== OWNER_LOGIN) throw new Error("Only the repository owner may dispatch targeted DEV source validation.");
  if (!Number.isSafeInteger(Number(issueNumber)) || Number(issueNumber) < 1) throw new Error("Valid issue number is required.");
  if (!Number.isSafeInteger(Number(commentId)) || Number(commentId) < 1) throw new Error("Valid comment id is required.");
  const text = typeof body === "string" ? body.trim() : "";
  const match = text.match(/^\/jscc-validate[ \t]+dev[ \t]+([0-9a-fA-F]{40})[ \t]+(src-[a-z0-9]+(?:,src-[a-z0-9]+){0,19})$/);
  if (!match) throw new Error("Invalid validation command. Use /jscc-validate dev <40-char-sha> <comma-separated-source-ids>.");
  const sourceIds = match[2].split(",");
  if (new Set(sourceIds).size !== sourceIds.length) throw new Error("Source IDs must be unique.");
  return { environment:"dev", sourceSha:match[1].toLowerCase(), sourceIds };
}

export function validationWorkflowDispatchPayload(command) {
  if (!command || command.environment !== "dev") throw new Error("Only DEV source validation is supported.");
  if (!/^[0-9a-f]{40}$/.test(command.sourceSha || "")) throw new Error("Invalid source SHA.");
  if (!Array.isArray(command.sourceIds) || command.sourceIds.length < 1 || command.sourceIds.length > 20 ||
      command.sourceIds.some(id => !/^src-[a-z0-9]+$/.test(id)) ||
      new Set(command.sourceIds).size !== command.sourceIds.length) {
    throw new Error("Invalid source IDs.");
  }
  return {
    ref:"main",
    inputs:{
      source_sha:command.sourceSha,
      source_ids:command.sourceIds.join(","),
      confirm_validation:"VALIDATE",
    },
  };
}

export function dispatchEnvelope(body, context = {}) {
  const text = typeof body === "string" ? body.trim() : "";
  if (text.startsWith("/jscc-deploy")) {
    throw new Error("AI deployment dispatch is retired; use the canonical GCP promotion path.");
  }
  if (text.startsWith("/jscc-search")) {
    return { workflow:SEARCH_WORKFLOW, payload:searchWorkflowDispatchPayload(parseSearchCommand(text, context)) };
  }
  if (text.startsWith("/jscc-validate")) {
    return { workflow:VALIDATION_WORKFLOW, payload:validationWorkflowDispatchPayload(parseValidationCommand(text, context)) };
  }
  throw new Error("Invalid AI control command.");
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
