#!/usr/bin/env bash
# JSCC #589 / E2E F1: exact-target Cloud Run Task Metadata IAM repair.
# Official API permission: run.tasks.list on the parent Execution.
# Defaults to read-only checks. --apply is a deliberate, job-level CHANGE.
# Never grants anything at project/folder/organization scope.
set -euo pipefail

PROJECT=jscc-dev
REGION=europe-west1
JOB=jscc-diagnostics-dev
READER=jscc-diagnostics-dev@jscc-dev.iam.gserviceaccount.com
ROLE_ID=jsccDiagnosticsExecutionReaderDev
ROLE="projects/${PROJECT}/roles/${ROLE_ID}"
MEMBER="serviceAccount:${READER}"
MODE="${1:---check}"

if [[ "$MODE" != "--check" && "$MODE" != "--apply" ]]; then
  echo "DENIED: only --check or --apply accepted" >&2
  exit 64
fi
command -v gcloud >/dev/null || { echo "BLOCKED: gcloud not installed" >&2; exit 3; }
command -v python3 >/dev/null || { echo "BLOCKED: python3 not installed" >&2; exit 3; }

# Confirm the effective Job service identity. A grant to a different SA
# would be ineffective and would leak read permissions unnecessarily.
job_json="$(gcloud run jobs describe "$JOB" --project="$PROJECT" \
  --region="$REGION" --format=json)"
job_sa="$(python3 -c '
import json,sys
data=json.load(sys.stdin)
names=[]
def walk(x):
    if isinstance(x,dict):
        for key,value in x.items():
            if key in ("serviceAccount","serviceAccountName") and isinstance(value,str):
                names.append(value)
            elif isinstance(value,(dict,list)):
                walk(value)
    elif isinstance(x,list):
        for value in x: walk(value)
walk(data)
unique=sorted(set(names))
print(unique[0] if len(unique)==1 else "UNKNOWN")
' <<<"$job_json")"
if [[ "$job_sa" != "$READER" ]]; then
  echo "BLOCKED: diagnostic Job service identity is not the expected account" >&2
  exit 4
fi
echo "JOB_IDENTITY_OK job=${JOB} principal=${READER}"

# Reuse the existing custom role; never create a generic Viewer/Admin grant.
# Fail closed if its exact required read permissions are missing.
role_json="$(gcloud iam roles describe "$ROLE_ID" --project="$PROJECT" --format=json)"
if ! python3 -c '
import json,sys
role=json.load(sys.stdin)
perms=set(role.get("includedPermissions",[]))
required={"run.executions.get","run.tasks.list"}
if not required.issubset(perms): sys.exit(1)
# Do not use a role accidentally extended with mutating privileges.
if any(p.endswith((".create",".update",".delete",".setIamPolicy",
                   ".run",".runWithOverrides",".cancel")) for p in perms):
    sys.exit(2)
' <<<"$role_json"; then
  echo "BLOCKED: existing custom role is missing read permissions or includes changes" >&2
  exit 5
fi
echo "ROLE_READ_ONLY_OK role=${ROLE}"

policy_state() {
  local policy
  policy="$(gcloud run jobs get-iam-policy "$JOB" --project="$PROJECT" \
    --region="$REGION" --format=json)"
  python3 -c '
import json,sys
policy=json.load(sys.stdin)
role,member=sys.argv[1:]
matches=[b for b in policy.get("bindings",[]) if
         b.get("role")==role and member in b.get("members",[])]
if any(not b.get("condition") for b in matches):
    print("PRESENT")
elif matches:
    print("CONDITIONAL")
else:
    print("MISSING")
' "$ROLE" "$MEMBER" <<<"$policy"
}
state="$(policy_state)"
case "$state" in
  PRESENT)
    echo "JOB_BINDING_PRESENT job=${JOB} role=${ROLE}"
    ;;
  CONDITIONAL)
    echo "BLOCKED: conditional IAM binding requires separate policy analysis; no broadening" >&2
    exit 6
    ;;
  MISSING)
    if [[ "$MODE" == "--check" ]]; then
      echo "JOB_BINDING_MISSING: use reviewed --apply on this DEV Job only" >&2
      exit 7
    fi
    echo "APPLYING_JOB_LEVEL_ONLY job=${JOB} role=${ROLE}"
    gcloud run jobs add-iam-policy-binding "$JOB" --project="$PROJECT" \
      --region="$REGION" --member="$MEMBER" --role="$ROLE" \
      --condition=None --quiet >/dev/null
    [[ "$(policy_state)" == PRESENT ]] || {
      echo "BLOCKED: job-level binding not confirmed after apply" >&2
      exit 8
    }
    echo "JOB_BINDING_APPLIED_AND_CONFIRMED"
    ;;
  *)
    echo "BLOCKED: unexpected IAM policy state" >&2
    exit 9
    ;;
esac

# This validates only the allow binding, not deny/PAB/org policies or
# the resulting live tasks.list call. Never report E2E PASS from IAM alone.
echo "IAM_BINDING_CHECK_PASS; EFFECTIVE_ACCESS_UNVERIFIED"
echo "NEXT: Policy Troubleshooter on the Execution + worker-identity E2E tasks.list"
