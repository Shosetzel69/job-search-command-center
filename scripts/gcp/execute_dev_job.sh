#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="jscc-dev"
REGION="europe-west1"
JOB_NAME="jscc-search-dev"

active="$(
  gcloud run jobs executions list \
    --project="${PROJECT_ID}" \
    --region="${REGION}" \
    --job="${JOB_NAME}" \
    --format='value(metadata.name,status.conditions[0].type,status.conditions[0].status)' 2>/dev/null \
    | awk '$2 != "Completed" || $3 != "True" {print $1}'
)"

if [[ -n "${active}" ]]; then
  echo "ACTIVE_RUN_REJECTED: ${active}" >&2
  exit 10
fi

gcloud run jobs execute "${JOB_NAME}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --wait
