#!/usr/bin/env bash
# Read-only extraction of exact DEV R33 gateway source into an existing, bounded
# DEV workspace prefix. Does NOT deploy, change IAM or modify Cloud Run traffic.
set -Eeuo pipefail
IMAGE='europe-west1-docker.pkg.dev/jscc-shared/jscc-ops/jscc-ops-gateway-dev-r33@sha256:ac0c7843807921c466135bd039d34d50ab62cec2dcf70ba0667e950310ea7cbf'
BUCKET='gs://jscc-dev-workspace-828902654738'
PREFIX='workspace/v3/gateway-r33-589'
[[ "$(gcloud config get-value project 2>/dev/null)" == "jscc-dev" ]] || {
  echo "REQUIRES_PROJECT=jscc-dev" >&2; exit 2;
}
tmp="$(mktemp -d)"
cid=''
cleanup() {
  [[ -z "$cid" ]] || docker rm "$cid" >/dev/null 2>&1 || true
  rm -rf "$tmp"
}
trap cleanup EXIT
command -v docker >/dev/null
command -v gcloud >/dev/null
gcloud auth configure-docker europe-west1-docker.pkg.dev --quiet >/dev/null
docker pull "$IMAGE" >/dev/null
docker image inspect "$IMAGE" >/dev/null
cid="$(docker create "$IMAGE")"
for root in /workspace/ops /app/ops /ops; do
  if docker cp "$cid:$root" "$tmp/ops" >/dev/null 2>&1; then
    [[ -f "$tmp/ops/src/gateway.mjs" && -f "$tmp/ops/src/dev_workspace.mjs" ]] && break
    rm -rf "$tmp/ops"
  fi
done
[[ -f "$tmp/ops/src/gateway.mjs" && -f "$tmp/ops/src/dev_workspace.mjs" ]] || {
  echo 'BLOCKED: gateway source layout not found in exact image' >&2; exit 4;
}
shopt -s nullglob
files=("$tmp"/ops/src/*.mjs)
(( ${#files[@]} >= 2 && ${#files[@]} <= 15 )) || {
  echo 'BLOCKED: unexpected JS module count' >&2; exit 4;
}
for file in "${files[@]}"; do
  [[ -f "$file" && ! -L "$file" ]] || exit 4
  (( $(wc -c < "$file") <= 131072 )) || {
    echo "BLOCKED: file exceeds 128 KiB: $file" >&2; exit 4;
  }
done
echo '=== CAPTURED SOURCE INVENTORY ==='
for file in "${files[@]}"; do
  name="$(basename "$file")"
  hash="$(sha256sum "$file" | awk '{print $1}')"
  target="$BUCKET/$PREFIX/ops/src/$name"
  # Do not overwrite existing evidence. Upload with create-only precondition.
  if gcloud storage ls "$target" >/dev/null 2>&1; then
    echo "BLOCKED: object already exists: $target" >&2
    exit 5
  fi
  echo "SOURCE_SHA256 $name $hash"
done
# Source capture is intentional workspace write; run only for ATC-589-R1-01.
for file in "${files[@]}"; do
  target="$BUCKET/$PREFIX/ops/src/$(basename "$file")"
  gcloud storage cp --if-generation-match=0 "$file" "$target" >/dev/null
done
echo "R33_SOURCE_CAPTURED: ${#files[@]} modules / $PREFIX"
