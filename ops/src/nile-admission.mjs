import {assertNileGrantPolicy, validateNileProbeArguments} from './nile-policy.mjs';

// Secure integration boundary: only a trusted, read-only storage adapter may
// provide grants. It must independently validate immutable generation and the
// latest revocation record. A caller-supplied grant is never accepted.
export async function inspectNileAuthorization({request,actor,nowMs,readGrant,readUsage}) {
  validateNileProbeArguments(request);
  if (typeof readGrant !== 'function' || typeof readUsage !== 'function') {
    throw new Error('nile_grant_backend_unavailable');
  }
  const grantResult=await readGrant(request.authorization_id);
  if (!grantResult || grantResult.trusted !== true ||
      typeof grantResult.generation !== 'string' || !grantResult.generation ||
      !grantResult.revocation_checked) {
    throw new Error('nile_grant_unverified');
  }
  const usage=await readUsage(request.authorization_id);
  if (!usage || usage.trusted !== true ||
      !Number.isInteger(usage.globalMutateUsed) ||
      !Number.isInteger(usage.globalOperationsUsed)) {
    throw new Error('nile_usage_unverified');
  }
  const policy=assertNileGrantPolicy({
    grant:{...grantResult.grant,used:usage.grantUsed},
    request,actor,nowMs,
    globalMutateUsed:usage.globalMutateUsed,
    globalOperationsUsed:usage.globalOperationsUsed
  });
  return Object.freeze({
    policy, grant_generation:grantResult.generation,
    // This result is informational, NOT a dispatch authorization.
    dispatch_authorized:false
  });
}
