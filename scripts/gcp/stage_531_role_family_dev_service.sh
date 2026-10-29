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
gcloud run services describe "${service}" --project="${project}" --region="${region}" --format=json \
  | python3 -c '
import json,sys
d=json.load(sys.stdin)
meta=d.get("metadata",{})
assert meta.get("name")=="jscc-command-api-dev", "Incorrect service"
spec=d.get("spec",{}).get("template",{}).get("spec",{})
containers=spec.get("containers",[])
assert len(containers)==1, "Unexpected container layout"
env={e.get("name"):e for e in containers[0].get("env",[])}
assert env.get("APP_ENV",{}).get("value")=="dev", "Not DEV"
assert env.get("SEARCH_MODE",{}).get("value")=="disabled", "Search must stay disabled"
assert env.get("JSCC_RUNTIME_BACKEND",{}).get("value")=="gcp", "Unexpected backend"
secret=env.get("NILE_DATABASE_URL",{}).get("valueFrom",{}).get("secretKeyRef",{})
assert secret.get("name")=="NILE_DATABASE_URL" and str(secret.get("key"))=="1", "Nile secret pin mismatch"
print("JSCC531_DEV_SERVICE_PREFLIGHT_PASS")
'
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
tag_url="$(gcloud run services describe "${service}" --project="${project}" --region="${region}" --format=json \
 | python3 -c '
import json,sys
d=json.load(sys.stdin)
matches=[x for x in d.get("status",{}).get("traffic",[]) if x.get("tag")=="rf531"]
assert len(matches)==1, "Tagged revision not found"
assert int(matches[0].get("percent") or 0)==0, "Candidate unexpectedly serving traffic"
url=matches[0].get("url","")
assert url.startswith("https://") and ".run.app" in url, "Tagged revision URL missing"
print(url)
')"
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
