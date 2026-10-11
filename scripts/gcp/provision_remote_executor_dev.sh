#!/usr/bin/env bash
set -euo pipefail
PROJECT=jscc-dev
SHARED=jscc-shared
REGION=europe-west1
OPS_BUCKET="${OPS_BUCKET:-jscc-dev-ops-state}"
RUNTIME_BUCKET="${GCP_RUNTIME_BUCKET:?GCP_RUNTIME_BUCKET required}"
OWNER_SUB="${GOOGLE_ALLOWED_SUB:?GOOGLE_ALLOWED_SUB required}"
GOOGLE_CLIENT_ID_VALUE="${GOOGLE_CLIENT_ID:?GOOGLE_CLIENT_ID required}"
GOOGLE_CLIENT_SECRET_VALUE="${GOOGLE_CLIENT_SECRET:?GOOGLE_CLIENT_SECRET required}"
SIGNING_KEY_VALUE="${OAUTH_CLIENT_SIGNING_KEY:?OAUTH_CLIENT_SIGNING_KEY required}"
GATEWAY_IMAGE="${GATEWAY_IMAGE:?digest-pinned GATEWAY_IMAGE required}"
WORKER_IMAGE="${WORKER_IMAGE:?digest-pinned WORKER_IMAGE required}"
SOURCE_SHA="${SOURCE_SHA:?SOURCE_SHA required}"
DEV_BASE_URL="${DEV_BASE_URL:?DEV_BASE_URL required}"
[[ "$DEV_BASE_URL" == https://* ]]
[[ "$GATEWAY_IMAGE" == *@sha256:* && "$WORKER_IMAGE" == *@sha256:* ]]
GATEWAY_DIGEST="${GATEWAY_IMAGE##*@}"
WORKER_DIGEST="${WORKER_IMAGE##*@}"
[[ "$SOURCE_SHA" =~ ^[0-9a-f]{40}$ ]]

gcloud artifacts repositories describe jscc-ops --project="$SHARED" --location="$REGION" >/dev/null 2>&1 || \
  gcloud artifacts repositories create jscc-ops --project="$SHARED" --location="$REGION" --repository-format=docker --immutable-tags

for sa in jscc-ops-build; do gcloud iam service-accounts describe "$sa@$SHARED.iam.gserviceaccount.com" --project="$SHARED" >/dev/null 2>&1 || gcloud iam service-accounts create "$sa" --project="$SHARED"; done
for sa in jscc-ops-deployer-dev jscc-ops-gateway-dev jscc-diagnostics-dev; do gcloud iam service-accounts describe "$sa@$PROJECT.iam.gserviceaccount.com" --project="$PROJECT" >/dev/null 2>&1 || gcloud iam service-accounts create "$sa" --project="$PROJECT"; done

gcloud artifacts repositories add-iam-policy-binding jscc-ops --project="$SHARED" --location="$REGION" --member="serviceAccount:jscc-ops-build@$SHARED.iam.gserviceaccount.com" --role=roles/artifactregistry.writer --condition=None >/dev/null
gcloud projects add-iam-policy-binding "$SHARED" --member="serviceAccount:jscc-ops-build@$SHARED.iam.gserviceaccount.com" --role=roles/logging.logWriter --condition=None >/dev/null

gcloud storage buckets describe "gs://$OPS_BUCKET" --project="$PROJECT" >/dev/null 2>&1 || gcloud storage buckets create "gs://$OPS_BUCKET" --project="$PROJECT" --location="$REGION" --uniform-bucket-level-access
cat >/tmp/jscc537-lifecycle.json <<JSON
{"rule":[{"action":{"type":"Delete"},"condition":{"age":14}}]}
JSON
gcloud storage buckets update "gs://$OPS_BUCKET" --lifecycle-file=/tmp/jscc537-lifecycle.json >/dev/null

put_secret(){ local n="$1" v="$2"; gcloud secrets describe "$n" --project="$PROJECT" >/dev/null 2>&1 || gcloud secrets create "$n" --project="$PROJECT" --replication-policy=automatic >/dev/null; printf %s "$v" | gcloud secrets versions add "$n" --project="$PROJECT" --data-file=- >/dev/null; }
put_secret JSCC_OPS_GOOGLE_CLIENT_ID "$GOOGLE_CLIENT_ID_VALUE"
put_secret JSCC_OPS_GOOGLE_CLIENT_SECRET "$GOOGLE_CLIENT_SECRET_VALUE"
put_secret JSCC_OPS_GOOGLE_ALLOWED_SUB "$OWNER_SUB"
put_secret JSCC_OPS_CLIENT_SIGNING_KEY "$SIGNING_KEY_VALUE"
for s in JSCC_OPS_GOOGLE_CLIENT_ID JSCC_OPS_GOOGLE_CLIENT_SECRET JSCC_OPS_GOOGLE_ALLOWED_SUB JSCC_OPS_CLIENT_SIGNING_KEY; do gcloud secrets add-iam-policy-binding "$s" --project="$PROJECT" --member="serviceAccount:jscc-ops-gateway-dev@$PROJECT.iam.gserviceaccount.com" --role=roles/secretmanager.secretAccessor --condition=None >/dev/null; done

DEV_PROJECT_NUMBER="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"
SERVERLESS_AGENT="service-${DEV_PROJECT_NUMBER}@serverless-robot-prod.iam.gserviceaccount.com"
gcloud artifacts repositories add-iam-policy-binding jscc-ops --project="$SHARED" --location="$REGION" --member="serviceAccount:$SERVERLESS_AGENT" --role=roles/artifactregistry.reader --condition=None >/dev/null

LOG_LOCATION="$(gcloud logging buckets list --project="$PROJECT" --format=json | python3 -c 'import json,re,sys
for b in json.load(sys.stdin):
    name=str(b.get("name",""))
    m=re.match(r"^projects/[^/]+/locations/([^/]+)/buckets/_Default$",name)
    if m:
        print(m.group(1))
        break
')"
[[ -n "$LOG_LOCATION" ]] || { echo "cannot resolve _Default log bucket location" >&2; exit 3; }

gcloud run jobs deploy jscc-diagnostics-dev --project="$PROJECT" --region="$REGION" --image="$WORKER_IMAGE" --service-account="jscc-diagnostics-dev@$PROJECT.iam.gserviceaccount.com" --tasks=1 --max-retries=0 --task-timeout=15m --set-env-vars="GCP_PROJECT=$PROJECT,GCP_REGION=$REGION,OPS_BUCKET=$OPS_BUCKET,GCP_RUNTIME_BUCKET=$RUNTIME_BUCKET,SOURCE_SHA=$SOURCE_SHA,GATEWAY_IMAGE_DIGEST=$GATEWAY_DIGEST,WORKER_IMAGE_DIGEST=$WORKER_DIGEST,DIAGNOSTICS_JOB=jscc-diagnostics-dev,DEV_BASE_URL=$DEV_BASE_URL,LOG_VIEW_RESOURCE=projects/$PROJECT/locations/$LOG_LOCATION/buckets/_Default/views/jscc-ops-dev"

cat >/tmp/jscc537-gateway-role.yaml <<'YAML'
title: JSCC Ops Gateway DEV
stage: GA
includedPermissions:
- run.jobs.run
YAML
gcloud iam roles describe jsccOpsGatewayDev --project="$PROJECT" >/dev/null 2>&1 && gcloud iam roles update jsccOpsGatewayDev --project="$PROJECT" --file=/tmp/jscc537-gateway-role.yaml >/dev/null || gcloud iam roles create jsccOpsGatewayDev --project="$PROJECT" --file=/tmp/jscc537-gateway-role.yaml >/dev/null
gcloud run jobs add-iam-policy-binding jscc-diagnostics-dev --project="$PROJECT" --region="$REGION" --member="serviceAccount:jscc-ops-gateway-dev@$PROJECT.iam.gserviceaccount.com" --role="projects/$PROJECT/roles/jsccOpsGatewayDev" >/dev/null

cat >/tmp/jscc537-gateway-lro-role.yaml <<'YAML'
title: JSCC Ops Gateway LRO Reader DEV
stage: GA
includedPermissions:
- run.operations.get
YAML
gcloud iam roles describe jsccOpsGatewayLroReaderDev --project="$PROJECT" >/dev/null 2>&1 && gcloud iam roles update jsccOpsGatewayLroReaderDev --project="$PROJECT" --file=/tmp/jscc537-gateway-lro-role.yaml >/dev/null || gcloud iam roles create jsccOpsGatewayLroReaderDev --project="$PROJECT" --file=/tmp/jscc537-gateway-lro-role.yaml >/dev/null
gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:jscc-ops-gateway-dev@$PROJECT.iam.gserviceaccount.com" --role="projects/$PROJECT/roles/jsccOpsGatewayLroReaderDev" --condition=None >/dev/null

cat >/tmp/jscc537-worker-exec-role.yaml <<'YAML'
title: JSCC Diagnostics Execution Reader DEV
stage: GA
includedPermissions:
- run.executions.get
YAML
gcloud iam roles describe jsccDiagnosticsExecutionReaderDev --project="$PROJECT" >/dev/null 2>&1 && gcloud iam roles update jsccDiagnosticsExecutionReaderDev --project="$PROJECT" --file=/tmp/jscc537-worker-exec-role.yaml >/dev/null || gcloud iam roles create jsccDiagnosticsExecutionReaderDev --project="$PROJECT" --file=/tmp/jscc537-worker-exec-role.yaml >/dev/null
for job in jscc-diagnostics-dev jscc-search-dev; do
  gcloud run jobs add-iam-policy-binding "$job" --project="$PROJECT" --region="$REGION" --member="serviceAccount:jscc-diagnostics-dev@$PROJECT.iam.gserviceaccount.com" --role="projects/$PROJECT/roles/jsccDiagnosticsExecutionReaderDev" >/dev/null
done

GATEWAY_PREFIX_EXPR="resource.name.startsWith('projects/_/buckets/$OPS_BUCKET/objects/auth/') || resource.name.startsWith('projects/_/buckets/$OPS_BUCKET/objects/operations/') || resource.name.startsWith('projects/_/buckets/$OPS_BUCKET/objects/idempotency/') || resource.name.startsWith('projects/_/buckets/$OPS_BUCKET/objects/limits/') || resource.name.startsWith('projects/_/buckets/$OPS_BUCKET/objects/leases/') || resource.name.startsWith('projects/_/buckets/$OPS_BUCKET/objects/dispatch/') || resource.name.startsWith('projects/_/buckets/$OPS_BUCKET/objects/results/')"
WORKER_PREFIX_EXPR="resource.name.startsWith('projects/_/buckets/$OPS_BUCKET/objects/operations/') || resource.name.startsWith('projects/_/buckets/$OPS_BUCKET/objects/leases/') || resource.name.startsWith('projects/_/buckets/$OPS_BUCKET/objects/dispatch/') || resource.name.startsWith('projects/_/buckets/$OPS_BUCKET/objects/results/') || resource.name.startsWith('projects/_/buckets/$OPS_BUCKET/objects/public/')"
gcloud storage buckets add-iam-policy-binding "gs://$OPS_BUCKET" --member="serviceAccount:jscc-ops-gateway-dev@$PROJECT.iam.gserviceaccount.com" --role=roles/storage.objectUser --condition="expression=$GATEWAY_PREFIX_EXPR,title=jscc_ops_gateway_prefixes,description=Gateway private auth and operation state only" >/dev/null
gcloud storage buckets add-iam-policy-binding "gs://$OPS_BUCKET" --member="serviceAccount:jscc-diagnostics-dev@$PROJECT.iam.gserviceaccount.com" --role=roles/storage.objectUser --condition="expression=$WORKER_PREFIX_EXPR,title=jscc_ops_worker_prefixes,description=Worker dispatch result and lease prefixes only" >/dev/null
gcloud storage buckets add-iam-policy-binding "gs://$RUNTIME_BUCKET" --member="serviceAccount:jscc-diagnostics-dev@$PROJECT.iam.gserviceaccount.com" --role=roles/storage.objectViewer --condition="expression=resource.name.startsWith('projects/_/buckets/$RUNTIME_BUCKET/objects/runs/') && resource.name.endsWith('/run-status.json'),title=jscc_ops_run_status_only,description=Remote Executor reads DEV run status metadata only" >/dev/null

gcloud logging views describe jscc-ops-dev --project="$PROJECT" --location="$LOG_LOCATION" --bucket=_Default >/dev/null 2>&1 || gcloud logging views create jscc-ops-dev --project="$PROJECT" --location="$LOG_LOCATION" --bucket=_Default --log-filter='resource.type="cloud_run_job" AND (resource.labels.job_name="jscc-search-dev" OR resource.labels.job_name="jscc-diagnostics-dev")' >/dev/null
gcloud logging views add-iam-policy-binding jscc-ops-dev --project="$PROJECT" --location="$LOG_LOCATION" --bucket=_Default --member="serviceAccount:jscc-diagnostics-dev@$PROJECT.iam.gserviceaccount.com" --role=roles/logging.viewAccessor >/dev/null

gcloud run deploy jscc-ops-gateway-dev --project="$PROJECT" --region="$REGION" --image="$GATEWAY_IMAGE" --service-account="jscc-ops-gateway-dev@$PROJECT.iam.gserviceaccount.com" --min=0 --max=1 --concurrency=20 --timeout=60 --allow-unauthenticated --set-env-vars="GCP_PROJECT=$PROJECT,GCP_REGION=$REGION,OPS_BUCKET=$OPS_BUCKET,GCP_RUNTIME_BUCKET=$RUNTIME_BUCKET,SOURCE_SHA=$SOURCE_SHA,GATEWAY_IMAGE_DIGEST=$GATEWAY_DIGEST,WORKER_IMAGE_DIGEST=$WORKER_DIGEST,DIAGNOSTICS_JOB=jscc-diagnostics-dev" --set-secrets="GOOGLE_CLIENT_ID=JSCC_OPS_GOOGLE_CLIENT_ID:latest,GOOGLE_CLIENT_SECRET=JSCC_OPS_GOOGLE_CLIENT_SECRET:latest,GOOGLE_ALLOWED_SUB=JSCC_OPS_GOOGLE_ALLOWED_SUB:latest,OAUTH_CLIENT_SIGNING_KEY=JSCC_OPS_CLIENT_SIGNING_KEY:latest"

echo "Provisioned #537 DEV resources only. Run verify_remote_executor_dev.sh before connecting ChatGPT."

cat >/tmp/jscc537-service-deployer-role.yaml <<'YAML'
title: JSCC Ops Service Deployer DEV
stage: GA
includedPermissions:
- run.services.get
- run.services.update
YAML
cat >/tmp/jscc537-job-deployer-role.yaml <<'YAML'
title: JSCC Ops Job Deployer DEV
stage: GA
includedPermissions:
- run.jobs.get
- run.jobs.update
YAML
cat >/tmp/jscc537-deploy-lro-role.yaml <<'YAML'
title: JSCC Ops Deploy LRO Reader DEV
stage: GA
includedPermissions:
- run.operations.get
YAML
for spec in \
  'jsccOpsServiceDeployerDev:/tmp/jscc537-service-deployer-role.yaml' \
  'jsccOpsJobDeployerDev:/tmp/jscc537-job-deployer-role.yaml' \
  'jsccOpsDeployLroReaderDev:/tmp/jscc537-deploy-lro-role.yaml'; do
  role="${spec%%:*}"; file="${spec#*:}"
  gcloud iam roles describe "$role" --project="$PROJECT" >/dev/null 2>&1 && gcloud iam roles update "$role" --project="$PROJECT" --file="$file" >/dev/null || gcloud iam roles create "$role" --project="$PROJECT" --file="$file" >/dev/null
done
DEPLOYER="serviceAccount:jscc-ops-deployer-dev@$PROJECT.iam.gserviceaccount.com"
gcloud run services add-iam-policy-binding jscc-ops-gateway-dev --project="$PROJECT" --region="$REGION" --member="$DEPLOYER" --role="projects/$PROJECT/roles/jsccOpsServiceDeployerDev" >/dev/null
gcloud run jobs add-iam-policy-binding jscc-diagnostics-dev --project="$PROJECT" --region="$REGION" --member="$DEPLOYER" --role="projects/$PROJECT/roles/jsccOpsJobDeployerDev" >/dev/null
gcloud projects add-iam-policy-binding "$PROJECT" --member="$DEPLOYER" --role="projects/$PROJECT/roles/jsccOpsDeployLroReaderDev" --condition=None >/dev/null
for sa in jscc-ops-gateway-dev jscc-diagnostics-dev; do
  gcloud iam service-accounts add-iam-policy-binding "$sa@$PROJECT.iam.gserviceaccount.com" --project="$PROJECT" --member="$DEPLOYER" --role=roles/iam.serviceAccountUser >/dev/null
done
gcloud artifacts repositories add-iam-policy-binding jscc-ops --project="$SHARED" --location="$REGION" --member="$DEPLOYER" --role=roles/artifactregistry.reader --condition=None >/dev/null

echo "Dedicated routine deployer configured. Use deploy_remote_executor_dev.sh under impersonation for subsequent deployments."
