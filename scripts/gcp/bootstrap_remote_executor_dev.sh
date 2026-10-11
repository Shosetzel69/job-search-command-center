#!/usr/bin/env bash
set -euo pipefail

PROJECT=jscc-dev
SHARED=jscc-shared
REGION=europe-west1
OPS_BUCKET="${OPS_BUCKET:-jscc-dev-ops-state}"
GATEWAY_REPO="europe-west1-docker.pkg.dev/$SHARED/jscc-ops/jscc-ops-gateway"
WORKER_REPO="europe-west1-docker.pkg.dev/$SHARED/jscc-ops/jscc-diagnostics"

command -v gcloud >/dev/null
command -v git >/dev/null
command -v python3 >/dev/null

[[ -z "$(git status --porcelain)" ]] || { echo "working tree must be clean" >&2; exit 2; }
SOURCE_SHA="$(git rev-parse HEAD)"
[[ "$SOURCE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "invalid Git SHA" >&2; exit 2; }

echo "BOOTSTRAP_SOURCE_SHA=$SOURCE_SHA"

# Bootstrap only the isolated build foundation required before images exist.
gcloud artifacts repositories describe jscc-ops --project="$SHARED" --location="$REGION" >/dev/null 2>&1 ||   gcloud artifacts repositories create jscc-ops --project="$SHARED" --location="$REGION" --repository-format=docker --immutable-tags

gcloud iam service-accounts describe "jscc-ops-build@$SHARED.iam.gserviceaccount.com" --project="$SHARED" >/dev/null 2>&1 ||   gcloud iam service-accounts create jscc-ops-build --project="$SHARED"

gcloud artifacts repositories add-iam-policy-binding jscc-ops --project="$SHARED" --location="$REGION"   --member="serviceAccount:jscc-ops-build@$SHARED.iam.gserviceaccount.com" --role=roles/artifactregistry.writer --condition=None >/dev/null
gcloud projects add-iam-policy-binding "$SHARED"   --member="serviceAccount:jscc-ops-build@$SHARED.iam.gserviceaccount.com" --role=roles/logging.logWriter --condition=None >/dev/null

# Build exact current SHA with the isolated ops build identity.
gcloud builds submit   --project="$SHARED"   --region="$REGION"   --config=cloudbuild.ops.yaml   --substitutions="_GIT_SHA=$SOURCE_SHA"   .

GATEWAY_DIGEST="$(gcloud artifacts docker images describe "$GATEWAY_REPO:$SOURCE_SHA" --project="$SHARED" --format='value(image_summary.digest)')"
WORKER_DIGEST="$(gcloud artifacts docker images describe "$WORKER_REPO:$SOURCE_SHA" --project="$SHARED" --format='value(image_summary.digest)')"
[[ "$GATEWAY_DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]]
[[ "$WORKER_DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]]
GATEWAY_IMAGE="$GATEWAY_REPO@$GATEWAY_DIGEST"
WORKER_IMAGE="$WORKER_REPO@$WORKER_DIGEST"

# Resolve existing DEV target facts under the bootstrap owner identity; runtime identities never receive this read authority.
APP_JSON="$(gcloud run services describe jscc-command-api-dev --project="$PROJECT" --region="$REGION" --format=json)"
DEV_BASE_URL="${DEV_BASE_URL:-$(python3 -c 'import json,sys; d=json.load(sys.stdin); print((d.get("status") or {}).get("url") or "")' <<<"$APP_JSON")}"
if [[ -z "${GCP_RUNTIME_BUCKET:-}" ]]; then
  GCP_RUNTIME_BUCKET="$(python3 -c 'import json,sys
d=json.load(sys.stdin)
def walk(x):
    if isinstance(x,dict):
        if x.get("name")=="GCP_RUNTIME_BUCKET" and isinstance(x.get("value"),str): return x["value"]
        for v in x.values():
            r=walk(v)
            if r: return r
    elif isinstance(x,list):
        for v in x:
            r=walk(v)
            if r: return r
    return ""
print(walk(d))' <<<"$APP_JSON")"
fi
[[ "$DEV_BASE_URL" == https://* ]] || { echo "cannot resolve DEV_BASE_URL" >&2; exit 3; }
[[ -n "$GCP_RUNTIME_BUCKET" ]] || { echo "cannot resolve GCP_RUNTIME_BUCKET" >&2; exit 3; }

# Remote Executor owner identity is independent from product runtime identity.
if [[ -z "${GOOGLE_ALLOWED_SUB:-}" ]]; then
  read -rp "Remote Executor Google owner sub: " GOOGLE_ALLOWED_SUB
fi
[[ -n "$GOOGLE_ALLOWED_SUB" ]] || { echo "Remote Executor Google owner sub is required" >&2; exit 3; }

if [[ -z "${GOOGLE_CLIENT_ID:-}" ]]; then
  read -rp "Remote Executor Google OAuth client ID: " GOOGLE_CLIENT_ID
fi
if [[ -z "${GOOGLE_CLIENT_SECRET:-}" ]]; then
  read -rsp "Remote Executor Google OAuth client secret: " GOOGLE_CLIENT_SECRET
  echo
fi
[[ -n "$GOOGLE_CLIENT_ID" && -n "$GOOGLE_CLIENT_SECRET" ]]
OAUTH_CLIENT_SIGNING_KEY="${OAUTH_CLIENT_SIGNING_KEY:-$(python3 -c 'import secrets; print(secrets.token_urlsafe(48))')}"

export OPS_BUCKET GCP_RUNTIME_BUCKET DEV_BASE_URL GOOGLE_ALLOWED_SUB GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET
export OAUTH_CLIENT_SIGNING_KEY GATEWAY_IMAGE WORKER_IMAGE SOURCE_SHA

scripts/gcp/provision_remote_executor_dev.sh

GATEWAY_URL="$(gcloud run services describe jscc-ops-gateway-dev --project="$PROJECT" --region="$REGION" --format='value(status.url)')"
[[ "$GATEWAY_URL" == https://* ]]

echo
echo "REMOTE_EXECUTOR_BOOTSTRAP=PROVISIONED"
echo "SOURCE_SHA=$SOURCE_SHA"
echo "GATEWAY_IMAGE=$GATEWAY_IMAGE"
echo "WORKER_IMAGE=$WORKER_IMAGE"
echo "GATEWAY_URL=$GATEWAY_URL"
echo "GOOGLE_OAUTH_REDIRECT_URI=$GATEWAY_URL/oauth/google/callback"
echo "CHATGPT_MCP_URL=$GATEWAY_URL/mcp"
echo
echo "NEXT: add GOOGLE_OAUTH_REDIRECT_URI to the Google OAuth client, then run:"
echo "GCP_RUNTIME_BUCKET=$GCP_RUNTIME_BUCKET scripts/gcp/verify_remote_executor_dev.sh"
