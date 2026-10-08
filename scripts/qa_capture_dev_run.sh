#!/usr/bin/env bash
# Archive an existing completed DEV search run into a stable private QA snapshot.
# Run must first have been triggered from the authenticated JSCC DEV application.
set -euo pipefail

RUN_ID="${1:-}"
if [[ ! "$RUN_ID" =~ ^run-[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$ ]]; then
  echo "Usage: bash scripts/qa_capture_dev_run.sh run-<uuid>" >&2
  exit 2
fi

PROJECT="jscc-dev"
BUCKET="jscc-dev-runtime-828902654738"
SOURCE="gs://${BUCKET}/runs/${RUN_ID}"
DEST="gs://${BUCKET}/qa/real-snapshots/${RUN_ID}"

# Reject unfinished runs. Do not modify runtime current.json or the DB.
gcloud storage cat "${SOURCE}/run-status.json" --project="${PROJECT}" \
  | python3 -c 'import json,sys; s=json.load(sys.stdin); assert s.get("status") in ("completed","completed_with_errors"), "Run is not terminal"'

for artifact in jobs.json run-status.json run-history.json; do
  gcloud storage cp --no-clobber \
    "${SOURCE}/${artifact}" "${DEST}/${artifact}" \
    --project="${PROJECT}"
done
echo "DEV QA snapshot archived: ${DEST}/"
echo "Source artifacts unchanged. Synthetic QA fixtures are managed separately."
