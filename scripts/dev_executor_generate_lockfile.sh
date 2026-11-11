#!/usr/bin/env bash
set -euo pipefail
# Run from a clean checkout of dev/537-executor-lockfile with npm registry access.
test "$(git branch --show-current)" = "dev/537-executor-lockfile"
test -z "$(git status --porcelain)"
test -f ops/package.json
test ! -e ops/package-lock.json
npm --prefix ops install --package-lock-only --ignore-scripts --no-audit --no-fund
npm --prefix ops ci --ignore-scripts --no-audit --no-fund
npm --prefix ops run check
npm --prefix ops test
git add ops/package-lock.json
git diff --cached --name-only | grep -qx 'ops/package-lock.json'
git diff --cached --name-only | wc -l | grep -qx '1'
echo "LOCKFILE_VALIDATED=$(sha256sum ops/package-lock.json | awk '{print $1}')"
echo "Review ops/package-lock.json and create a PR; do not merge without review."
