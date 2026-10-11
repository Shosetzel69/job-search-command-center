#!/usr/bin/env bash
set -euo pipefail

PROJECT=jscc-dev
SHARED=jscc-shared
REGION=europe-west1
OPS_BUCKET="${OPS_BUCKET:-jscc-dev-ops-state}"
if [[ -n "${GCP_RUNTIME_BUCKET:-}" ]]; then
  RUNTIME_BUCKET="$GCP_RUNTIME_BUCKET"
else
  APP_JSON="$(gcloud run services describe jscc-command-api-dev --project="$PROJECT" --region="$REGION" --format=json)"
  RUNTIME_BUCKET="$(python3 -c 'import json,sys
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
[[ -n "$RUNTIME_BUCKET" ]] || { echo "FAIL cannot resolve GCP_RUNTIME_BUCKET" >&2; exit 2; }
GW_EMAIL="jscc-ops-gateway-dev@$PROJECT.iam.gserviceaccount.com"
WK_EMAIL="jscc-diagnostics-dev@$PROJECT.iam.gserviceaccount.com"
DP_EMAIL="jscc-ops-deployer-dev@$PROJECT.iam.gserviceaccount.com"
BUILD_EMAIL="jscc-ops-build@$SHARED.iam.gserviceaccount.com"
LOG_LOCATION="$(gcloud logging buckets list --project="$PROJECT" --format=json | python3 -c 'import json,re,sys
for b in json.load(sys.stdin):
    name=str(b.get("name",""))
    m=re.match(r"^projects/[^/]+/locations/([^/]+)/buckets/_Default$",name)
    if m:
        print(m.group(1))
        break
')"
[[ -n "$LOG_LOCATION" ]] || { echo "FAIL cannot resolve _Default log bucket location" >&2; exit 2; }
PRODUCT_BUILD_EMAIL="jscc-build@$SHARED.iam.gserviceaccount.com"
GW="serviceAccount:$GW_EMAIL"
WK="serviceAccount:$WK_EMAIL"
DP="serviceAccount:$DP_EMAIL"
fail=0

pass(){ printf 'PASS %s\n' "$1"; }
fail_msg(){ printf 'FAIL %s\n' "$1" >&2; fail=1; }
contains(){ grep -Fq -- "$2" <<<"$1"; }
require_contains(){ if contains "$1" "$2"; then pass "$3"; else fail_msg "$3"; fi; }
require_absent(){ if contains "$1" "$2"; then fail_msg "$3"; else pass "$3"; fi; }
role_permissions_exact(){
  local role="$1" expected="$2" label="$3" project="$4" json
  json="$(gcloud iam roles describe "$role" --project="$project" --format=json)"
  python3 -c 'import json,sys; e={x for x in sys.argv[1].split(",") if x}; label=sys.argv[2]; a=set((json.load(sys.stdin).get("includedPermissions") or [])); ok=a==e; print(("PASS " if ok else "FAIL ")+label+("" if ok else f": expected={sorted(e)} actual={sorted(a)}"),file=sys.stdout if ok else sys.stderr); raise SystemExit(0 if ok else 1)' "$expected" "$label" <<<"$json" || fail=1
}

echo '=== #537 IAM / runtime verification ==='

# Gateway: exactly one Job execution permission plus LRO status read.
role_permissions_exact jsccOpsGatewayDev 'run.jobs.run' 'gateway run role exact' "$PROJECT"
role_permissions_exact jsccOpsGatewayLroReaderDev 'run.operations.get' 'gateway LRO role exact' "$PROJECT"
DIAG_POLICY="$(gcloud run jobs get-iam-policy jscc-diagnostics-dev --project="$PROJECT" --region="$REGION" --format=json)"
SEARCH_POLICY="$(gcloud run jobs get-iam-policy jscc-search-dev --project="$PROJECT" --region="$REGION" --format=json)"
require_contains "$DIAG_POLICY" "$GW_EMAIL" 'gateway bound to diagnostics job'
require_contains "$DIAG_POLICY" 'jsccOpsGatewayDev' 'gateway custom run role on diagnostics job'
require_absent "$SEARCH_POLICY" "$GW_EMAIL" 'N16 gateway cannot execute search job'
GW_PROJECT_ROLES="$(gcloud projects get-iam-policy "$PROJECT" --flatten='bindings[].members' --filter="bindings.members:$GW" --format='value(bindings.role)')"
require_contains "$GW_PROJECT_ROLES" 'jsccOpsGatewayLroReaderDev' 'gateway project grant includes only LRO reader capability'
for role in roles/run.admin roles/run.developer roles/run.jobsExecutor roles/run.jobsExecutorWithOverrides roles/editor roles/owner roles/viewer roles/logging.viewer; do
  require_absent "$GW_PROJECT_ROLES" "$role" "gateway lacks $role"
done

# Worker: execution metadata only on the two allowlisted Jobs; never Job execution/admin.
role_permissions_exact jsccDiagnosticsExecutionReaderDev 'run.executions.get' 'worker execution-reader role exact' "$PROJECT"
WK_PROJECT_ROLES="$(gcloud projects get-iam-policy "$PROJECT" --flatten='bindings[].members' --filter="bindings.members:$WK" --format='value(bindings.role)')"
for role in roles/run.admin roles/run.developer roles/run.jobsExecutor roles/run.jobsExecutorWithOverrides roles/editor roles/owner roles/viewer roles/logging.viewer; do
  require_absent "$WK_PROJECT_ROLES" "$role" "worker lacks $role"
done
for job in jscc-search-dev jscc-diagnostics-dev; do
  p="$(gcloud run jobs get-iam-policy "$job" --project="$PROJECT" --region="$REGION" --format=json)"
  require_contains "$p" "$WK_EMAIL" "worker execution-read bound on $job"
  require_contains "$p" 'jsccDiagnosticsExecutionReaderDev' "worker exact reader role on $job"
done

# Separate artifact lineage.
OPS_AR_POLICY="$(gcloud artifacts repositories get-iam-policy jscc-ops --project="$SHARED" --location="$REGION" --format=json)"
PRODUCT_AR_POLICY="$(gcloud artifacts repositories get-iam-policy jscc --project="$SHARED" --location="$REGION" --format=json)"
OPS_BUILD_SOURCE_BUCKET="${SHARED}-ops-cloudbuild-source"
BUILD_SOURCE_POLICY="$(gcloud storage buckets get-iam-policy "gs://$OPS_BUILD_SOURCE_BUCKET" --format=json)"
BUILD_SOURCE_DESC="$(gcloud storage buckets describe "gs://$OPS_BUILD_SOURCE_BUCKET" --format=json)"
require_contains "$BUILD_SOURCE_POLICY" "$BUILD_EMAIL" 'ops build identity can read dedicated Cloud Build source bucket'
require_contains "$BUILD_SOURCE_POLICY" 'roles/storage.objectViewer' 'ops build source bucket uses objectViewer'
python3 -c 'import json,sys; d=json.load(sys.stdin); ubla=(d.get("uniform_bucket_level_access") is True) or (((d.get("iamConfiguration") or {}).get("uniformBucketLevelAccess") or {}).get("enabled") is True); lc=d.get("lifecycle_config") or d.get("lifecycle") or {}; rules=lc.get("rule") or lc.get("rules") or []; ttl=any((r.get("action") or {}).get("type")=="Delete" and int((r.get("condition") or {}).get("age",-1))==1 for r in rules); ok=ubla and ttl; print(("PASS " if ok else "FAIL ")+"dedicated build source bucket UBLA + 1-day lifecycle",file=sys.stdout if ok else sys.stderr); raise SystemExit(0 if ok else 1)' <<<"$BUILD_SOURCE_DESC" || fail=1
require_contains "$OPS_AR_POLICY" "$BUILD_EMAIL" 'ops build identity can publish jscc-ops'
require_contains "$OPS_AR_POLICY" "$DP_EMAIL" 'ops deployer can read jscc-ops'
require_absent "$OPS_AR_POLICY" "$PRODUCT_BUILD_EMAIL" 'N18 product build identity absent from jscc-ops repository policy'
require_absent "$PRODUCT_AR_POLICY" "$BUILD_EMAIL" 'N19 ops build identity absent from product artifact repo'
require_absent "$PRODUCT_AR_POLICY" "$DP_EMAIL" 'N19 ops deployer absent from product artifact repo'

PRODUCT_BUILD_PROJECT_ROLES="$(gcloud projects get-iam-policy "$SHARED" --flatten='bindings[].members' --filter="bindings.members:serviceAccount:$PRODUCT_BUILD_EMAIL" --format='value(bindings.role)')"
OPS_BUILD_PROJECT_ROLES="$(gcloud projects get-iam-policy "$SHARED" --flatten='bindings[].members' --filter="bindings.members:serviceAccount:$BUILD_EMAIL" --format='value(bindings.role)')"
for role in roles/artifactregistry.writer roles/artifactregistry.repoAdmin roles/artifactregistry.admin; do
  require_absent "$PRODUCT_BUILD_PROJECT_ROLES" "$role" "N18 product build has no project-wide Artifact Registry writer/admin: $role"
  require_absent "$OPS_BUILD_PROJECT_ROLES" "$role" "N19 ops build has no project-wide Artifact Registry writer/admin: $role"
done

# Routine deployer can update only the two existing ops resources.
role_permissions_exact jsccOpsServiceDeployerDev 'run.services.get,run.services.update' 'ops service deployer role exact' "$PROJECT"
role_permissions_exact jsccOpsJobDeployerDev 'run.jobs.get,run.jobs.update' 'ops job deployer role exact' "$PROJECT"
role_permissions_exact jsccOpsDeployLroReaderDev 'run.operations.get' 'ops deploy LRO role exact' "$PROJECT"
GW_SERVICE_POLICY="$(gcloud run services get-iam-policy jscc-ops-gateway-dev --project="$PROJECT" --region="$REGION" --format=json)"
require_contains "$GW_SERVICE_POLICY" "$DP_EMAIL" 'deployer bound to gateway service'
require_contains "$DIAG_POLICY" "$DP_EMAIL" 'deployer bound to diagnostics job'
for svc in $(gcloud run services list --project="$PROJECT" --region="$REGION" --format='value(metadata.name)'); do
  [[ "$svc" == jscc-ops-gateway-dev ]] && continue
  p="$(gcloud run services get-iam-policy "$svc" --project="$PROJECT" --region="$REGION" --format=json)"
  require_absent "$p" "$DP_EMAIL" "ops deployer absent from product service $svc"
done
for job in $(gcloud run jobs list --project="$PROJECT" --region="$REGION" --format='value(metadata.name)'); do
  [[ "$job" == jscc-diagnostics-dev ]] && continue
  p="$(gcloud run jobs get-iam-policy "$job" --project="$PROJECT" --region="$REGION" --format=json)"
  require_absent "$p" "$DP_EMAIL" "ops deployer absent from product job $job"
done

# Storage prefixes: worker cannot read auth material; gateway cannot read runtime data.
OPS_POLICY="$(gcloud storage buckets get-iam-policy "gs://$OPS_BUCKET" --format=json)"
require_contains "$OPS_POLICY" 'jscc_ops_gateway_prefixes' 'gateway ops-state condition exists'
require_contains "$OPS_POLICY" 'jscc_ops_worker_prefixes' 'worker ops-state condition exists'
python3 -c 'import json,sys; gw,wk=sys.argv[1:]; d=json.load(sys.stdin); ex=lambda m:"\n".join((b.get("condition") or {}).get("expression","") for b in d.get("bindings",[]) if m in b.get("members",[])); ge=ex("serviceAccount:"+gw); we=ex("serviceAccount:"+wk); c=[("gateway includes auth prefix","/objects/auth/" in ge),("worker excludes auth prefix","/objects/auth/" not in we),("worker includes public prefix","/objects/public/" in we),("worker includes dispatch prefix","/objects/dispatch/" in we)]; [print(("PASS " if ok else "FAIL ")+label,file=sys.stdout if ok else sys.stderr) for label,ok in c]; raise SystemExit(0 if all(ok for _,ok in c) else 1)' "$GW_EMAIL" "$WK_EMAIL" <<<"$OPS_POLICY" || fail=1
RUNTIME_POLICY="$(gcloud storage buckets get-iam-policy "gs://$RUNTIME_BUCKET" --format=json)"
require_contains "$RUNTIME_POLICY" "$WK_EMAIL" 'worker has DEV runtime read binding'
require_contains "$RUNTIME_POLICY" '/objects/runs/' 'worker runtime binding limited to runs prefix'
require_contains "$RUNTIME_POLICY" "/run-status.json" 'worker runtime binding limited to run-status metadata'
require_absent "$RUNTIME_POLICY" "/jobs.json" 'worker runtime binding excludes jobs payloads'
require_absent "$RUNTIME_POLICY" "$GW_EMAIL" 'N6 gateway has no raw runtime bucket access'
BUCKET_DESC="$(gcloud storage buckets describe "gs://$OPS_BUCKET" --format=json)"
python3 -c 'import json,sys; d=json.load(sys.stdin); lc=d.get("lifecycle_config") or d.get("lifecycle") or {}; rules=lc.get("rule") or lc.get("rules") or []; ages=[int((r.get("condition") or {}).get("age",-1)) for r in rules if (r.get("action") or {}).get("type")=="Delete"]; ok=14 in ages; print(("PASS " if ok else "FAIL ")+"private ops-state lifecycle is 14 days",file=sys.stdout if ok else sys.stderr); raise SystemExit(0 if ok else 1)' <<<"$BUCKET_DESC" || fail=1

# Dedicated log view only.
LOG_POLICY="$(gcloud logging views get-iam-policy jscc-ops-dev --project="$PROJECT" --location="$LOG_LOCATION" --bucket=_Default --format=json)"
require_contains "$LOG_POLICY" "$WK_EMAIL" 'worker bound to dedicated log view'
require_contains "$LOG_POLICY" 'roles/logging.viewAccessor' 'worker uses logging.viewAccessor'
VIEW="$(gcloud logging views describe jscc-ops-dev --project="$PROJECT" --location="$LOG_LOCATION" --bucket=_Default --format=json)"
require_contains "$VIEW" 'jscc-search-dev' 'log view includes search job'
require_contains "$VIEW" 'jscc-diagnostics-dev' 'log view includes diagnostics job'

# OAuth secrets are gateway-only.
for secret in JSCC_OPS_GOOGLE_CLIENT_ID JSCC_OPS_GOOGLE_CLIENT_SECRET JSCC_OPS_GOOGLE_ALLOWED_SUB JSCC_OPS_CLIENT_SIGNING_KEY; do
  p="$(gcloud secrets get-iam-policy "$secret" --project="$PROJECT" --format=json)"
  require_contains "$p" "$GW_EMAIL" "gateway can access $secret"
  require_absent "$p" "$WK_EMAIL" "worker cannot access $secret"
done

# Runtime/cost invariants.
JOB_DESC="$(gcloud run jobs describe jscc-diagnostics-dev --project="$PROJECT" --region="$REGION" --format=json)"
SERVICE_DESC="$(gcloud run services describe jscc-ops-gateway-dev --project="$PROJECT" --region="$REGION" --format=json)"
require_contains "$JOB_DESC" '"maxRetries": 0' 'worker automatic retry is zero'
require_contains "$JOB_DESC" "$WK_EMAIL" 'diagnostics job uses dedicated worker identity'
require_contains "$SERVICE_DESC" "$GW_EMAIL" 'gateway uses dedicated gateway identity'
python3 -c 'import json,sys; d=json.load(sys.stdin); vals=[]; vals.append((d.get("scaling") or {}).get("maxInstanceCount")); vals.append(((d.get("metadata") or {}).get("annotations") or {}).get("run.googleapis.com/maxScale")); vals.append((((((d.get("spec") or {}).get("template") or {}).get("metadata") or {}).get("annotations") or {}).get("autoscaling.knative.dev/maxScale"))); ok=any(str(v)=="1" for v in vals if v is not None); print(("PASS " if ok else "FAIL ")+"gateway max instances = 1",file=sys.stdout if ok else sys.stderr); raise SystemExit(0 if ok else 1)' <<<"$SERVICE_DESC" || fail=1

# N29/N30 — no DB/tenant secret role and zero TEST/PROD grants.
WK_SECRET_BINDINGS="$(gcloud projects get-iam-policy "$PROJECT" --flatten='bindings[].members' --filter="bindings.members:$WK AND bindings.role:roles/secretmanager" --format='value(bindings.role)')"
[[ -z "$WK_SECRET_BINDINGS" ]] && pass 'N29 worker has no project Secret Manager role' || fail_msg 'N29 worker has project Secret Manager role'
for p in jscc-test jscc-prod; do
  policy="$(gcloud projects get-iam-policy "$p" --format=json)"
  require_absent "$policy" "$GW_EMAIL" "N30 gateway absent from $p"
  require_absent "$policy" "$WK_EMAIL" "N30 worker absent from $p"
  require_absent "$policy" "$DP_EMAIL" "N30 deployer absent from $p"
done

[[ $fail -eq 0 ]] || exit 1
echo 'REMOTE_EXECUTOR_IAM_VERIFY=PASS'
