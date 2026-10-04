#!/usr/bin/env bash
set -euo pipefail

ENVIRONMENT="${1:-}"
source "$(dirname "$0")/environment.sh" "${ENVIRONMENT}"

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MANIFEST="${ROOT}/scripts/gcp/runtime_seed_files.txt"

test -f "${MANIFEST}" || { echo "Missing runtime seed manifest" >&2; exit 4; }

gcloud storage buckets describe "gs://${RUNTIME_BUCKET}"   --project="${PROJECT_ID}" >/dev/null   || { echo "Runtime bucket is missing for ${ENVIRONMENT}" >&2; exit 5; }

while IFS= read -r file; do
  [[ -n "${file}" ]] || continue
  gcloud storage objects describe "gs://${RUNTIME_BUCKET}/seed/${file}"     --project="${PROJECT_ID}" >/dev/null     || { echo "Runtime seed verification failed: ${file}" >&2; exit 6; }
done < "${MANIFEST}"

echo "SEED_MANIFEST_PASS=${ENVIRONMENT}"
