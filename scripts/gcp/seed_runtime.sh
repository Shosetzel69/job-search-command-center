#!/usr/bin/env bash
set -euo pipefail

ENVIRONMENT="${1:-}"
source "$(dirname "$0")/environment.sh" "${ENVIRONMENT}"

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MANIFEST="${ROOT}/scripts/gcp/runtime_seed_files.txt"
SEED_DIR="$(mktemp -d)"
trap 'rm -rf "${SEED_DIR}"' EXIT

test -f "${MANIFEST}" || { echo "Missing runtime seed manifest" >&2; exit 4; }

cp "${ROOT}/data/applications.json" "${SEED_DIR}/applications.json"
cp "${ROOT}/data/search-config.json" "${SEED_DIR}/search-config.json"

cat >"${SEED_DIR}/jobs.json" <<'JSON'
{"schema_version":"1.0","generated_at":"2026-01-01T00:00:00+00:00","freshness_hours":24,"criteria":{},"records_inspected":0,"results":0,"excluded_count":0,"jobs":[]}
JSON
cat >"${SEED_DIR}/run-status.json" <<'JSON'
{"schema_version":"1.0","run_id":"gcp-bootstrap","status":"completed","started_at":"2026-01-01T00:00:00+00:00","completed_at":"2026-01-01T00:00:00+00:00","sources":[],"sources_processed":0,"records_inspected":0,"jobs_published":0,"excluded":0,"limitations":[]}
JSON
cat >"${SEED_DIR}/run-history.json" <<'JSON'
{"schema_version":"1.0","runs":[]}
JSON
cat >"${SEED_DIR}/search-state.json" <<'JSON'
{"schema_version":"1.0","query_progress":{},"job_first_seen":{},"usage":{}}
JSON

gcloud storage buckets describe "gs://${RUNTIME_BUCKET}" --project="${PROJECT_ID}" >/dev/null 2>&1 ||   gcloud storage buckets create "gs://${RUNTIME_BUCKET}"     --project="${PROJECT_ID}"     --location="${REGION}"     --default-storage-class=STANDARD     --uniform-bucket-level-access

gcloud storage buckets add-iam-policy-binding "gs://${RUNTIME_BUCKET}"   --project="${PROJECT_ID}"   --member="serviceAccount:${RUNTIME_SA}"   --role="roles/storage.objectUser" >/dev/null

while IFS= read -r file; do
  [[ -n "${file}" ]] || continue
  test -f "${SEED_DIR}/${file}" || { echo "Missing mandatory runtime seed file: ${file}" >&2; exit 5; }

  if gcloud storage objects describe "gs://${RUNTIME_BUCKET}/seed/${file}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
    echo "SEED_EXISTS=${file}"
  else
    gcloud storage cp "${SEED_DIR}/${file}" "gs://${RUNTIME_BUCKET}/seed/${file}" --project="${PROJECT_ID}" >/dev/null
    echo "SEED_CREATED=${file}"
  fi
done < "${MANIFEST}"

while IFS= read -r file; do
  [[ -n "${file}" ]] || continue
  gcloud storage objects describe "gs://${RUNTIME_BUCKET}/seed/${file}" --project="${PROJECT_ID}" >/dev/null     || { echo "Runtime seed verification failed: ${file}" >&2; exit 6; }
done < "${MANIFEST}"

echo "SEED_MANIFEST_PASS=${ENVIRONMENT}"
