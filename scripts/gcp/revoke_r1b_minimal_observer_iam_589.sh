#!/usr/bin/env bash
# Roll back only #589 R1-B custom role grants (never existing grants).
set -Eeuo pipefail
DEV=jscc-dev
SHARED=jscc-shared
SA=jscc-diagnostics-dev@jscc-dev.iam.gserviceaccount.com
MEMBER="serviceAccount:$SA"
[[ "$(gcloud config get-value project 2>/dev/null)" == "$DEV" ]] || { echo 'BLOCKED: wrong active project'; exit 2; }
for entry in 'jscc-dev jscc589DevRuntimeObserverR1' 'jscc-shared jscc589SharedBuildObserverR1'; do
  read -r project short <<<"$entry"
  gcloud projects remove-iam-policy-binding "$project" --member="$MEMBER" \
    --role="projects/$project/roles/$short" --condition=None --quiet >/dev/null
  if gcloud projects get-iam-policy "$project" --format=json |
    python3 -c 'import json,sys; d=json.load(sys.stdin); member,role=sys.argv[1:]; matches=[b for b in d.get("bindings",[]) if b.get("role")==role and member in b.get("members",[])]; sys.exit(1 if matches else 0)' "$MEMBER" "projects/$project/roles/$short"; then
    echo "REVOKED $project/$short"
  else
    echo "BLOCKED: binding remains $project/$short"
    exit 4
  fi
done
echo 'JSCC589_R1B_IAM_REVOKED'
