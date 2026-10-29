#!/usr/bin/env bash
# JSCC #531: build exact clean source into an immutable DEV service image.
# This does not deploy to Cloud Run, run database migrations, or start test DB containers.
set -euo pipefail
candidate="${1:-}"
[[ "${candidate}" =~ ^[0-9a-f]{40}$ ]] || { echo "Full candidate SHA required" >&2; exit 86; }
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${repo_root}"
[[ "$(git rev-parse HEAD)" == "${candidate}" ]] || { echo "Checkout HEAD differs from candidate" >&2; exit 86; }
[[ -z "$(git status --porcelain)" ]] || { echo "Checkout contains uncommitted files" >&2; exit 86; }
[[ "$(gcloud config get-value project 2>/dev/null)" == "jscc-dev" ]] || { echo "gcloud context must be jscc-dev" >&2; exit 86; }
test -f cloudbuild.531.dev-service.yaml || { echo "Missing approved DEV-only Cloud Build recipe" >&2; exit 86; }
gcloud builds submit . \
  --project=jscc-shared \
  --config=cloudbuild.531.dev-service.yaml \
  --substitutions="_GIT_SHA=${candidate}"
echo "JSCC531_DEV_SERVICE_IMAGE_BUILD_DONE_FOR=${candidate}"
