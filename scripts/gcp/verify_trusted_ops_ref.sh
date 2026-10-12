#!/usr/bin/env bash
set -euo pipefail

SOURCE_SHA="${SOURCE_SHA:?SOURCE_SHA required}"
TRUSTED_OPS_REF="${TRUSTED_OPS_REF:?TRUSTED_OPS_REF required}"
OPS_SOURCE_URL="${OPS_SOURCE_URL:-https://github.com/Shosetzel69/job-search-command-center.git}"

[[ "$SOURCE_SHA" =~ ^[0-9a-f]{40}$ ]] || {
  echo "TRUSTED_OPS_SOURCE=BLOCKED invalid_source_sha" >&2
  exit 42
}

case "$TRUSTED_OPS_REF" in
  refs/heads/main|refs/tags/jscc-ops-approved/*) ;;
  *)
    echo "TRUSTED_OPS_SOURCE=BLOCKED invalid_trusted_ref" >&2
    exit 42
    ;;
esac

REMOTE_SHA="$(git ls-remote "$OPS_SOURCE_URL" "$TRUSTED_OPS_REF" | awk 'NR==1 {print $1}')"
[[ -n "$REMOTE_SHA" && "$REMOTE_SHA" == "$SOURCE_SHA" ]] || {
  echo "TRUSTED_OPS_SOURCE=BLOCKED ref_sha_mismatch" >&2
  exit 42
}

echo "TRUSTED_OPS_SOURCE=PASS"
