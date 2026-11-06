#!/usr/bin/env bash
# JSCC #531. Stage a verified, prebuilt service image on Cloud Run DEV with 0% traffic.
# No database migrations, secrets, IAM, Job deploy, TEST/PROD, or runtime file changes.
set -euo pipefail

candidate="${1:-}"
mode="${2:-plan}"
[[ "${candidate}" =~ ^[0-9a-f]{40}$ ]] || { echo "Full 40-hex candidate SHA required" >&2; exit 86; }
[[ "${mode}" == "plan" || "${mode}" == "stage" ]] || { echo "Usage: script SHA [plan|stage]" >&2; exit 86; }
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${repo_root}"
[[ "$(git rev-parse HEAD)" == "${candidate}" ]] || { echo "Working checkout is not candidate SHA" >&2; exit 86; }
[[ -z "$(git status --porcelain)" ]] || { echo "Working checkout must be clean" >&2; exit 86; }
[[ "$(gcloud config get-value project 2>/dev/null)" == "jscc-dev" ]] || { echo "gcloud context must be jscc-dev" >&2; exit 86; }

project="jscc-dev"
region="europe-west1"
service="jscc-command-api-dev"
image_repo="europe-west1-docker.pkg.dev/jscc-shared/jscc/jscc-service"
image_tag="${image_repo}:${candidate}"
image_digest="$(gcloud artifacts docker images describe "${image_tag}" --project=jscc-shared --format='value(image_summary.digest)')"
[[ "${image_digest}" =~ ^sha256:[0-9a-f]{64}$ ]] || { echo "Exact candidate service image is not available" >&2; exit 86; }
image="${image_repo}@${image_digest}"

# Verify the existing DEV service identity, DB secret binding, and collection mode.
python3 scripts/gcp/cloud_run_v2_read.py "${project}" "${region}" "${service}" preflight
echo "JSCC531_EXACT_SHA=${candidate}"
echo "JSCC531_SERVICE_IMAGE=${image}"
echo "JSCC531_MODE=${mode}"
if [[ "${mode}" == "plan" ]]; then
  echo "PLAN_ONLY: no Cloud Run revision created"
  exit 0
fi

[[ "${JSCC531_STAGE_SHA:-}" == "${candidate}" ]] || { echo "Stage requires JSCC531_STAGE_SHA=exact candidate SHA" >&2; exit 86; }
gcloud run services update "${service}" \
  --project="${project}" --region="${region}" \
  --image="${image}" \
  --update-env-vars="SOURCE_SHA=${candidate},RUNTIME_DATA_SHA=${candidate}" \
  --tag="rf531" --no-traffic

# The tag is testable while the production DEV route remains on its prior revision.
tag_url="$(python3 scripts/gcp/cloud_run_v2_read.py "${project}" "${region}" "${service}" tag-uri)"
echo "JSCC531_STAGED_0_PERCENT_TRAFFIC_PASS"
echo "JSCC531_TAGGED_REVISION_URL=${tag_url}"

# Health and database identity only; no tenant mutation or E2E login requests.
health_json="$(curl --fail --silent --show-error "${tag_url}/health")"
HEALTH_JSON="${health_json}" python3 - "${candidate}" <<'PY'
import json,os,sys
v=json.loads(os.environ["HEALTH_JSON"])
assert v.get("status")=="ok",v
assert v.get("environment")=="dev",v
assert v.get("source_sha")==sys.argv[1],v
assert v.get("runtime_backend")=="gcp",v
assert v.get("search_mode")=="disabled",v
print("JSCC531_TAGGED_HEALTH_PASS")
PY
db_health_json="$(curl --fail --silent --show-error "${tag_url}/health/db")"
DB_HEALTH_JSON="${db_health_json}" python3 - <<'PY'
import json,os
v=json.loads(os.environ["DB_HEALTH_JSON"])
assert v.get("status")=="ok",v
assert v.get("environment")=="dev",v
assert v.get("database")=="jobsearch_dev",v
print("JSCC531_TAGGED_NILE_DB_HEALTH_PASS")
PY
