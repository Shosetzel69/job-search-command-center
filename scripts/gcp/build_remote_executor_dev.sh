#!/usr/bin/env bash
set -euo pipefail

SHARED=jscc-shared
REGION=europe-west1
OPS_BUILD_SOURCE_BUCKET="${SHARED}-ops-cloudbuild-source"

SOURCE_SHA="${SOURCE_SHA:-$(git rev-parse HEAD)}"
if [[ -z "${TRUSTED_OPS_REF:-}" ]]; then
  MAIN_SHA="$(git ls-remote origin refs/heads/main | awk 'NR==1 {print $1}')"
  [[ "$MAIN_SHA" == "$SOURCE_SHA" ]] && TRUSTED_OPS_REF="refs/heads/main"
fi
export SOURCE_SHA TRUSTED_OPS_REF

bash scripts/gcp/assert_trusted_ops_source.sh

gcloud builds submit   --project="$SHARED"   --region="$REGION"   --gcs-source-staging-dir="gs://$OPS_BUILD_SOURCE_BUCKET/source"   --config=cloudbuild.ops.yaml   --substitutions="_GIT_SHA=$SOURCE_SHA,_TRUSTED_REF=$TRUSTED_OPS_REF"   .
