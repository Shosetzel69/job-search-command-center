#!/usr/bin/env bash
# #589 R1-B — strictly READ-ONLY IAM + job configuration inventory.
# Output contains IAM binding metadata only (no tokens, secrets or env values).
set -euo pipefail
PROJECT=jscc-dev
SHARED=jscc-shared
REGION=europe-west1
WORKER=jscc-diagnostics-dev@jscc-dev.iam.gserviceaccount.com
MEMBER="serviceAccount:$WORKER"

[[ "$(gcloud config get-value project 2>/dev/null)" == "$PROJECT" ]] || {
  echo "BLOCKED: active gcloud project is not $PROJECT" >&2
  exit 2
}
echo "=== EXISTING WORKER IDENTITY (NO ENV VALUES) ==="
gcloud run jobs describe jscc-diagnostics-dev \
  --project="$PROJECT" --region="$REGION" \
  --format='value(spec.template.spec.template.spec.serviceAccountName)' || true
echo "=== CONFIGURED WORKER CUSTOM ROLE ==="
gcloud iam roles describe jsccDiagnosticsExecutionReaderDev \
  --project="$PROJECT" \
  --format='yaml(name,includedPermissions)' || true

echo "=== PROJECT IAM BINDINGS FOR EXISTING WORKER (READ ONLY) ==="
for project in "$PROJECT" "$SHARED"; do
  echo "PROJECT: $project"
  gcloud projects get-iam-policy "$project" --format=json |
    python3 -c '
import json,sys
d=json.load(sys.stdin)
member="serviceAccount:jscc-diagnostics-dev@jscc-dev.iam.gserviceaccount.com"
for b in d.get("bindings",[]):
  if member in b.get("members",[]):
    condition=b.get("condition") or {}
    print("ROLE:",b.get("role","UNKNOWN"))
    if condition: print("CONDITION:",condition.get("title",""),condition.get("expression",""))
'
done

echo "=== TARGET SERVICE IAM BINDINGS (EXACT WORKER PRINCIPAL ONLY) ==="
for name in jscc-dev-workspace-manager jscc-dev-sandbox-worker jscc-ops-gateway-dev jscc-command-api-dev; do
  echo "SERVICE: $name"
  gcloud run services get-iam-policy "$name" --project="$PROJECT" --region="$REGION" --format=json |
    python3 -c '
import json,sys
d=json.load(sys.stdin)
m="serviceAccount:jscc-diagnostics-dev@jscc-dev.iam.gserviceaccount.com"
for b in d.get("bindings",[]):
 if m in b.get("members",[]):
  print("ROLE:",b.get("role","UNKNOWN"))
  c=b.get("condition") or {}
  if c: print("CONDITION:",c.get("title",""),c.get("expression",""))
'
done

echo "=== READ-ONLY INVENTORY COMPLETE ==="
echo "NOT_PROOF_OF_EFFECTIVE_PERMISSIONS: inherited/group/conditional permissions and cross-project access require independent verification."
