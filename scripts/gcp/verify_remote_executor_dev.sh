#!/usr/bin/env bash
set -euo pipefail
PROJECT=jscc-dev REGION=europe-west1 SHARED=jscc-shared
fail=0
check_absent(){ local policy="$1" needle="$2" label="$3"; if grep -q "$needle" <<<"$policy"; then echo "FAIL $label"; fail=1; else echo "PASS $label"; fi; }
GW="serviceAccount:jscc-ops-gateway-dev@$PROJECT.iam.gserviceaccount.com"
WK="serviceAccount:jscc-diagnostics-dev@$PROJECT.iam.gserviceaccount.com"
policy="$(gcloud projects get-iam-policy "$PROJECT" --format=json)"
check_absent "$policy" 'roles/run.admin' 'N5 gateway no run.admin'
check_absent "$policy" 'roles/editor' 'no editor role'
check_absent "$policy" 'roles/owner' 'no owner role'
role="$(gcloud iam roles describe jsccOpsGatewayDev --project="$PROJECT" --format=json)"
for p in run.executions.cancel run.jobs.runWithOverrides run.services.update run.services.delete run.jobs.update run.jobs.delete; do check_absent "$role" "$p" "prohibited $p absent"; done
for p in jscc-test jscc-prod; do q="$(gcloud projects get-iam-policy "$p" --format=json)"; check_absent "$q" 'jscc-ops-gateway-dev@jscc-dev' "N30 gateway absent from $p"; check_absent "$q" 'jscc-diagnostics-dev@jscc-dev' "N30 worker absent from $p"; done
worker_roles="$(gcloud projects get-iam-policy "$PROJECT" --flatten='bindings[].members' --filter="bindings.members:$WK" --format='value(bindings.role)')"
check_absent "$worker_roles" 'run.jobsExecutor' 'N7 worker cannot execute jobs'
[[ $fail -eq 0 ]] || exit 1
