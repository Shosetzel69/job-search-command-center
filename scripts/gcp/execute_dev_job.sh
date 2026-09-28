#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="jscc-dev"
REGION="europe-west1"
JOB_NAME="jscc-search-dev"

project_number="$(gcloud projects describe "${PROJECT_ID}" --format='value(projectNumber)')"
BUCKET="jscc-dev-runtime-${project_number}"
LOCK="gs://${BUCKET}/locks/heavy-search.lock"
lock_payload="$(mktemp)"
lock_acquired=0

cleanup() {
  rm -f "${lock_payload}"
  if [[ "${lock_acquired}" == "1" ]]; then
    gcloud storage rm "${LOCK}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

printf 'started_at=%s\nactor=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(gcloud config get-value account 2>/dev/null)" >"${lock_payload}"

if ! gcloud storage cp "${lock_payload}" "${LOCK}" --if-generation-match=0 >/dev/null 2>&1; then
  echo "ACTIVE_RUN_REJECTED: atomic DEV heavy-search lock already exists (${LOCK})" >&2
  exit 10
fi
lock_acquired=1

gcloud run jobs execute "${JOB_NAME}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --wait
