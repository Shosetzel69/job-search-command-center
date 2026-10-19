// ATC-531-NILE-EXEC-01: pure admission policy for the existing MCP gateway.
// Not connected to a dispatch route until IAM, grant-store and worker gates pass.
export const NILE_PROBE_TASK = 'run_nile_probe';
export const NILE_PROBE_SUITE = 'nile-auth-concurrency';
export const NILE_PROBE_CLASS = 'MUTATE';
export const NILE_PROBE_JOB = 'jscc-nile-tests-dev';
export const NILE_PROBE_DATABASE = 'jobsearch_temp';
export const NILE_PROBE_MAX_GRANT_MS = 24 * 60 * 60 * 1000;
export const NILE_PROBE_JOB_DEADLINE_MS = 300_000;
export const NILE_PROBE_MAX_USES = 5;
export const NILE_PROBE_DAILY_LIMIT = 5;
export const OPS_COMBINED_DAILY_LIMIT = 50;

function reject(code) { throw new Error(code); }
function exactKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) reject('invalid_probe_arguments');
  if (Object.keys(value).some(k => !keys.includes(k)) || keys.some(k => !Object.hasOwn(value, k))) reject('invalid_probe_arguments');
}
function nonempty(value) { return typeof value === 'string' && value.length > 0 && value.trim() === value; }
function sha40(value) { return typeof value === 'string' && /^[0-9a-f]{40}$/.test(value); }

// Pure strict schema; deliberately NO URL, SQL, environment, job or suite input.
export function validateNileProbeArguments(args) {
  exactKeys(args, ['authorization_id','expected_probe_sha']);
  if (!nonempty(args.authorization_id) || !/^[A-Za-z0-9_-]{16,128}$/.test(args.authorization_id)) reject('invalid_authorization_id');
  if (!sha40(args.expected_probe_sha)) reject('invalid_probe_sha');
  return Object.freeze({authorization_id:args.authorization_id,expected_probe_sha:args.expected_probe_sha});
}

// Local policy validation only. Caller must additionally verify immutable storage
// generation/revocation, effective principal IAM, shared lease and atomic counters.
export function assertNileGrantPolicy({grant, request, actor, nowMs, globalMutateUsed, globalOperationsUsed}) {
  const args = validateNileProbeArguments(request);
  if (!grant || typeof grant !== 'object' || Array.isArray(grant)) reject('grant_missing');
  if (!nonempty(actor) || !Number.isSafeInteger(nowMs)) reject('invalid_admission_context');
  const fixed = {
    authorization_id:args.authorization_id, actor, task:NILE_PROBE_TASK,
    suite:NILE_PROBE_SUITE, task_class:NILE_PROBE_CLASS,
    probe_sha:args.expected_probe_sha, job:NILE_PROBE_JOB,
    database_alias:NILE_PROBE_DATABASE
  };
  for (const [k,v] of Object.entries(fixed)) if (grant[k] !== v) reject('grant_binding_mismatch');
  for (const k of ['repository','atc_id','catalog_version','worker_digest','provider_host','provider_database_id','namespace','owner_authorization_ref']) {
    if (!nonempty(grant[k])) reject('grant_binding_missing');
  }
  if (grant.atc_id !== 'ATC-531-NILE-EXEC-01' || grant.repository !== 'Shosetzel69/job-search-command-center') reject('grant_binding_mismatch');
  if (!Number.isSafeInteger(grant.not_before_ms) || !Number.isSafeInteger(grant.expires_ms) ||
      grant.expires_ms <= grant.not_before_ms || grant.expires_ms - grant.not_before_ms > NILE_PROBE_MAX_GRANT_MS ||
      nowMs < grant.not_before_ms || nowMs + NILE_PROBE_JOB_DEADLINE_MS > grant.expires_ms) reject('grant_expired_or_inactive');
  if (grant.revoked !== false) reject('grant_revoked');
  if (!Number.isInteger(grant.max_uses) || grant.max_uses < 1 || grant.max_uses > NILE_PROBE_MAX_USES ||
      !Number.isInteger(grant.used) || grant.used < 0 || grant.used >= grant.max_uses) reject('grant_exhausted');
  if (!Number.isInteger(globalMutateUsed) || globalMutateUsed < 0 || globalMutateUsed >= NILE_PROBE_DAILY_LIMIT ||
      !Number.isInteger(globalOperationsUsed) || globalOperationsUsed < 0 || globalOperationsUsed >= OPS_COMBINED_DAILY_LIMIT) reject('daily_cap_exhausted');
  return Object.freeze({task:NILE_PROBE_TASK,task_class:NILE_PROBE_CLASS,job:NILE_PROBE_JOB,authorization_id:args.authorization_id});
}
