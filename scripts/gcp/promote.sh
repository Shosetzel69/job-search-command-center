#!/usr/bin/env bash
set -euo pipefail

ENVIRONMENT="${1:-}"
CANDIDATE_SHA="${2:-}"
DEV_EVIDENCE_FILE="${3:-}"

[[ "${CANDIDATE_SHA}" =~ ^[0-9a-f]{40}$ ]] || { echo "candidate SHA must be a full lowercase 40-character SHA" >&2; exit 2; }
source "$(dirname "$0")/environment.sh" "${ENVIRONMENT}"

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
EVIDENCE_DIR="${ROOT}/artifacts/gcp-promotion"
mkdir -p "${EVIDENCE_DIR}"
EVIDENCE_FILE="${EVIDENCE_DIR}/${ENVIRONMENT}-${CANDIDATE_SHA}.json"

if [[ "${ENVIRONMENT}" == "test" ]]; then
  test -n "${DEV_EVIDENCE_FILE}" || { echo "TEST promotion requires DEV evidence file" >&2; exit 7; }
  python3 "${ROOT}/scripts/gcp/verify_promotion_evidence.py"     --file "${DEV_EVIDENCE_FILE}"     --environment dev     --candidate-sha "${CANDIDATE_SHA}"
fi

job_digest="$(gcloud artifacts docker images describe "${JOB_IMAGE_REPO}:${CANDIDATE_SHA}"   --project=jscc-shared --format='value(image_summary.digest)')"
service_digest="$(gcloud artifacts docker images describe "${SERVICE_IMAGE_REPO}:${CANDIDATE_SHA}"   --project=jscc-shared --format='value(image_summary.digest)')"
[[ "${job_digest}" =~ ^sha256:[0-9a-f]{64}$ ]] || { echo "Missing immutable Job artifact for candidate" >&2; exit 8; }
[[ "${service_digest}" =~ ^sha256:[0-9a-f]{64}$ ]] || { echo "Missing immutable Service artifact for candidate" >&2; exit 9; }

"${ROOT}/scripts/gcp/seed_runtime.sh" "${ENVIRONMENT}"

for secret in NILE_DATABASE_URL ALLOWED_GOOGLE_SUB GOOGLE_CLIENT_ID; do
  gcloud secrets describe "${secret}" --project="${PROJECT_ID}" >/dev/null     || { echo "Required secret is missing in ${PROJECT_ID}: ${secret}" >&2; exit 10; }
done

frontend_origin="https://${SERVICE_NAME}-${PROJECT_NUMBER}.${REGION}.run.app"

gcloud run jobs deploy "${JOB_NAME}"   --project="${PROJECT_ID}"   --region="${REGION}"   --image="${JOB_IMAGE_REPO}@${job_digest}"   --service-account="${RUNTIME_SA}"   --cpu=2   --memory=4Gi   --tasks=1   --parallelism=1   --max-retries=1   --task-timeout=45m   --set-env-vars="APP_ENV=${ENVIRONMENT},SOURCE_SHA=${CANDIDATE_SHA},RUN_TRIGGER=gcp-system,GCP_RUNTIME_BUCKET=${RUNTIME_BUCKET}"   --set-secrets="NILE_DATABASE_URL=NILE_DATABASE_URL:latest"   --add-volume="mount-path=/runtime,type=cloud-storage,bucket=${RUNTIME_BUCKET},readonly=false"

gcloud run services deploy "${SERVICE_NAME}"   --project="${PROJECT_ID}"   --region="${REGION}"   --image="${SERVICE_IMAGE_REPO}@${service_digest}"   --service-account="${RUNTIME_SA}"   --allow-unauthenticated   --set-env-vars="APP_ENV=${ENVIRONMENT},SOURCE_SHA=${CANDIDATE_SHA},RUNTIME_DATA_SHA=${CANDIDATE_SHA},SEARCH_MODE=${SEARCH_MODE},JSCC_RUNTIME_BACKEND=gcp,GCP_PROJECT_ID=${PROJECT_ID},GCP_RUNTIME_BUCKET=${RUNTIME_BUCKET},GCP_SEARCH_JOB=${JOB_NAME},GCP_REGION=${REGION},FRONTEND_ORIGIN=${frontend_origin},SERVICE_ORIGIN=${frontend_origin}"   --set-secrets="NILE_DATABASE_URL=NILE_DATABASE_URL:latest,ALLOWED_GOOGLE_SUB=ALLOWED_GOOGLE_SUB:latest,GOOGLE_CLIENT_ID=GOOGLE_CLIENT_ID:latest"

service_url="$(gcloud run services describe "${SERVICE_NAME}"   --project="${PROJECT_ID}" --region="${REGION}" --format='value(status.url)')"
latest_ready="$(gcloud run services describe "${SERVICE_NAME}"   --project="${PROJECT_ID}" --region="${REGION}" --format='value(status.latestReadyRevisionName)')"
traffic="$(gcloud run services describe "${SERVICE_NAME}"   --project="${PROJECT_ID}" --region="${REGION}" --format='value(status.traffic[0].percent)')"

test "${service_url}" = "${frontend_origin}" || { echo "Unexpected service URL: ${service_url}" >&2; exit 11; }
test "${traffic}" = "100" || { echo "Latest revision does not have 100% traffic" >&2; exit 12; }

health="$(curl --fail --silent --show-error "${service_url}/health")"
db_health="$(curl --fail --silent --show-error "${service_url}/health/db")"

HEALTH_JSON="${health}" DB_HEALTH_JSON="${db_health}" python3 - "${ENVIRONMENT}" "${CANDIDATE_SHA}" "${EXPECTED_DATABASE}" <<'PY'
import json, os, sys
env, sha, expected_db = sys.argv[1:]
health=json.loads(os.environ["HEALTH_JSON"])
db=json.loads(os.environ["DB_HEALTH_JSON"])
assert health.get("status")=="ok", health
assert health.get("environment")==env, health
assert health.get("source_sha")==sha, health
assert health.get("runtime_data_sha")==sha, health
assert health.get("runtime_backend")=="gcp", health
assert health.get("runtime_configured") is True, health
assert health.get("auth_configured") is True, health
assert db.get("status")=="ok", db
assert db.get("environment")==env, db
assert db.get("database")==expected_db, db
PY

python3 - "${EVIDENCE_FILE}" "${ENVIRONMENT}" "${CANDIDATE_SHA}" "${job_digest}" "${service_digest}" "${latest_ready}" "${service_url}" "${EXPECTED_DATABASE}" <<'PY'
import json, sys, datetime
path, env, sha, job_digest, service_digest, revision, url, database = sys.argv[1:]
payload={
  "schema_version":"1.0",
  "environment":env,
  "candidate_sha":sha,
  "job_digest":job_digest,
  "service_digest":service_digest,
  "service_revision":revision,
  "service_url":url,
  "database":database,
  "health":"PASS",
  "db_health":"PASS",
  "seed_manifest":"PASS",
  "created_at":datetime.datetime.now(datetime.timezone.utc).isoformat(),
}
with open(path,"w",encoding="utf-8") as f:
  json.dump(payload,f,indent=2)
  f.write("\n")
print(json.dumps(payload))
PY

echo "PROMOTION_EVIDENCE=${EVIDENCE_FILE}"
