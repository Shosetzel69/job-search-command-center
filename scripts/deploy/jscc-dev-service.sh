#!/usr/bin/env bash
# Shared DEV Service-only deployment. No Nile migrations, Search Job, IAM, TEST or PROD.
set -euo pipefail
mode="${1:-}"; sha="${2:-}"; tag_name="${3:-}"; control="${4:-}"; candidate="${5:-}"; channel="${6:-}"
[[ "$mode" == preflight || "$mode" == deploy ]] || exit 86
[[ "$sha" =~ ^[a-f0-9]{40}$ && "$tag_name" =~ ^jscc-dev-v[0-9]+\.[0-9]+\.[0-9]+$ ]] || exit 86
[[ "$channel" == github || "$channel" == cloudshell ]] || exit 86
[[ -f "$control/scripts/deploy/jscc_deploy_guard.py" && -f "$control/cloudbuild.531.dev-service.yaml" ]] || exit 86
[[ "$(git -C "$candidate" rev-parse HEAD)" == "$sha" ]] || exit 86
[[ -z "$(git -C "$candidate" status --porcelain)" ]] || exit 86
git -C "$control" merge-base --is-ancestor "$sha" HEAD || { echo JSCC_DEPLOY_SOURCE_NOT_ON_MAIN; exit 86; }
[[ "$(git -C "$control" rev-parse "refs/tags/$tag_name^{commit}")" == "$sha" ]] || exit 86
[[ "$(git -C "$control" remote get-url origin)" =~ ^(https://github[.]com/|git@github[.]com:)Shosetzel69/job-search-command-center([.]git)?$ ]] || { echo JSCC_DEPLOY_UNTRUSTED_REPOSITORY_ORIGIN; exit 86; }
deployer=jscc-app-deployer-dev@jscc-dev.iam.gserviceaccount.com
if [[ "$channel" == github ]]; then
  [[ "${GITHUB_EVENT_NAME:-}" == workflow_dispatch && "${GITHUB_REF:-}" == refs/heads/main &&
      "${JSCC_GITDEPLOY_ADMITTED:-}" == true && "${GCP_WIF_SA:-}" == "$deployer" ]] || exit 86
else
  [[ "${JSCC_CLOUDSHELL_ADMITTED:-}" == true ]] || exit 86
fi
gcp(){
  if [[ "$channel" == cloudshell ]]; then
    gcloud --impersonate-service-account="$deployer" "$@"
  else
    gcloud "$@"
  fi
}
region=europe-west1; project=jscc-dev; shared=jscc-shared; service=jscc-command-api-dev
image_repo=europe-west1-docker.pkg.dev/jscc-shared/jscc/jscc-service
tag="gd${sha:0:10}"
guard="$control/scripts/deploy/jscc_deploy_guard.py"
umask 077
work="$(mktemp -d)"
stage_attempted=0; cutover_attempted=0; old_rev=""; staged_rev=""; digest=""
recover(){
  local rc="$?"
  trap - EXIT INT TERM
  if ((rc!=0)) && ((cutover_attempted==1)); then
    echo JSCC_DEPLOY_ROLLBACK_ATTEMPTED
    if gcp run services describe "$service" --project="$project" --region="$region" --format=json >"$work/recover.json"; then
      current="$(python3 "$guard" serving "$work/recover.json" 2>/dev/null || true)"
      if [[ "$current" == "$staged_rev" || "$current" == "$old_rev" ]]; then
        if gcp run services update-traffic "$service" --project="$project" --region="$region" \
          --to-revisions="$old_rev=100" --quiet >"$work/rollback.log" 2>&1; then
          if gcp run services describe "$service" --project="$project" --region="$region" --format=json >"$work/rolled.json"; then
            python3 "$guard" rollback "$work/before.json" "$work/rolled.json" "$sha" "$tag" ||
              echo JSCC_DEPLOY_ROLLBACK_REQUIRES_MANUAL_RECOVERY
          fi
        else
          echo JSCC_DEPLOY_ROLLBACK_COMMAND_FAILED
        fi
      else
        echo JSCC_DEPLOY_CONCURRENT_CHANGE_NO_FORCE_ROLLBACK
      fi
    fi
  fi
  if ((rc!=0)) && ((stage_attempted==1)) && [[ -z "$staged_rev" || -z "$digest" ]]; then
    echo JSCC_DEPLOY_STAGE_CLEANUP_MANUAL_RECOVERY_REQUIRED
  fi
  if ((rc!=0)) && ((stage_attempted==1)) && [[ -n "$staged_rev" && -n "$digest" ]]; then
    if gcp run services describe "$service" --project="$project" --region="$region" --format=json >"$work/tag.json" &&
       staged_digest="$(gcp run revisions describe "$staged_rev" --project="$project" --region="$region" --format='value(status.imageDigest)')" &&
       [[ "${staged_digest##*@}" == "$digest" ]] &&
       python3 "$guard" cleanup-tag "$work/tag.json" "$sha" "$tag" "$digest" "$staged_rev" >/dev/null; then
      gcp run services update-traffic "$service" --project="$project" --region="$region" \
        --remove-tags="$tag" --quiet >"$work/tag-cleanup.log" 2>&1 ||
        echo JSCC_DEPLOY_TAG_CLEANUP_FAILED
    fi
  fi
  rm -rf "$work"
  exit "$rc"
}
trap recover EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
github_api(){
  local url="$1" output="$2"
  if [[ -n "${GH_TOKEN:-${GITHUB_TOKEN:-}}" ]]; then
    curl -fsS --connect-timeout 10 --max-time 30 -H 'Accept: application/vnd.github+json' \
      -H "Authorization: Bearer ${GH_TOKEN:-${GITHUB_TOKEN}}" "$url" >"$output"
  else
    curl -fsS --connect-timeout 10 --max-time 30 -H 'Accept: application/vnd.github+json' "$url" >"$output"
  fi
}
api=https://api.github.com/repos/Shosetzel69/job-search-command-center
github_api "$api/releases/tags/$tag_name" "$work/release.json"
python3 "$guard" release "$work/release.json" "$sha" "$tag_name"
python3 "$guard" fetch-ci "$sha" "$work/checks.json"
immutable="$(gcp artifacts repositories describe jscc --project="$shared" \
 --location="$region" --format='value(dockerConfig.immutableTags)')"
[[ "$immutable" == True || "$immutable" == true ]] || { echo JSCC_DEPLOY_REGISTRY_NOT_IMMUTABLE; exit 86; }
gcp run services describe "$service" --project="$project" --region="$region" \
 --format=json >"$work/before.json"
old_rev="$(python3 "$guard" baseline "$work/before.json" "$sha" "$tag" |
  sed -n 's/^JSCC_DEPLOY_BASELINE_REVISION=//p')"
[[ "$old_rev" =~ ^jscc-command-api-dev-[a-z0-9-]+$ ]] || exit 86
old_digest="$(gcp run revisions describe "$old_rev" --project="$project" --region="$region" --format='value(status.imageDigest)')"
old_digest="${old_digest##*@}"
[[ "$old_digest" =~ ^sha256:[a-f0-9]{64}$ ]] || exit 86
service_url="$(gcp run services describe "$service" --project="$project" --region="$region" --format='value(status.url)')"
[[ "$service_url" =~ ^https://[a-z0-9-]+(\.a)?\.run\.app$ ]] || exit 86
token="$(gcloud auth print-identity-token --impersonate-service-account="$deployer" \
  --audiences="$service_url" 2>"$work/token-error")" || { echo JSCC_DEPLOY_HEALTH_AUTH_DENIED; exit 86; }
[[ "$token" =~ ^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$ ]] || exit 86
curl -fsS --connect-timeout 10 --max-time 30 -H "Authorization: Bearer $token" \
  "$service_url/health" >"$work/old-health.json"
python3 "$guard" health "$work/old-health.json" baseline "$sha"
unset token
echo "JSCC_DEPLOY_PREFLIGHT_PASS sha=$sha old_rev=$old_rev digest=$old_digest"
if [[ "$mode" == preflight ]]; then
  echo JSCC_DEPLOY_PREFLIGHT_NO_MUTATION
  exit 0
fi

image_tag="$image_repo:$sha"
if gcp artifacts docker images describe "$image_tag" --project="$shared" \
 --format='value(image_summary.digest)' >"$work/digest" 2>"$work/image-lookup-error"; then
  digest="$(cat "$work/digest")"
else
  grep -Eiq '(not found|NOT_FOUND|404)' "$work/image-lookup-error" || {
    echo JSCC_DEPLOY_IMAGE_LOOKUP_UNVERIFIED; exit 86;
  }
  echo JSCC_DEPLOY_CLOUD_BUILD_SERVICE_ONLY
  gcp builds submit "$candidate" --project="$shared" --region="$region" \
    --config="$control/cloudbuild.531.dev-service.yaml" --substitutions="_GIT_SHA=$sha" --quiet
  digest="$(gcp artifacts docker images describe "$image_tag" --project="$shared" \
    --format='value(image_summary.digest)')"
fi
[[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]] || exit 86
gcp builds list --project="$shared" --region="$region" --filter='status=SUCCESS' \
 --limit=200 --format=json >"$work/builds.json"
python3 "$guard" attest "$work/builds.json" "$sha" "$digest"

gcp run services describe "$service" --project="$project" --region="$region" \
 --format=json >"$work/prestage.json"
python3 "$guard" unchanged "$work/before.json" "$work/prestage.json" "$sha" "$tag"
rev_digest="$(gcp run revisions describe "$old_rev" --project="$project" --region="$region" --format='value(status.imageDigest)')"
[[ "${rev_digest##*@}" == "$old_digest" ]] || exit 86
# The failure handler is active before creating a staged revision.
stage_attempted=1
gcp run services update "$service" --project="$project" --region="$region" \
  --image="$image_repo@$digest" --update-env-vars="SOURCE_SHA=$sha,RUNTIME_DATA_SHA=$sha" \
  --tag="$tag" --no-traffic --quiet >"$work/staging.log" 2>&1 || {
  echo JSCC_DEPLOY_STAGE_FAILED; exit 86;
}
gcp run services describe "$service" --project="$project" --region="$region" \
 --format=json >"$work/staged.json"
proof="$(python3 "$guard" stage "$work/before.json" "$work/staged.json" "$sha" "$tag")"
grep -Fxq JSCC_DEPLOY_STAGE_CONFIG_PARITY=PASS <<<"$proof" || exit 86
staged_rev="$(sed -n 's/^JSCC_DEPLOY_STAGE_REVISION=//p' <<<"$proof")"
tag_url="$(sed -n 's/^JSCC_DEPLOY_STAGE_URL=//p' <<<"$proof")"
[[ "$staged_rev" =~ ^jscc-command-api-dev-[a-z0-9-]+$ ]] || exit 86
[[ "$tag_url" =~ ^https://[a-z0-9-]+(\.a)?\.run\.app$ ]] || exit 86
staged_digest="$(gcp run revisions describe "$staged_rev" --project="$project" --region="$region" --format='value(status.imageDigest)')"
[[ "${staged_digest##*@}" == "$digest" ]] || exit 86
token="$(gcloud auth print-identity-token --impersonate-service-account="$deployer" \
 --audiences="$service_url" 2>"$work/staged-auth-error")" || exit 86
curl -fsS --connect-timeout 10 --max-time 30 -H "Authorization: Bearer $token" "$tag_url/health" >"$work/stage-health.json"
curl -fsS --connect-timeout 10 --max-time 30 -H "Authorization: Bearer $token" "$tag_url/health/db" >"$work/stage-db.json"
python3 "$guard" health "$work/stage-health.json" staged "$sha"
python3 "$guard" db "$work/stage-db.json"
gcp run services describe "$service" --project="$project" --region="$region" \
 --format=json >"$work/precutover.json"
python3 "$guard" stage "$work/before.json" "$work/precutover.json" "$sha" "$tag" >/dev/null
cutover_attempted=1
gcp run services update-traffic "$service" --project="$project" --region="$region" \
 --to-revisions="$staged_rev=100" --quiet >"$work/cutover.log" 2>&1
gcp run services describe "$service" --project="$project" --region="$region" \
 --format=json >"$work/final.json"
python3 "$guard" final "$work/before.json" "$work/final.json" "$sha" "$tag" "$staged_rev"
curl -fsS --connect-timeout 10 --max-time 30 -H "Authorization: Bearer $token" "$service_url/health" >"$work/final-health.json"
curl -fsS --connect-timeout 10 --max-time 30 -H "Authorization: Bearer $token" "$service_url/health/db" >"$work/final-db.json"
python3 "$guard" health "$work/final-health.json" staged "$sha"
python3 "$guard" db "$work/final-db.json"
unset token
echo "JSCC_DEV_TECHNICAL_DEPLOY_PASS channel=$channel sha=$sha revision=$staged_rev digest=$digest"
echo JSCC_DEV_FUNCTIONAL_ACCEPTANCE=PENDING
