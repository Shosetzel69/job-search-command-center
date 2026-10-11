#!/usr/bin/env bash
set -euo pipefail
PROJECT=jscc-dev
REGION=europe-west1
DEPLOYER="jscc-ops-deployer-dev@$PROJECT.iam.gserviceaccount.com"
OPS_BUCKET="${OPS_BUCKET:-jscc-dev-ops-state}"
RUNTIME_BUCKET="${GCP_RUNTIME_BUCKET:?GCP_RUNTIME_BUCKET required}"
GATEWAY_IMAGE="${GATEWAY_IMAGE:?digest-pinned GATEWAY_IMAGE required}"
WORKER_IMAGE="${WORKER_IMAGE:?digest-pinned WORKER_IMAGE required}"
SOURCE_SHA="${SOURCE_SHA:?SOURCE_SHA required}"
DEV_BASE_URL="${DEV_BASE_URL:?DEV_BASE_URL required}"
[[ "$DEV_BASE_URL" == https://* ]]
[[ "$GATEWAY_IMAGE" == *@sha256:* && "$WORKER_IMAGE" == *@sha256:* ]]
GATEWAY_DIGEST="${GATEWAY_IMAGE##*@}"
WORKER_DIGEST="${WORKER_IMAGE##*@}"
[[ "$SOURCE_SHA" =~ ^[0-9a-f]{40}$ ]]

gcloud run jobs describe jscc-diagnostics-dev --project="$PROJECT" --region="$REGION" --impersonate-service-account="$DEPLOYER" >/dev/null
gcloud run services describe jscc-ops-gateway-dev --project="$PROJECT" --region="$REGION" --impersonate-service-account="$DEPLOYER" >/dev/null

gcloud run jobs deploy jscc-diagnostics-dev \
  --project="$PROJECT" --region="$REGION" --impersonate-service-account="$DEPLOYER" \
  --image="$WORKER_IMAGE" --service-account="jscc-diagnostics-dev@$PROJECT.iam.gserviceaccount.com" \
  --tasks=1 --max-retries=0 --task-timeout=15m \
  --set-env-vars="GCP_PROJECT=$PROJECT,GCP_REGION=$REGION,OPS_BUCKET=$OPS_BUCKET,GCP_RUNTIME_BUCKET=$RUNTIME_BUCKET,SOURCE_SHA=$SOURCE_SHA,GATEWAY_IMAGE_DIGEST=$GATEWAY_DIGEST,WORKER_IMAGE_DIGEST=$WORKER_DIGEST,DIAGNOSTICS_JOB=jscc-diagnostics-dev,DEV_BASE_URL=$DEV_BASE_URL,LOG_VIEW_RESOURCE=projects/$PROJECT/locations/global/buckets/_Default/views/jscc-ops-dev"

gcloud run deploy jscc-ops-gateway-dev \
  --project="$PROJECT" --region="$REGION" --impersonate-service-account="$DEPLOYER" \
  --image="$GATEWAY_IMAGE" --service-account="jscc-ops-gateway-dev@$PROJECT.iam.gserviceaccount.com" \
  --min=0 --max=1 --concurrency=20 --timeout=60 \
  --set-env-vars="GCP_PROJECT=$PROJECT,GCP_REGION=$REGION,OPS_BUCKET=$OPS_BUCKET,GCP_RUNTIME_BUCKET=$RUNTIME_BUCKET,SOURCE_SHA=$SOURCE_SHA,GATEWAY_IMAGE_DIGEST=$GATEWAY_DIGEST,WORKER_IMAGE_DIGEST=$WORKER_DIGEST,DIAGNOSTICS_JOB=jscc-diagnostics-dev" \
  --set-secrets="GOOGLE_CLIENT_ID=JSCC_OPS_GOOGLE_CLIENT_ID:latest,GOOGLE_CLIENT_SECRET=JSCC_OPS_GOOGLE_CLIENT_SECRET:latest,GOOGLE_ALLOWED_SUB=JSCC_OPS_GOOGLE_ALLOWED_SUB:latest,OAUTH_CLIENT_SIGNING_KEY=JSCC_OPS_CLIENT_SIGNING_KEY:latest"

echo "Remote Executor DEV updated through dedicated deployer identity."
