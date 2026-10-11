#!/usr/bin/env bash
set -euo pipefail

SOURCE_SHA="${SOURCE_SHA:-$(git rev-parse HEAD)}"
TRUSTED_OPS_REF="${TRUSTED_OPS_REF:-}"
OPS_SOURCE_REMOTE="${OPS_SOURCE_REMOTE:-origin}"

[[ "$SOURCE_SHA" =~ ^[0-9a-f]{40}$ ]] || {
  echo "TRUSTED_OPS_SOURCE=BLOCKED invalid_source_sha" >&2
  exit 4
}

[[ -z "$(git status --porcelain)" ]] || {
  echo "TRUSTED_OPS_SOURCE=BLOCKED dirty_worktree" >&2
  exit 4
}

if [[ -z "$TRUSTED_OPS_REF" ]]; then
  MAIN_SHA="$(git ls-remote "$OPS_SOURCE_REMOTE" refs/heads/main | awk 'NR==1 {print $1}')"
  if [[ "$MAIN_SHA" == "$SOURCE_SHA" ]]; then
    TRUSTED_OPS_REF="refs/heads/main"
  else
    echo "TRUSTED_OPS_SOURCE=BLOCKED trusted_ref_required" >&2
    exit 4
  fi
fi

case "$TRUSTED_OPS_REF" in
  refs/heads/main|refs/tags/jscc-ops-approved/*) ;;
  *)
    echo "TRUSTED_OPS_SOURCE=BLOCKED invalid_trusted_ref" >&2
    exit 4
    ;;
esac

REMOTE_SHA="$(git ls-remote "$OPS_SOURCE_REMOTE" "$TRUSTED_OPS_REF" | awk 'NR==1 {print $1}')"
[[ -n "$REMOTE_SHA" && "$REMOTE_SHA" == "$SOURCE_SHA" ]] || {
  echo "TRUSTED_OPS_SOURCE=BLOCKED ref_sha_mismatch" >&2
  exit 4
}

echo "TRUSTED_OPS_SOURCE=PASS"
echo "TRUSTED_OPS_REF=$TRUSTED_OPS_REF"
echo "SOURCE_SHA=$SOURCE_SHA"
