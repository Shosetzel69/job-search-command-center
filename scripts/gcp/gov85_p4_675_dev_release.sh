#!/usr/bin/env bash
# P4 PR675: one-time DEV Service-only release, no Search Job / DB / IAM.
set -euo pipefail
mode="${1:-}"
source_sha="${2:-}"
target=b8fa506987bd79053f5c3cf86137f32e41a4095b
old_revision=jscc-command-api-dev-00100-mek
old_digest=sha256:588e56244e1b336b257be44721c8b9b4839a624bd7c7d31beafac5a47f72cbd4
project=jscc-dev
shared=jscc-shared
region=europe-west1
service=jscc-command-api-dev
image_repo=europe-west1-docker.pkg.dev/jscc-shared/jscc/jscc-service
guard=control/scripts/gcp/gov85_p4_675_dev_guard.py
[[ "$mode" == preflight || "$mode" == release ]] || exit 86
[[ "$source_sha" == "$target" ]] || { echo JSCC_P4_UNAUTHORIZED_SHA; exit 86; }
[[ "${GITHUB_REPOSITORY:-}" == Shosetzel69/job-search-command-center ]] || exit 86
[[ "${GITHUB_ACTOR:-}" == Shosetzel69 ]] || exit 86
[[ "${GITHUB_SHA:-}" =~ ^[a-f0-9]{40}$ ]] || exit 86
[[ "$(git -C control rev-parse HEAD)" == "$GITHUB_SHA" ]] || exit 86
[[ "$(git -C candidate rev-parse HEAD)" == "$target" ]] || exit 86
[[ -z "$(git -C candidate status --porcelain)" ]] || exit 86
[[ -n "${GCP_WIF_SA:-}" ]] || { echo JSCC_P4_WIF_MISSING; exit 86; }
image_tag="$image_repo:$target"
umask 077
immutable="$(gcloud artifacts repositories describe jscc --project="$shared" --location="$region" --format='value(dockerConfig.immutableTags)')"
[[ "$immutable" == True || "$immutable" == true ]] || { echo JSCC_P4_REGISTRY_NOT_IMMUTABLE; exit 86; }

# Private JSON snapshots never leave runner /tmp and never enter CI logs.
gcloud run services describe "$service" --project="$project" --region="$region" --format=json > /tmp/jscc-p4-before.json
python3 "$guard" baseline /tmp/jscc-p4-before.json
actual_old="$(gcloud run revisions describe "$old_revision" --project="$project" --region="$region" --format='value(status.imageDigest)')"
[[ "$actual_old" == "$old_digest" ]] || { echo JSCC_P4_ROLLBACK_DIGEST_CHANGED; exit 86; }
service_url="$(gcloud run services describe "$service" --project="$project" --region="$region" --format='value(status.url)')"
[[ "$service_url" =~ ^https://[a-z0-9-]+(\.a)?\.run\.app$ ]] || { echo JSCC_P4_CANONICAL_URL_INVALID; exit 86; }
id_token="$(gcloud auth print-identity-token --impersonate-service-account="$GCP_WIF_SA" \
 --audiences="$service_url" 2>/tmp/jscc-p4-auth-error)" || { echo JSCC_P4_INVOCATION_DENIED; exit 86; }
[[ "$id_token" =~ ^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$ ]] || exit 86
curl --fail --silent --show-error --connect-timeout 10 --max-time 30 \
 -H "Authorization: Bearer $id_token" "$service_url/health" >/tmp/jscc-p4-before-health.json
python3 - <<'PY'
import json
h=json.load(open('/tmp/jscc-p4-before-health.json',encoding='utf8'))
assert h.get('status')=='ok' and h.get('environment')=='dev'
assert h.get('runtime_backend')=='gcp' and h.get('search_mode')=='disabled'
print('JSCC_P4_DEV_AUTHENTICATED_PREFLIGHT=PASS')
PY
unset id_token
echo "JSCC_P4_BASELINE_REVISION=$old_revision"
echo "JSCC_P4_BASELINE_DIGEST=$old_digest"
if [[ "$mode" == preflight ]]; then
  echo JSCC_P4_PREFLIGHT_ONLY_NO_MUTATION
  exit 0
fi
[[ "${JSCC_P4_RELEASE_GATE:-}" == APPROVE_P4_675_B8FA506_DEV_SERVICE_ONLY ]] || exit 86

# Only the existing Cloud Build Service image pipeline is allowed.
if gcloud artifacts docker images describe "$image_tag" --project="$shared" \
  --format='value(image_summary.digest)' >/tmp/jscc-p4-existing 2>/tmp/jscc-p4-lookup-error; then
  digest="$(cat /tmp/jscc-p4-existing)"
  echo JSCC_P4_EXISTING_SERVICE_IMAGE_FOUND
else
  if ! grep -Eiq '(not found|NOT_FOUND|404)' /tmp/jscc-p4-lookup-error; then
    echo JSCC_P4_ARTIFACT_LOOKUP_UNVERIFIED
    exit 86
  fi
  echo JSCC_P4_BUILD_SERVICE_ONLY
  gcloud builds submit candidate --project="$shared" --region="$region" \
    --config=control/cloudbuild.531.dev-service.yaml \
    --substitutions="_GIT_SHA=$target" --quiet
  digest="$(gcloud artifacts docker images describe "$image_tag" --project="$shared" --format='value(image_summary.digest)')"
fi
[[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]] || exit 86
gcloud builds list --project="$shared" --region="$region" --filter='status=SUCCESS' \
  --limit=200 --format=json >/tmp/jscc-p4-builds.json
python3 "$guard" attest /tmp/jscc-p4-builds.json "$digest"
echo "JSCC_P4_SERVICE_DIGEST=$digest"

# All template/VPC/SA/secrets and old traffic must be unchanged since preflight.
gcloud run services describe "$service" --project="$project" --region="$region" --format=json >/tmp/jscc-p4-prestage.json
python3 "$guard" unchanged /tmp/jscc-p4-before.json /tmp/jscc-p4-prestage.json
gcloud run services update "$service" --project="$project" --region="$region" \
 --image="$image_repo@$digest" \
 --update-env-vars="SOURCE_SHA=$target,RUNTIME_DATA_SHA=$target" \
 --tag=p4w1 --no-traffic --quiet >/tmp/jscc-p4-stage-log 2>&1 || {
   echo JSCC_P4_STAGE_FAILED_OLD_TRAFFIC_PRESERVED; exit 86;
 }
gcloud run services describe "$service" --project="$project" --region="$region" --format=json >/tmp/jscc-p4-staged.json
proof="$(python3 "$guard" stage /tmp/jscc-p4-before.json /tmp/jscc-p4-staged.json)"
grep -Fqx 'JSCC_P4_STAGED_CONFIG_PARITY=PASS' <<<"$proof" || exit 86
revision="$(sed -n 's/^JSCC_P4_STAGED_REVISION=//p' <<<"$proof")"
tag_url="$(sed -n 's/^JSCC_P4_STAGED_URL=//p' <<<"$proof")"
[[ "$revision" =~ ^jscc-command-api-dev-[a-z0-9-]+$ ]] || exit 86
[[ "$tag_url" =~ ^https://[a-z0-9-]+(\.a)?\.run\.app$ ]] || exit 86
rev_digest="$(gcloud run revisions describe "$revision" --project="$project" --region="$region" --format='value(status.imageDigest)')"
[[ "$rev_digest" == "$digest" ]] || { echo JSCC_P4_STAGED_DIGEST_INVALID; exit 86; }

id_token="$(gcloud auth print-identity-token --impersonate-service-account="$GCP_WIF_SA" \
 --audiences="$service_url" 2>/tmp/jscc-p4-staged-auth-error)" || exit 86
[[ "$id_token" =~ ^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$ ]] || exit 86
curl -fsS --connect-timeout 10 --max-time 30 -H "Authorization: Bearer $id_token" \
 "$tag_url/health" >/tmp/jscc-p4-tagged-health.json
curl -fsS --connect-timeout 10 --max-time 30 -H "Authorization: Bearer $id_token" \
 "$tag_url/health/db" >/tmp/jscc-p4-tagged-db.json
python3 - "$target" <<'PY'
import json,sys
h=json.load(open('/tmp/jscc-p4-tagged-health.json',encoding='utf8'))
d=json.load(open('/tmp/jscc-p4-tagged-db.json',encoding='utf8'))
sha=sys.argv[1]
assert h.get('status')=='ok' and h.get('environment')=='dev'
assert h.get('source_sha')==sha and h.get('runtime_data_sha')==sha
assert h.get('runtime_backend')=='gcp' and h.get('search_mode')=='disabled'
assert d.get('status')=='ok' and d.get('database')=='jobsearch_dev'
print('JSCC_P4_TAGGED_HEALTH_NILE=PASS')
PY

# Recheck the 0%-traffic staged state immediately before the cutover.
gcloud run services describe "$service" --project="$project" --region="$region" --format=json >/tmp/jscc-p4-precutover.json
python3 "$guard" stage /tmp/jscc-p4-before.json /tmp/jscc-p4-precutover.json >/tmp/jscc-p4-precutover-proof
grep -Fqx 'JSCC_P4_STAGED_CONFIG_PARITY=PASS' /tmp/jscc-p4-precutover-proof || exit 86
rollback(){
  echo JSCC_P4_ROLLBACK_ATTEMPTED
  if gcloud run services update-traffic "$service" --project="$project" --region="$region" \
    --to-revisions="$old_revision=100" --quiet >/tmp/jscc-p4-rollback-log 2>&1; then
    echo JSCC_P4_ROLLBACK_COMMAND=PASS
  else
    echo JSCC_P4_ROLLBACK_COMMAND=FAIL_MANUAL_RECOVERY_REQUIRED
  fi
}
trap 'rollback' ERR
gcloud run services update-traffic "$service" --project="$project" --region="$region" \
 --to-revisions="$revision=100" --quiet >/tmp/jscc-p4-cutover-log 2>&1
gcloud run services describe "$service" --project="$project" --region="$region" --format=json >/tmp/jscc-p4-final.json
python3 "$guard" final /tmp/jscc-p4-staged.json /tmp/jscc-p4-final.json "$revision"
curl -fsS --connect-timeout 10 --max-time 30 -H "Authorization: Bearer $id_token" \
 "$service_url/health" >/tmp/jscc-p4-final-health.json
curl -fsS --connect-timeout 10 --max-time 30 -H "Authorization: Bearer $id_token" \
 "$service_url/health/db" >/tmp/jscc-p4-final-db.json
python3 - "$target" <<'PY'
import json,sys
h=json.load(open('/tmp/jscc-p4-final-health.json',encoding='utf8'))
d=json.load(open('/tmp/jscc-p4-final-db.json',encoding='utf8'))
assert h.get('status')=='ok' and h.get('environment')=='dev'
assert h.get('source_sha')==sys.argv[1] and h.get('runtime_backend')=='gcp'
assert d.get('status')=='ok' and d.get('database')=='jobsearch_dev'
print('JSCC_P4_POST_CUTOVER_HEALTH_DB=PASS')
PY
trap - ERR
unset id_token
echo "JSCC_P4_675_DEV_TECHNICAL_DEPLOY_PASS sha=$target revision=$revision digest=$digest"
echo JSCC_P4_REAL_USER_FUNCTIONAL_ACCEPTANCE=PENDING
