#!/usr/bin/env bash
# #659: GitHub-controlled one-time DEV-only telemetry stage and rollback lane.
# All GCP mutation requires owner-approved exact PR 673 merge and explicit gate.
set -euo pipefail
mode="$1"
candidate="${2:-}"
[[ "$mode" == preflight || "$mode" == release ]] || exit 86
[[ "$candidate" =~ ^[0-9a-f]{40}$ ]] || exit 86
project=jscc-dev
shared=jscc-shared
region=europe-west1
service=jscc-command-api-dev
repo=europe-west1-docker.pkg.dev/jscc-shared/jscc/jscc-service
old_revision=jscc-command-api-dev-00098-cem
old_digest=sha256:8b9229a096a2ef723c89efed4d25111e589de1152419dd1765df703375d82d93
[[ "${GITHUB_REPOSITORY:-}" == Shosetzel69/job-search-command-center ]] || exit 86
[[ "${GITHUB_ACTOR:-}" == Shosetzel69 ]] || exit 86
[[ "$(git -C control rev-parse HEAD)" == "${GITHUB_SHA:-}" ]] || exit 86
[[ "$(git -C candidate rev-parse HEAD)" == "$candidate" ]] || exit 86
[[ -z "$(git -C candidate status --porcelain)" ]] || exit 86
immutable="$(gcloud artifacts repositories describe jscc --project="$shared" --location="$region" --format='value(dockerConfig.immutableTags)')"
[[ "$immutable" == True || "$immutable" == true ]] || { echo JSCC659_REGISTRY_NOT_IMMUTABLE; exit 86; }

# Snapshot stays in this ephemeral GitHub runner; never upload raw Service JSON.
gcloud run services describe "$service" --project="$project" --region="$region" --format=json > /tmp/jscc659-before.json
python3 control/scripts/gcp/gov85_659_stage1_guard.py preflight /tmp/jscc659-before.json
observed="$(gcloud run revisions describe "$old_revision" --project="$project" --region="$region" --format='value(status.imageDigest)')"
[[ "$observed" == "$old_digest" ]] || { echo JSCC659_OLD_SERVING_DIGEST_DRIFT; exit 86; }
echo "JSCC659_ROLLBACK_REVISION=$old_revision"
echo "JSCC659_ROLLBACK_DIGEST=$observed"
echo "JSCC659_WIF_DEV_PREFLIGHT=PASS"
if [[ "$mode" == preflight ]]; then
  echo JSCC659_PREFLIGHT_ONLY_NO_MUTATION
  exit 0
fi
[[ "${JSCC659_OWNER_GATE:-}" == APPROVE_659_STAGE1_673_DEV_RELEASE_WITH_TELEMETRY ]] || exit 86

# Existing authorized build SA, no Search Job or database image change.
image_tag="$repo:$candidate"
if gcloud artifacts docker images describe "$image_tag" --project="$shared" --format='value(image_summary.digest)' >/tmp/jscc659-existing 2>/tmp/jscc659-image-error; then
  echo JSCC659_EXISTING_IMAGE_REQUIRES_INDEPENDENT_PROVENANCE_ATTESTATION
  exit 86
else
  if ! grep -Eiq '(not found|NOT_FOUND|404)' /tmp/jscc659-image-error; then
    echo JSCC659_ARTIFACT_REGISTRY_STATE_UNVERIFIED
    exit 86
  fi
  echo JSCC659_CLOUD_BUILD_SERVICE_ONLY
  gcloud builds submit candidate --project="$shared" --region="$region" \
    --config=control/cloudbuild.531.dev-service.yaml \
    --substitutions="_GIT_SHA=$candidate" --quiet
  digest="$(gcloud artifacts docker images describe "$image_tag" --project="$shared" --format='value(image_summary.digest)')"
fi
[[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]] || { echo JSCC659_SERVICE_IMAGE_DIGEST_UNVERIFIED; exit 86; }
image="$repo@$digest"
echo "JSCC659_SERVICE_IMAGE_DIGEST=$digest"

# Revision staged with no traffic; image-only plus the three necessary
# identity/telemetry variables. Existing SA, secrets and other env unchanged.
gcloud run services update "$service" --project="$project" --region="$region" \
  --image="$image" \
  --update-env-vars="SOURCE_SHA=$candidate,RUNTIME_DATA_SHA=$candidate,JSCC_PERF_TELEMETRY=1" \
  --tag=perf659 --no-traffic --quiet >/tmp/jscc659-stage-output 2>&1 || {
    echo JSCC659_STAGING_FAILED_OLD_TRAFFIC_RETAINED; exit 86;
  }
gcloud run services describe "$service" --project="$project" --region="$region" --format=json > /tmp/jscc659-staged.json
proof="$(python3 control/scripts/gcp/gov85_659_stage1_guard.py stage /tmp/jscc659-before.json /tmp/jscc659-staged.json "$candidate")"
printf '%s\n' "$proof" | grep '^JSCC659_STAGE1_CONFIG_PARITY=PASS$' >/dev/null
revision="$(printf '%s\n' "$proof" | sed -n 's/^JSCC659_STAGE1_STAGED_REVISION=//p')"
tag_uri="$(printf '%s\n' "$proof" | sed -n 's/^JSCC659_STAGE1_TAGGED_URL=//p')"
[[ "$revision" =~ ^jscc-command-api-dev-[a-z0-9-]+$ && "$tag_uri" == https://* ]] || exit 86
actual_digest="$(gcloud run revisions describe "$revision" --project="$project" --region="$region" --format='value(status.imageDigest)')"
[[ "$actual_digest" == "$digest" ]] || { echo JSCC659_STAGED_DIGEST_MISMATCH; exit 86; }

# Authenticated tagged, zero-traffic smoke; no write / Retrieve / test data.
token="$(gcloud auth print-identity-token --audiences="$tag_uri" 2>/dev/null || true)"
if [[ -n "$token" ]]; then
  curl -fsS -H "Authorization: Bearer $token" "$tag_uri/health" >/tmp/jscc659-health.json || { echo JSCC659_TAGGED_HEALTH_DENIED; exit 86; }
  curl -fsS -H "Authorization: Bearer $token" "$tag_uri/health/db" >/tmp/jscc659-db.json || { echo JSCC659_TAGGED_NILE_READINESS_DENIED; exit 86; }
else
  curl -fsS "$tag_uri/health" >/tmp/jscc659-health.json || { echo JSCC659_TAGGED_HEALTH_DENIED; exit 86; }
  curl -fsS "$tag_uri/health/db" >/tmp/jscc659-db.json || { echo JSCC659_TAGGED_NILE_READINESS_DENIED; exit 86; }
fi
python3 - "$candidate" <<'PY'
import json,sys
a=json.load(open('/tmp/jscc659-health.json',encoding='utf8'))
b=json.load(open('/tmp/jscc659-db.json',encoding='utf8'))
sha=sys.argv[1]
assert a.get('status')=='ok' and a.get('environment')=='dev' and a.get('source_sha')==sha
assert a.get('runtime_backend')=='gcp' and a.get('search_mode')=='disabled'
assert b.get('status')=='ok' and b.get('database')=='jobsearch_dev'
print('JSCC659_TAGGED_HEALTH_NILE=PASS')
PY

rollback(){
  echo JSCC659_ATTEMPT_ROLLBACK
  if gcloud run services update-traffic "$service" --project="$project" --region="$region" \
      --to-revisions="$old_revision=100" --quiet >/tmp/jscc659-rollback 2>&1; then
    echo JSCC659_ROLLBACK_COMMAND=PASS
  else
    echo JSCC659_ROLLBACK_COMMAND=FAIL_MANUAL_RECOVERY_REQUIRED
  fi
}
trap 'rollback' ERR
gcloud run services update-traffic "$service" --project="$project" --region="$region" \
  --to-revisions="$revision=100" --quiet >/tmp/jscc659-cutover 2>&1
gcloud run services describe "$service" --project="$project" --region="$region" --format=json > /tmp/jscc659-final.json
python3 - "$revision" <<'PY'
import json,sys
s=json.load(open('/tmp/jscc659-final.json',encoding='utf8'))
traffic=s.get('status',{}).get('traffic') or s.get('traffic') or []
active=[t for t in traffic if int(t.get('percent',0))>0]
assert len(active)==1 and int(active[0].get('percent',0))==100
assert (active[0].get('revisionName') or active[0].get('revision'))==sys.argv[1]
print('JSCC659_TRAFFIC_TO_TELEMETRY_REVISION=PASS')
PY
trap - ERR
echo "JSCC659_STAGE1_DEV_DEPLOY_PASS source=$candidate revision=$revision digest=$digest"
echo JSCC659_POST_DEPLOY_BASELINE_ON_MANAGED_NILE_PENDING
