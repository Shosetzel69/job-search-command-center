#!/usr/bin/env bash
set -euo pipefail

ENVIRONMENT="${1:-}"
CANDIDATE_SHA="${2:-}"

[[ "${ENVIRONMENT}" == "dev" ]] || { echo "live promotion evidence is only supported for DEV" >&2; exit 2; }
[[ "${CANDIDATE_SHA}" =~ ^[0-9a-f]{40}$ ]] || { echo "candidate SHA must be a full lowercase 40-character SHA" >&2; exit 2; }

source "$(dirname "$0")/environment.sh" "${ENVIRONMENT}"

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
EVIDENCE_DIR="${ROOT}/artifacts/gcp-promotion"
EVIDENCE_FILE="${EVIDENCE_DIR}/${ENVIRONMENT}-${CANDIDATE_SHA}.json"
MANIFEST="${ROOT}/scripts/gcp/runtime_seed_files.txt"
mkdir -p "${EVIDENCE_DIR}"

job_digest="$(gcloud artifacts docker images describe "${JOB_IMAGE_REPO}:${CANDIDATE_SHA}" \
  --project=jscc-shared --format='value(image_summary.digest)')"
service_digest="$(gcloud artifacts docker images describe "${SERVICE_IMAGE_REPO}:${CANDIDATE_SHA}" \
  --project=jscc-shared --format='value(image_summary.digest)')"

[[ "${job_digest}" =~ ^sha256:[0-9a-f]{64}$ ]] || { echo "Missing immutable Job artifact for candidate" >&2; exit 8; }
[[ "${service_digest}" =~ ^sha256:[0-9a-f]{64}$ ]] || { echo "Missing immutable Service artifact for candidate" >&2; exit 9; }

expected_job_image="${JOB_IMAGE_REPO}@${job_digest}"
expected_service_image="${SERVICE_IMAGE_REPO}@${service_digest}"

tmpdir="$(mktemp -d)"
trap 'rm -rf "${tmpdir}"' EXIT

gcloud run jobs describe "${JOB_NAME}" \
  --project="${PROJECT_ID}" --region="${REGION}" --format=json >"${tmpdir}/job.json"

gcloud run services describe "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" --region="${REGION}" --format=json >"${tmpdir}/service.json"

python3 - "${tmpdir}/job.json" "${tmpdir}/service.json" "${expected_job_image}" "${expected_service_image}" <<'PY'
import json, sys

job_path, service_path, expected_job, expected_service = sys.argv[1:]

def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)

def contains_exact_image(node, expected):
    if isinstance(node, dict):
        for key, value in node.items():
            if key == "image" and value == expected:
                return True
            if contains_exact_image(value, expected):
                return True
    elif isinstance(node, list):
        return any(contains_exact_image(item, expected) for item in node)
    return False

job = load(job_path)
service = load(service_path)
assert contains_exact_image(job, expected_job), f"DEV Job is not deployed from {expected_job}"
assert contains_exact_image(service, expected_service), f"DEV Service is not deployed from {expected_service}"
PY

reported_service_url="$(gcloud run services describe "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" --region="${REGION}" --format='value(status.url)')"
latest_ready="$(gcloud run services describe "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" --region="${REGION}" --format='value(status.latestReadyRevisionName)')"
traffic="$(gcloud run services describe "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" --region="${REGION}" --format='value(status.traffic[0].percent)')"

frontend_origin="https://${SERVICE_NAME}-${PROJECT_NUMBER}.${REGION}.run.app"
[[ "${reported_service_url}" == https://*.run.app ]] || { echo "Unexpected Cloud Run reported URL: ${reported_service_url}" >&2; exit 11; }
test "${traffic}" = "100" || { echo "DEV latest revision does not have 100% traffic" >&2; exit 12; }

health="$(curl --fail --silent --show-error "${frontend_origin}/health")"
db_health="$(curl --fail --silent --show-error "${frontend_origin}/health/db")"

HEALTH_JSON="${health}" DB_HEALTH_JSON="${db_health}" python3 - "${CANDIDATE_SHA}" "${EXPECTED_DATABASE}" <<'PY'
import json, os, sys
sha, expected_db = sys.argv[1:]
health = json.loads(os.environ["HEALTH_JSON"])
db = json.loads(os.environ["DB_HEALTH_JSON"])
assert health.get("status") == "ok", health
assert health.get("environment") == "dev", health
assert health.get("source_sha") == sha, health
assert health.get("runtime_data_sha") == sha, health
assert health.get("runtime_backend") == "gcp", health
assert health.get("runtime_configured") is True, health
assert health.get("auth_configured") is True, health
assert db.get("status") == "ok", db
assert db.get("environment") == "dev", db
assert db.get("database") == expected_db, db
PY

test -f "${MANIFEST}" || { echo "Missing runtime seed manifest" >&2; exit 13; }
while IFS= read -r file; do
  [[ -n "${file}" ]] || continue
  gcloud storage objects describe "gs://${RUNTIME_BUCKET}/seed/${file}" \
    --project="${PROJECT_ID}" >/dev/null \
    || { echo "DEV runtime seed verification failed: ${file}" >&2; exit 14; }
done < "${MANIFEST}"

python3 - "${EVIDENCE_FILE}" "${CANDIDATE_SHA}" "${job_digest}" "${service_digest}" "${latest_ready}" "${frontend_origin}" "${reported_service_url}" "${EXPECTED_DATABASE}" <<'PY'
import datetime, json, sys
path, sha, job_digest, service_digest, revision, url, reported_url, database = sys.argv[1:]
payload = {
    "schema_version": "1.0",
    "environment": "dev",
    "candidate_sha": sha,
    "job_digest": job_digest,
    "service_digest": service_digest,
    "service_revision": revision,
    "service_url": url,
    "reported_service_url": reported_url,
    "database": database,
    "health": "PASS",
    "db_health": "PASS",
    "seed_manifest": "PASS",
    "attestation_mode": "live-read-only",
    "created_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
}
with open(path, "w", encoding="utf-8") as f:
    json.dump(payload, f, indent=2)
    f.write("\n")
print(json.dumps(payload))
PY

echo "LIVE_DEV_PROMOTION_EVIDENCE=${EVIDENCE_FILE}"
