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
    --format=json 2>/dev/null \
  | python3 -c '
import json
import sys

for execution in json.load(sys.stdin):
    conditions = execution.get("status", {}).get("conditions", []) or []
    completed = any(
        condition.get("type") == "Completed"
        and str(condition.get("status")).lower() == "true"
        for condition in conditions
    )
    if not completed:
        print(execution.get("metadata", {}).get("name", "unknown-execution"))
'
)"

if [[ -n "${active}" ]]; then
  echo "ACTIVE_RUN_REJECTED: ${active}" >&2
  exit 10
fi

gcloud run jobs execute "${JOB_NAME}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --wait
