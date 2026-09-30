#!/usr/bin/env bash
set -euo pipefail

ENVIRONMENT="${1:-}"
source "$(dirname "$0")/environment.sh" "${ENVIRONMENT}"

ROLE="roles/run.jobsExecutorWithOverrides"

gcloud run jobs add-iam-policy-binding "${JOB_NAME}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --member="serviceAccount:${RUNTIME_SA}" \
  --role="${ROLE}" \
  --quiet >/dev/null

gcloud run jobs get-iam-policy "${JOB_NAME}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --flatten="bindings[].members" \
  --filter="bindings.members:serviceAccount:${RUNTIME_SA} AND bindings.role:${ROLE}" \
  --format="value(bindings.role)" | grep -qx "${ROLE}" \
  || { echo "Runtime service account lacks override-capable invocation on ${JOB_NAME}" >&2; exit 13; }

echo "JOB_INVOCATION_IAM=PASS"
echo "ENVIRONMENT=${ENVIRONMENT}"
echo "JOB=${JOB_NAME}"
echo "RUNTIME_SA=${RUNTIME_SA}"
echo "ROLE=${ROLE}"
