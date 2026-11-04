#!/usr/bin/env bash
# #589 F6: remove ONLY 589 R1-B role memberships, including scoped grants.
# Existing custom role definitions remain inert after all bindings are removed.
set -Eeuo pipefail
DEV=jscc-dev
SHARED=jscc-shared
REGION=europe-west1
SA=jscc-diagnostics-dev@jscc-dev.iam.gserviceaccount.com
MEMBER="serviceAccount:$SA"
RUN_ROLE="projects/$DEV/roles/jscc589DevRuntimeObserverR1"
BUILD_ROLE="projects/$SHARED/roles/jscc589SharedBuildObserverR1"
SERVICES=(jscc-dev-workspace-manager jscc-dev-sandbox-worker jscc-ops-gateway-dev jscc-command-api-dev)
[[ "$(gcloud config get-value project 2>/dev/null)" == "$DEV" ]] || {
  echo 'BLOCKED: expected jscc-dev' >&2; exit 2;
}
has_binding() {
  local mode="$1" resource="$2" role="$3"
  if [[ "$mode" == project ]]; then
    gcloud projects get-iam-policy "$resource" --format=json
  else
    gcloud run services get-iam-policy "$resource" --project="$DEV" --region="$REGION" --format=json
  fi | python3 -c 'import json,sys; d=json.load(sys.stdin); member,role=sys.argv[1:]; sys.exit(0 if any(b.get("role")==role and member in b.get("members",[]) for b in d.get("bindings",[])) else 1)' "$MEMBER" "$role"
}
for service in "${SERVICES[@]}"; do
  if has_binding service "$service" "$RUN_ROLE"; then
    gcloud run services remove-iam-policy-binding "$service" \
      --project="$DEV" --region="$REGION" --member="$MEMBER" \
      --role="$RUN_ROLE" --condition=None --quiet >/dev/null
  fi
  if has_binding service "$service" "$RUN_ROLE"; then
    echo "BLOCKED: service grant remains $service" >&2; exit 3
  fi
  echo "REVOKED_OR_ABSENT service/$service"
done
for entry in "$DEV:$RUN_ROLE" "$SHARED:$BUILD_ROLE"; do
  project="${entry%%:*}"; role="${entry#*:}"
  if has_binding project "$project" "$role"; then
    gcloud projects remove-iam-policy-binding "$project" \
      --member="$MEMBER" --role="$role" --condition=None --quiet >/dev/null
  fi
  if has_binding project "$project" "$role"; then
    echo "BLOCKED: project-wide grant remains $project" >&2; exit 3
  fi
  echo "REVOKED_OR_ABSENT project/$project"
done
echo 'JSCC589_F6_ALL_OBSERVER_BINDINGS_REVOKED'
echo 'Custom roles are intentionally retained WITHOUT MEMBERS; deletion requires separate approval.'
