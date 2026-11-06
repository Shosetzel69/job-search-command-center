#!/usr/bin/env bash
# #589 ATC-589-R1-01 — Import pinned, already captured R33 source for review.
# Reads source archive from the existing shared build bucket; writes only 4
# verified source modules to an isolated DEV workspace prefix (create-only).
set -Eeuo pipefail
ARCHIVE=gs://jscc-shared-ops-cloudbuild-source/r33/jscc589-r33-sources.tar.gz
DEST=gs://jscc-dev-workspace-828902654738/workspace/v3/gateway-r33-589/ops/src
[[ "$(gcloud config get-value project 2>/dev/null)" == "jscc-dev" ]] || { echo 'BLOCKED: expected jscc-dev'; exit 2; }
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
gcloud storage cp "$ARCHIVE" "$tmp/source.tar.gz" >/dev/null
python3 - "$tmp/source.tar.gz" "$tmp" <<'PY'
import hashlib, io, os, pathlib, sys, tarfile
archive, target = sys.argv[1:]
expected = {
 "src/dev_workspace.mjs": "26fa91c6400b8955d441abc28cc8b3bc76baec0ac2cf559d2c15459b0cd541c3",
 "src/gateway.mjs": "30f67b013e22d358cfdfe5081f07f4625d01ac5638f0342ba760d57994f30813",
 "src/lib.mjs": "a4a843937a91131e480ca2b5524a28f1780c2952d2013475e95c4b06d24e4d0a",
 "src/worker.mjs": "64f3f61039a5d8273bb9947ca6fade2717e812b8f373ceec5df15879698ad745",
}
image_digest = "sha256:ac0c7843807921c466135bd039d34d50ab62cec2dcf70ba0667e950310ea7cbf"
with tarfile.open(archive, "r:gz") as tf:
    entries = {m.name.removeprefix("./"): m for m in tf.getmembers() if m.isfile()}
    if set(entries) != set(expected) | {"IMAGE_DIGEST"}:
        raise SystemExit(f"BLOCKED: unexpected archive file inventory: {sorted(entries)}")
    digest = tf.extractfile(entries["IMAGE_DIGEST"]).read().decode().strip()
    if digest != image_digest: raise SystemExit("BLOCKED: image digest does not match R33")
    for name, sha in expected.items():
        obj = entries[name]
        if not obj.isfile() or obj.size > 131072: raise SystemExit("BLOCKED: invalid source file")
        data = tf.extractfile(obj).read()
        if hashlib.sha256(data).hexdigest() != sha: raise SystemExit(f"BLOCKED: sha mismatch: {name}")
        outfile = pathlib.Path(target) / name.rsplit("/", 1)[1]
        outfile.write_bytes(data)
        print(f"VERIFIED {outfile.name} {sha}")
PY
# Fail before any write if a previous import may exist.
for name in dev_workspace.mjs gateway.mjs lib.mjs worker.mjs; do
  if gcloud storage ls "$DEST/$name" >/dev/null 2>&1; then
    echo "BLOCKED: destination exists, will not overwrite: $name" >&2
    exit 3
  fi
done
for name in dev_workspace.mjs gateway.mjs lib.mjs worker.mjs; do
  gcloud storage cp --if-generation-match=0 "$tmp/$name" "$DEST/$name" >/dev/null
done
echo 'R33_DEV_WORKSPACE_IMPORT_PASS'
