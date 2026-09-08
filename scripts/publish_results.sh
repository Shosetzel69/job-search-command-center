#!/usr/bin/env bash
set -euo pipefail

remote="${PUBLISH_REMOTE:-origin}"
branch="${PUBLISH_BRANCH:-main}"
max_attempts="${PUBLISH_MAX_ATTEMPTS:-3}"
sleep_base="${PUBLISH_RETRY_SLEEP_BASE:-2}"
files=(
  data/jobs.json
  data/run-status.json
  data/run-history.json
  data/search-state.json
)

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

for file in "${files[@]}"; do
  if [ ! -f "$file" ]; then
    echo "Missing generated publication file: $file" >&2
    exit 1
  fi
  mkdir -p "$tmpdir/$(dirname "$file")"
  cp "$file" "$tmpdir/$file"
done

git config user.name "job-search-automation"
git config user.email "actions@users.noreply.github.com"

published=false
for attempt in $(seq 1 "$max_attempts"); do
  echo "Publish attempt $attempt/$max_attempts"
  git fetch "$remote" "$branch"
  git reset --hard "$remote/$branch"

  for file in "${files[@]}"; do
    cp "$tmpdir/$file" "$file"
  done
  git add "${files[@]}"

  if git diff --cached --quiet; then
    echo "No data change"
    published=true
    break
  fi

  git commit -m "Update job search results"
  if git push "$remote" "HEAD:$branch"; then
    published=true
    break
  fi

  echo "Main changed during publication; retrying from latest main"
  sleep $((attempt * sleep_base))
done

if [ "$published" != "true" ]; then
  echo "Could not publish generated data after $max_attempts attempts" >&2
  exit 1
fi
