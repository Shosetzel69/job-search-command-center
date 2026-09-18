#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GITLEAKS_BIN="${GITLEAKS_BIN:-gitleaks}"
CONFIG="${GITLEAKS_CONFIG:-$ROOT/.gitleaks.toml}"

command -v "$GITLEAKS_BIN" >/dev/null 2>&1 || {
  echo "gitleaks binary not found: $GITLEAKS_BIN" >&2
  exit 2
}

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

git -C "$tmp" init -q
git -C "$tmp" config user.name "gitleaks-selftest"
git -C "$tmp" config user.email "gitleaks-selftest@example.invalid"

# Synthetic, non-working credential. Build the detector prefix only at runtime so
# no PAT-shaped value is ever committed to the JSCC repository itself.
prefix='gh'
suffix='p_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'
printf 'token=%s%s\n' "$prefix" "$suffix" > "$tmp/fixture.txt"
git -C "$tmp" add fixture.txt
git -C "$tmp" commit -q -m "synthetic secret fixture"

set +e
"$GITLEAKS_BIN" git --config "$CONFIG" --redact --no-banner "$tmp" >"$tmp/scan.log" 2>&1
status=$?
set -e

if [[ "$status" -eq 0 ]]; then
  echo "Gitleaks self-test failed: synthetic secret was not detected" >&2
  exit 1
fi
if [[ "$status" -ne 1 ]]; then
  echo "Gitleaks self-test failed unexpectedly with exit code $status" >&2
  cat "$tmp/scan.log" >&2
  exit "$status"
fi

echo "Gitleaks self-test PASS: synthetic secret detection is fail-closed"
