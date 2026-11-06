#!/usr/bin/env bash
# DEV ONLY. Rollout of approved and built Manager+Worker cap-100 image pair.
# Do not invoke this script before independent artifact/security review.
set -Eeuo pipefail

PROJECT=jscc-dev
REGION=europe-west1
SHARED=jscc-shared
REPO=jscc-ops
MANAGER=jscc-dev-workspace-manager
WORKER=jscc-dev-sandbox-worker
MANAGER_BASE="europe-west1-docker.pkg.dev/jscc-shared/jscc-ops/jscc-dev-workspace-manager@sha256:df89d44657c56826eab4d6507487e8f6c391df2f42e13a4b3f80e7cc47c5c9f2"
WORKER_BASE="europe-west1-docker.pkg.dev/jscc-shared/jscc-ops/jscc-dev-sandbox-worker@sha256:704851e058e4dc8b5672866a40ac8dc9f8b02b924908121815e765940207b401"
MANAGER_IMAGE="europe-west1-docker.pkg.dev/$SHARED/$REPO/jscc-dev-workspace-manager-cap100"
WORKER_IMAGE="europe-west1-docker.pkg.dev/$SHARED/$REPO/jscc-dev-workspace-worker-cap100"

[[ "${1:-}" == "--apply" ]] || { echo "Usage: SOURCE_SHA=<reviewed SHA on main> bash $0 --apply" >&2; exit 2; }
SOURCE_SHA="${SOURCE_SHA:?SOURCE_SHA required}"
[[ "$SOURCE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "Invalid SOURCE_SHA" >&2; exit 2; }
[[ "$(git rev-parse HEAD)" == "$SOURCE_SHA" ]] || { echo "Local checkout must equal SOURCE_SHA" >&2; exit 2; }
TRUSTED_REMOTE="$(git ls-remote origin refs/heads/main | awk 'NR==1 {print $1}')"
[[ "$TRUSTED_REMOTE" == "$SOURCE_SHA" ]] || { echo "SOURCE_SHA is not the exact trusted GitHub main head" >&2; exit 2; }
[[ -f cloudbuild.workspace-manager-cap-100.yaml && -f ops/workspace-manager/Dockerfile.cap100 ]] || exit 2

for svc in "$WORKER" "$MANAGER"; do
  gcloud run services describe "$svc" --project="$PROJECT" --region="$REGION" >/dev/null
done

# Fail closed if either original effective deployed image changed since last observation.
get_effective_image() {
  local service="$1" rev image
  rev="$(python3 scripts/gcp/cloud_run_v2_read.py "$PROJECT" "$REGION" "$service" primary-revision)"
  [[ -n "$rev" ]] || return 1
  image="$(python3 scripts/gcp/cloud_run_v2_read.py "$PROJECT" "$REGION" "$service" effective-image)"
  printf '%s' "$image"
}
[[ "$(get_effective_image "$MANAGER")" == "$MANAGER_BASE" ]] || { echo "Manager baseline drift; abort" >&2; exit 3; }
[[ "$(get_effective_image "$WORKER")" == "$WORKER_BASE" ]] || { echo "Worker baseline drift; abort" >&2; exit 3; }

echo "BASELINE_VERIFIED: $MANAGER $WORKER"
echo "BUILD_SOURCE_SHA: $SOURCE_SHA"
gcloud builds submit . \
  --project="$SHARED" \
  --region="$REGION" \
  --config=cloudbuild.workspace-manager-cap-100.yaml \
  --substitutions="_GIT_SHA=$SOURCE_SHA,_TRUSTED_REF=refs/heads/main"

read_image_digest() {
  local tag="$1" digest
  digest="$(gcloud artifacts docker images describe "$tag" --project="$SHARED" --format='value(image_summary.digest)')"
  [[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]] || return 1
  printf '%s@%s' "${tag%:*}" "$digest"
}
new_worker="$(read_image_digest "$WORKER_IMAGE:$SOURCE_SHA")"
new_manager="$(read_image_digest "$MANAGER_IMAGE:$SOURCE_SHA")"
echo "BUILT_WORKER=$new_worker"
echo "BUILT_MANAGER=$new_manager"

# Rollout order matters. Worker 100 first remains compatible with Manager 80.
# Rollback order matters. Manager 80 first remains compatible with Worker 100.
rollback() {
  echo "ROLLBACK: Manager then Worker" >&2
  gcloud run services update "$MANAGER" --project="$PROJECT" --region="$REGION" --image="$MANAGER_BASE" --quiet || true
  gcloud run services update "$WORKER" --project="$PROJECT" --region="$REGION" --image="$WORKER_BASE" --quiet || true
}
rollout_started=0
on_error() {
  local exit_code=$?
  if [[ "$rollout_started" == "1" ]]; then rollback; fi
  exit "$exit_code"
}
trap on_error ERR

rollout_started=1
gcloud run services update "$WORKER" --project="$PROJECT" --region="$REGION" --image="$new_worker" --quiet
[[ "$(get_effective_image "$WORKER")" == "$new_worker" ]] || { echo "Worker image mismatch" >&2; false; }
gcloud run services update "$MANAGER" --project="$PROJECT" --region="$REGION" --image="$new_manager" --quiet
[[ "$(get_effective_image "$MANAGER")" == "$new_manager" ]] || { echo "Manager image mismatch" >&2; false; }
trap - ERR

echo "CAP100_DEV_ROLLOUT_COMPLETE"
echo "MANAGER_IMAGE=$new_manager"
echo "WORKER_IMAGE=$new_worker"
echo "LIVE_REGRESSION_AND_OWNER_REVIEW_STILL_REQUIRED"
