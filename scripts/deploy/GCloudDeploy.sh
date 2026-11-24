#!/usr/bin/env bash
# Run only in an owner-authenticated GCP Cloud Shell; never from GitHub Actions.
set -euo pipefail
sha="${1:-}"
tag="${2:-}"
operation="${3:-preflight}"
[[ "$sha" =~ ^[0-9a-f]{40}$ && "$tag" =~ ^jscc-dev-v[0-9]+\.[0-9]+\.[0-9]+$ ]] || {
  echo 'Usage: bash scripts/deploy/GCloudDeploy.sh <40-char-SHA> <jscc-dev-vX.Y.Z> [preflight|deploy]'
  exit 86
}
[[ "$operation" == preflight || "$operation" == deploy ]] || exit 86
[[ -z "${GITHUB_ACTIONS:-}" ]] || { echo JSCC_CLOUD_DEPLOY_NO_ACTIONS_RUNNER; exit 86; }
[[ "${CLOUD_SHELL:-}" == true || -n "${DEVSHELL_PROJECT_ID:-}" ]] || {
  echo JSCC_CLOUD_DEPLOY_REQUIRES_CLOUD_SHELL; exit 86;
}
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
[[ "$(git -C "$root" rev-parse --abbrev-ref HEAD)" == main ]] || exit 86
[[ -z "$(git -C "$root" status --porcelain)" ]] || { echo JSCC_CLOUD_DEPLOY_UNCLEAN_MAIN; exit 86; }
git -C "$root" fetch origin main --tags --quiet
[[ "$(git -C "$root" rev-parse main)" == "$(git -C "$root" rev-parse origin/main)" ]] || {
  echo JSCC_CLOUD_DEPLOY_MAIN_NOT_CURRENT; exit 86;
}
[[ "$(git -C "$root" rev-parse "refs/tags/$tag^{commit}")" == "$sha" ]] || exit 86
# Always use a detached candidate worktree; do not run candidate-provided scripts.
candidate_tmp="$(mktemp -d)"
cleanup(){ git -C "$root" worktree remove --force "$candidate_tmp/candidate" >/dev/null 2>&1 || true; rm -rf "$candidate_tmp"; }
trap cleanup EXIT INT TERM
git -C "$root" worktree add --detach "$candidate_tmp/candidate" "$sha" >/dev/null
export JSCC_CLOUDSHELL_ADMITTED=true
bash "$root/scripts/deploy/jscc-dev-service.sh" \
  preflight "$sha" "$tag" "$root" "$candidate_tmp/candidate" cloudshell
if [[ "$operation" == preflight ]]; then exit 0; fi
echo "Release: $tag | Candidate: $sha | GCP: jscc-dev | Service: jscc-command-api-dev"
echo 'To authorize a DEV service-only deployment type the exact confirmation below:'
echo "DEPLOY DEV $sha"
IFS= read -r confirmation
[[ "$confirmation" == "DEPLOY DEV $sha" ]] || { echo JSCC_CLOUD_DEPLOY_NOT_APPROVED; exit 86; }
bash "$root/scripts/deploy/jscc-dev-service.sh" \
  deploy "$sha" "$tag" "$root" "$candidate_tmp/candidate" cloudshell
