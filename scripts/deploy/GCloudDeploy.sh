#!/usr/bin/env bash
# Run only in an owner-authenticated GCP Cloud Shell; never from GitHub Actions.
set -euo pipefail
sha="${1:-}"
operation="${2:-preflight}"
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || {
  echo 'Usage: bash scripts/deploy/GCloudDeploy.sh <40-char-SHA> [preflight|deploy]'
  exit 86
}
[[ "$operation" == preflight || "$operation" == deploy ]] || exit 86
# TTY confirmation is an operator-safety check, not a security boundary.
# Effective service account impersonation rights are the GCP authorization gate.
if [[ "$operation" == deploy ]]; then
  [[ -t 0 && -t 1 && -r /dev/tty ]] || {
    echo JSCC_CLOUD_DEPLOY_INTERACTIVE_TTY_REQUIRED
    exit 86
  }
fi
active_identity="$(gcloud auth list --filter='status:ACTIVE' --format='value(account)' 2>/dev/null)" || exit 86
[[ "$active_identity" =~ ^[^[:space:]@]+@[^[:space:]@]+$ &&
   "$active_identity" != *".gserviceaccount.com" &&
   "$active_identity" != jscc-app-deployer-dev@jscc-dev.iam.gserviceaccount.com ]] || {
  echo JSCC_CLOUD_DEPLOY_HUMAN_GCLOUD_SESSION_REQUIRED
  exit 86
}
[[ -z "${GITHUB_ACTIONS:-}" ]] || { echo JSCC_CLOUD_DEPLOY_NO_ACTIONS_RUNNER; exit 86; }
[[ "${CLOUD_SHELL:-}" == true || -n "${DEVSHELL_PROJECT_ID:-}" ]] || {
  echo JSCC_CLOUD_DEPLOY_REQUIRES_CLOUD_SHELL; exit 86;
}
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
[[ "$(git -C "$root" rev-parse --abbrev-ref HEAD)" == main ]] || exit 86
[[ -z "$(git -C "$root" status --porcelain)" ]] || { echo JSCC_CLOUD_DEPLOY_UNCLEAN_MAIN; exit 86; }
git -C "$root" fetch origin main --quiet
[[ "$(git -C "$root" rev-parse main)" == "$(git -C "$root" rev-parse origin/main)" ]] || {
  echo JSCC_CLOUD_DEPLOY_MAIN_NOT_CURRENT; exit 86;
}
git -C "$root" merge-base --is-ancestor "$sha" main || { echo JSCC_MANUAL_SHA_NOT_ON_MAIN; exit 86; }
# Always use a detached candidate worktree; do not run candidate-provided scripts.
candidate_tmp="$(mktemp -d)"
cleanup(){ git -C "$root" worktree remove --force "$candidate_tmp/candidate" >/dev/null 2>&1 || true; rm -rf "$candidate_tmp"; }
trap cleanup EXIT INT TERM
git -C "$root" worktree add --detach "$candidate_tmp/candidate" "$sha" >/dev/null
export JSCC_CLOUDSHELL_ADMITTED=true
bash "$root/scripts/deploy/jscc-dev-service.sh" \
  preflight "$sha" "$root" "$candidate_tmp/candidate" cloudshell
if [[ "$operation" == preflight ]]; then exit 0; fi
echo "Candidate: $sha | GCP: jscc-dev | Service: jscc-command-api-dev"
echo 'To authorize a DEV service-only deployment type the exact confirmation below:'
echo "DEPLOY DEV $sha"
IFS= read -r confirmation </dev/tty
[[ "$confirmation" == "DEPLOY DEV $sha" ]] || { echo JSCC_CLOUD_DEPLOY_NOT_APPROVED; exit 86; }
bash "$root/scripts/deploy/jscc-dev-service.sh" \
  deploy "$sha" "$root" "$candidate_tmp/candidate" cloudshell
