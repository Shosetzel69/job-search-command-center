// #589 R3 — pure, read-only Cloud Run rollout assessment.
// Source SHA cannot be inferred from an image digest; never issue a deploy approval.
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const MAX_TRAFFIC_ROWS = 20;

export function validateImageDigest(value) {
  if (typeof value !== 'string' || !DIGEST.test(value)) throw new Error('invalid_image_digest');
  return value;
}

export function assessDevRollout(observation, expectedDigest) {
  const digest = validateImageDigest(expectedDigest);
  if (!observation || observation.environment !== 'dev' ||
      observation.task !== 'describe_dev_runtime' ||
      !Array.isArray(observation.effective_revisions) ||
      !observation.effective_revisions.length ||
      observation.effective_revisions.length > MAX_TRAFFIC_ROWS) {
    throw new Error('INSUFFICIENT_EVIDENCE');
  }
  let matchedPercent = 0, otherPercent = 0, unknownPercent = 0, total = 0;
  const seen = new Set();
  for (const row of observation.effective_revisions) {
    if (!row || typeof row.revision !== 'string' ||
        !/^[a-z0-9-]{6,100}$/.test(row.revision) ||
        !Number.isInteger(row.percent) || row.percent < 0 || row.percent > 100) {
      throw new Error('INSUFFICIENT_EVIDENCE');
    }
    // Cloud Run may report tag-only/previous revisions with 0% traffic:
    // these are NOT active serving revisions and must not dilute evidence.
    if (row.percent === 0) continue;
    if (seen.has(row.revision)) throw new Error('INSUFFICIENT_EVIDENCE');
    seen.add(row.revision);
    total += row.percent;
    if (row.image_digest === 'UNKNOWN' || !DIGEST.test(String(row.image_digest))) {
      unknownPercent += row.percent;
    } else if (row.image_digest === digest) {
      matchedPercent += row.percent;
    } else {
      otherPercent += row.percent;
    }
  }
  if (total !== 100) throw new Error('INSUFFICIENT_EVIDENCE');

  const verdict = unknownPercent ? 'IMAGE_NOT_PROVEN'
    : matchedPercent === 100 ? 'IMAGE_MATCHED_100_PERCENT'
    : matchedPercent > 0 ? 'SPLIT_TRAFFIC'
    : 'DIFFERENT_IMAGE';

  return Object.freeze({
    environment:'dev',
    target_alias: observation.resource?.split('/').at(-1) || 'UNKNOWN',
    expected_image_digest:digest,
    matched_percent:matchedPercent,
    other_percent:otherPercent,
    unknown_percent:unknownPercent,
    active_revision_count:seen.size,
    rollout_verdict:verdict,
    source_provenance:'UNVERIFIED',
    // Read-only observation is never an authorization to move traffic.
    traffic_cutover_authorized:false,
    observed_at:observation.observed_at || null,
  });
}

export function planDevDeployment(observation, {
  expected_current_digest, proposed_image_digest, expected_source_sha,
}) {
  const current=validateImageDigest(expected_current_digest);
  const proposed=validateImageDigest(proposed_image_digest);
  if (typeof expected_source_sha !== 'string' ||
      !/^[0-9a-f]{40}$/.test(expected_source_sha)) {
    throw new Error('invalid_source_sha');
  }
  // This is an OBSERVE preflight, not Cloud Run's mutating service UPDATE.
  const live=assessDevRollout(observation,current);
  if(live.rollout_verdict !== 'IMAGE_MATCHED_100_PERCENT') {
    throw new Error('DEPLOYMENT_PRECONDITION_FAILED');
  }
  return Object.freeze({
    environment:'dev',
    target_alias:live.target_alias,
    expected_current_digest:current,
    proposed_image_digest:proposed,
    expected_source_sha,
    source_image_link:'UNVERIFIED',
    change_required:current!==proposed,
    deployment_authorized:false,
    approval_required:current!==proposed,
    preflight_verdict:current===proposed
      ? 'ALREADY_AT_DIGEST' : 'SOURCE_IMAGE_PROVENANCE_REQUIRED',
    observed_at:live.observed_at,
  });
}
