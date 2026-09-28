#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="jscc-dev"
REGION="europe-west1"
JOB_NAME="jscc-search-dev"
RUNTIME_SA="jscc-dev-runtime@jscc-dev.iam.gserviceaccount.com"
SOURCE_SHA="4a8671f60b263a062002e9b3b619170dcc6644cc"
IMAGE_DIGEST="sha256:69a486fe75cf082715023e03aa9725358d67b5efb3cc5b8d2e7200c26f96292f"
IMAGE="europe-west1-docker.pkg.dev/jscc-shared/jscc/jscc@${IMAGE_DIGEST}"

project_number="$(gcloud projects describe "${PROJECT_ID}" --format='value(projectNumber)')"
BUCKET="jscc-dev-runtime-${project_number}"
MOUNT_PATH="/runtime"

gcloud config set project "${PROJECT_ID}" >/dev/null
gcloud services enable run.googleapis.com storage.googleapis.com secretmanager.googleapis.com

if ! gcloud storage buckets describe "gs://${BUCKET}" >/dev/null 2>&1; then
  gcloud storage buckets create "gs://${BUCKET}" \
    --project="${PROJECT_ID}" \
    --location="${REGION}" \
    --default-storage-class=STANDARD \
    --uniform-bucket-level-access
fi

lifecycle="$(mktemp)"
trap 'rm -f "${lifecycle}"' EXIT
cat >"${lifecycle}" <<'JSON'
{
  "rule": [
    {
      "action": {"type": "Delete"},
      "condition": {"age": 30, "matchesPrefix": ["runs/"]}
    }
  ]
}
JSON

gcloud storage buckets update "gs://${BUCKET}" --lifecycle-file="${lifecycle}"
gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" \
  --member="serviceAccount:${RUNTIME_SA}" \
  --role="roles/storage.objectUser" >/dev/null

seed_dir="$(mktemp -d)"
trap 'rm -f "${lifecycle}"; rm -rf "${seed_dir}"' EXIT
cp data/search-config.json "${seed_dir}/search-config.json"

cat >"${seed_dir}/jobs.json" <<'JSON'
{"schema_version":"1.0","generated_at":"2026-01-01T00:00:00+00:00","freshness_hours":24,"criteria":{},"records_inspected":0,"results":0,"excluded_count":0,"jobs":[]}
JSON
cat >"${seed_dir}/run-status.json" <<'JSON'
{"schema_version":"1.0","run_id":"gcp-dev-boundary-validation","status":"running","started_at":"2026-01-01T00:00:01+00:00","completed_at":null,"sources":[],"sources_processed":0,"records_inspected":0,"jobs_published":0,"excluded":0,"limitations":[]}
JSON
cat >"${seed_dir}/run-history.json" <<'JSON'
{"schema_version":"1.0","runs":[]}
JSON
cat >"${seed_dir}/search-state.json" <<'JSON'
{"schema_version":"1.0","query_progress":{},"job_first_seen":{},"usage":{}}
JSON

for file in search-config.json jobs.json run-status.json run-history.json search-state.json; do
  gcloud storage cp "${seed_dir}/${file}" "gs://${BUCKET}/seed/${file}"
done

gcloud run jobs deploy "${JOB_NAME}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --image="${IMAGE}" \
  --service-account="${RUNTIME_SA}" \
  --cpu=2 \
  --memory=4Gi \
  --tasks=1 \
  --parallelism=1 \
  --max-retries=1 \
  --task-timeout=45m \
  --set-env-vars="SOURCE_SHA=${SOURCE_SHA},RUN_TRIGGER=gcp-dev-manual" \
  --set-secrets="NILE_DATABASE_URL=NILE_DATABASE_URL:latest" \
  --add-volume="mount-path=${MOUNT_PATH},type=cloud-storage,bucket=${BUCKET},readonly=false" \
  --command="/bin/bash" \
  --args="-ceu,run_dir='${MOUNT_PATH}/runs/'\"\${CLOUD_RUN_EXECUTION:?CLOUD_RUN_EXECUTION is required}\"; mkdir -p \"\${run_dir}\"; for f in search-config.json jobs.json run-status.json run-history.json search-state.json; do cp '${MOUNT_PATH}/seed/'\"\${f}\" \"\${run_dir}/\${f}\"; done; export JSCC_RUNTIME_DATA_DIR=\"\${run_dir}\"; exec python3 scripts/job_search_runner.py --validate-only"

echo "DEV_JOB=${JOB_NAME}"
echo "DEV_BUCKET=gs://${BUCKET}"
echo "IMAGE=${IMAGE}"
echo "SOURCE_SHA=${SOURCE_SHA}"
