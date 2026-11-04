#!/usr/bin/env bash
# #589 F1 security remediation: remove the existing broad project grants.
# Rebind the DEV Run role ONLY on four reviewed Cloud Run services.
# The cross-project Cloud Build grant is REVOKED, not silently accepted.
# No deployment, job execution, TEST/PROD or permission escalation.
set -Eeuo pipefail

DEV=jscc-dev
SHARED=jscc-shared
REGION=europe-west1
SA=jscc-diagnostics-dev@jscc-dev.iam.gserviceaccount.com
MEMBER="serviceAccount:$SA"
DEV_ROLE="projects/$DEV/roles/jscc589DevRuntimeObserverR1"
BUILD_ROLE="projects/$SHARED/roles/jscc589SharedBuildObserverR1"
SERVICES=(
  jscc-dev-workspace-manager
  jscc-dev-sandbox-worker
  jscc-ops-gateway-dev
  jscc-command-api-dev
)

[[ "$(gcloud config get-value project 2>/dev/null)" == "$DEV" ]] || {
  echo 'BLOCKED: active Cloud Shell project must be jscc-dev' >&2
  exit 2
}
gcloud iam service-accounts describe "$SA" --project="$DEV" >/dev/null
for pair in "$DEV jscc589DevRuntimeObserverR1 run.services.get,run.revisions.get" \
            "$SHARED jscc589SharedBuildObserverR1 cloudbuild.builds.get"; do
  read -r project short perms <<<"$pair"
  gcloud iam roles describe "$short" --project="$project" --format=json |
    python3 -c 'import json,sys; d=json.load(sys.stdin); expected=set(sys.argv[1].split(",")); assert set(d.get("includedPermissions",[]))==expected and not d.get("deleted",False), "BLOCKED: custom role not exact"' "$perms"
done

binding_state() {
  local project="$1" role="$2"
  gcloud projects get-iam-policy "$project" --format=json |
    python3 -c 'import json,sys; d=json.load(sys.stdin); member,role=sys.argv[1:]; found=[b for b in d.get("bindings",[]) if b.get("role")==role and member in b.get("members",[])]; print("PRESENT" if found else "ABSENT")' "$MEMBER" "$role"
}

echo '=== REMOVE PROJECT-WIDE CLOUD BUILD ACCESS FIRST ==='
if [[ "$(binding_state "$SHARED" "$BUILD_ROLE")" == 'PRESENT' ]]; then
  gcloud projects remove-iam-policy-binding "$SHARED" \
    --member="$MEMBER" --role="$BUILD_ROLE" --condition=None --quiet >/dev/null
fi
[[ "$(binding_state "$SHARED" "$BUILD_ROLE")" == 'ABSENT' ]] || {
  echo 'BLOCKED: Cloud Build broad grant still present' >&2
  exit 3
}
echo 'PASS BUILD_PROJECT_WIDE_REVOKED'

echo '=== REMOVE PROJECT-WIDE CLOUD RUN ACCESS ==='
if [[ "$(binding_state "$DEV" "$DEV_ROLE")" == 'PRESENT' ]]; then
  gcloud projects remove-iam-policy-binding "$DEV" \
    --member="$MEMBER" --role="$DEV_ROLE" --condition=None --quiet >/dev/null
fi
[[ "$(binding_state "$DEV" "$DEV_ROLE")" == 'ABSENT' ]] || {
  echo 'BLOCKED: DEV broad grant still present' >&2
  exit 3
}
echo 'PASS RUN_PROJECT_WIDE_REVOKED'

echo '=== ADD ONLY FOUR SERVICE-LEVEL READ BINDINGS ==='
for service in "${SERVICES[@]}"; do
  gcloud run services describe "$service" --project="$DEV" --region="$REGION" --format='value(metadata.name)' >/dev/null
  gcloud run services add-iam-policy-binding "$service" \
    --project="$DEV" --region="$REGION" \
    --member="$MEMBER" --role="$DEV_ROLE" --condition=None --quiet >/dev/null

  gcloud run services get-iam-policy "$service" --project="$DEV" --region="$REGION" --format=json |
    python3 -c 'import json,sys; d=json.load(sys.stdin); member,role=sys.argv[1:]; bindings=[b for b in d.get("bindings",[]) if b.get("role")==role and member in b.get("members",[]) and not b.get("condition")]; assert len(bindings)==1, "BLOCKED: service-level grant verification failed"' "$MEMBER" "$DEV_ROLE"
  echo "PASS SERVICE_BOUND $service"
done

[[ "$(binding_state "$DEV" "$DEV_ROLE")" == 'ABSENT' ]] || exit 3
[[ "$(binding_state "$SHARED" "$BUILD_ROLE")" == 'ABSENT' ]] || exit 3
echo 'JSCC589_F1_RUN_SERVICE_SCOPE_PASS'
echo 'JSCC589_F1_BUILD_PROJECT_GRANT_REVOKED'
echo 'NOTE: effective run.revisions.get inheritance still requires a separate worker-identity test.'
echo 'NOTE: describe_dev_build is intentionally PERMISSION_BLOCKED until separately approved or removed.'
