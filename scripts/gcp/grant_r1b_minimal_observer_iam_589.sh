#!/usr/bin/env bash
# JSCC #589 / owner authorization: least-privilege R1-B observation
# IAM role + binding only. No deployment, IAM admin grant, or TEST/PROD.
set -Eeuo pipefail
DEV=jscc-dev
SHARED=jscc-shared
REGION=europe-west1
SA=jscc-diagnostics-dev@jscc-dev.iam.gserviceaccount.com
MEMBER="serviceAccount:$SA"
DEVROLE=jscc589DevRuntimeObserverR1
SHAREDROLE=jscc589SharedBuildObserverR1
[[ "$(gcloud config get-value project 2>/dev/null)" == "$DEV" ]] || { echo "BLOCKED: expected jscc-dev"; exit 2; }
gcloud iam service-accounts describe "$SA" --project="$DEV" >/dev/null
gcloud run jobs describe jscc-diagnostics-dev --project="$DEV" --region="$REGION" --format=json |
 python3 -c 'import json,sys; d=json.load(sys.stdin); s=(d.get("spec") or {}).get("template",{}).get("spec",{}).get("template",{}).get("spec",{}).get("serviceAccountName",""); assert s=="jscc-diagnostics-dev@jscc-dev.iam.gserviceaccount.com",f"BLOCKED: job SA mismatch: {s}"'
role_exact() {
  project="$1"
  short="$2"
  perms="$3"
  title="$4"
  if gcloud iam roles describe "$short" --project="$project" --format=json > /tmp/jscc589-current-role.json 2>/dev/null; then
    python3 -c 'import json,sys; x=json.load(open(sys.argv[1])); assert set(x.get("includedPermissions",[]))==set(sys.argv[2].split(",")), "BLOCKED: existing role has different permissions"; assert not x.get("deleted",False), "BLOCKED: role soft-deleted"' /tmp/jscc589-current-role.json "$perms"
  else
    gcloud iam roles create "$short" --project="$project" --title="$title" --description="JSCC #589 R1-B read-only observer" --permissions="$perms" --stage=GA --quiet
  fi
}
role_exact "$DEV" "$DEVROLE" "run.services.get,run.revisions.get" "JSCC589 DEV Runtime Observer R1"
role_exact "$SHARED" "$SHAREDROLE" "cloudbuild.builds.get" "JSCC589 SHARED Build Observer R1"
gcloud projects add-iam-policy-binding "$DEV" --member="$MEMBER" --role="projects/$DEV/roles/$DEVROLE" --condition=None --quiet >/dev/null
gcloud projects add-iam-policy-binding "$SHARED" --member="$MEMBER" --role="projects/$SHARED/roles/$SHAREDROLE" --condition=None --quiet >/dev/null
verify_binding() {
  project="$1"; role="$2"
  gcloud projects get-iam-policy "$project" --format=json |
    python3 -c 'import json,sys; d=json.load(sys.stdin); member,role=sys.argv[1:]; match=[b for b in d.get("bindings",[]) if b.get("role")==role and member in b.get("members",[]) and not b.get("condition")]; assert len(match)==1, "BLOCKED: exact unconditional binding not confirmed"; print("VERIFIED_BINDING",role,member)' "$MEMBER" "$role"
}
verify_binding "$DEV" "projects/$DEV/roles/$DEVROLE"
verify_binding "$SHARED" "projects/$SHARED/roles/$SHAREDROLE"
echo JSCC589_R1B_MINIMAL_IAM_PASS
