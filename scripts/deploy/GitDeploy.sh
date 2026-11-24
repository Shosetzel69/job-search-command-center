#!/usr/bin/env bash
# Invoked by .github/workflows/GitDeploy.yml after protected DEV approval.
set -euo pipefail
mode="${1:-}"; sha="${2:-}"; release_tag="${3:-}"
[[ "$mode" == preflight || "$mode" == deploy ]] || exit 86
[[ "${GITHUB_EVENT_NAME:-}" == workflow_dispatch && "${GITHUB_REF:-}" == refs/heads/main ]] || exit 86
[[ "${JSCC_GITDEPLOY_ADMITTED:-}" == true ]] || exit 86
[[ "${GCP_WIF_SA:-}" == jscc-app-deployer-dev@jscc-dev.iam.gserviceaccount.com ]] || exit 86
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
control="${JSCC_CONTROL_DIR:-$root}"
candidate="${JSCC_CANDIDATE_DIR:-}"
[[ -d "$control/.git" && -d "$candidate/.git" ]] || exit 86
exec bash "$control/scripts/deploy/jscc-dev-service.sh" \
  "$mode" "$sha" "$release_tag" "$control" "$candidate" github
