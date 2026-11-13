// GOV85 DEV-only exception to retired exit-86 promotion, bound to one reviewed cohort.
// This verifier authorizes the dedicated image-only route, never legacy promotion.
export const CANDIDATE_SHA = '121f88e212013d2c4665bb70f881a3bcee365d21';
export const TICKET_SCOPE = '515,520,535';
export const SUPPORTED_ACTIONS = Object.freeze(['preflight', 'inventory', 'images-only']);

export function validateGov85Exception({ sha, tickets, action, environment } = {}) {
  if (environment !== 'dev') throw new Error('GOV85_EXCEPTION_DEV_ONLY');
  if (sha !== CANDIDATE_SHA) throw new Error('GOV85_EXCEPTION_EXACT_SHA_REQUIRED');
  if (tickets !== TICKET_SCOPE) throw new Error('GOV85_EXCEPTION_TICKET_SCOPE_REQUIRED');
  if (!SUPPORTED_ACTIONS.includes(action)) throw new Error('GOV85_EXCEPTION_ACTION_DENIED');
  return Object.freeze({ environment: 'dev', candidateSha: sha, tickets: TICKET_SCOPE, action });
}

if (process.argv[1]?.endsWith('gov85-dev-exception.mjs')) {
  const [sha, tickets, action, environment] = process.argv.slice(2);
  try {
    const decision = validateGov85Exception({ sha, tickets, action, environment });
    process.stdout.write(`GOV85_DEV_EXCEPTION_ACCEPTED action=${decision.action} sha=${decision.candidateSha} tickets=${decision.tickets}\n`);
  } catch (error) {
    process.stderr.write(`GOV85_DEV_EXCEPTION_DENIED ${error.message}\n`);
    process.exitCode = 86;
  }
}
