#!/usr/bin/env python3
"""Pin DEV source registry to the generation signed by Retrieve.

No provider calls and no GCS mutations. If the registry changed between API
signature and Job startup, abort BEFORE invoking the collector.
"""
from __future__ import annotations

import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

GENERATION = re.compile(r"(?:0|[1-9][0-9]*)\Z")
MAX_BYTES = 2 * 1024 * 1024
METADATA_TOKEN = "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token"
SOURCE_OBJECT = "seed/sources.json"


def validate_catalog(payload: object, source_scope: dict | None = None) -> dict:
    if (not isinstance(payload, dict) or payload.get("schema_version") != "1.0"
            or not isinstance(payload.get("sources"), list)):
        raise ValueError("DEV source snapshot has invalid catalog schema")
    rows = payload["sources"]
    ids = [str(row.get("id") or "").strip() for row in rows if isinstance(row, dict)]
    if len(ids) != len(rows) or not all(ids) or len(set(ids)) != len(ids):
        raise ValueError("DEV source snapshot contains duplicate/invalid IDs")
    if source_scope is not None:
        requested = source_scope.get("effective_source_ids")
        if not isinstance(requested, list) or any(not isinstance(x, str) or not x.strip() for x in requested):
            raise ValueError("Bounded Retrieve missing explicit source IDs")
        # This implements the same effective-ID policy as JS retrieve-scope.js.
        active = sorted(row["id"] for row in rows
                        if row.get("active") is True
                        and row.get("policy_excluded") is not True
                        and str(row.get("name") or "").strip().lower() != "monster")
        if sorted(requested) != active:
            raise ValueError("Signed source IDs disagree with pinned DEV registry")
    return payload


def source_snapshot(expected: str | None, metadata, media, fallback, scope=None) -> tuple[str, dict]:
    if expected is not None and not GENERATION.fullmatch(expected):
        raise ValueError("Invalid signed DEV source generation")
    descriptor = metadata()
    if descriptor is not None:
        if not isinstance(descriptor, dict):
            raise ValueError("Invalid DEV source registry metadata")
        actual = str(descriptor.get("generation") or "")
        if not re.fullmatch(r"[1-9][0-9]*", actual):
            raise ValueError("Invalid GCS source registry generation")
    else:
        actual = "0"
    if expected is not None and actual != expected:
        raise RuntimeError("DEV source catalog generation changed after Retrieve signing")
    snapshot = fallback() if actual == "0" else media(actual)
    return actual, validate_catalog(snapshot, scope)


def cloud_reader(bucket: str):
    if not re.fullmatch(r"jscc-dev-[a-z0-9-]{1,60}", bucket):
        raise ValueError("DEV GCS runtime bucket must be jscc-dev owned")
    with urllib.request.urlopen(urllib.request.Request(
            METADATA_TOKEN, headers={"Metadata-Flavor": "Google"}), timeout=15) as response:
        token = json.load(response).get("access_token")
    if not isinstance(token, str) or not token:
        raise RuntimeError("Cloud metadata token unavailable")
    base = ("https://storage.googleapis.com/storage/v1/b/"
            + urllib.parse.quote(bucket, safe="") + "/o/"
            + urllib.parse.quote(SOURCE_OBJECT, safe=""))
    headers = {"Authorization": "Bearer " + token}

    def get_json(url):
        with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=20) as response:
            data = response.read(MAX_BYTES + 1)
            if len(data) > MAX_BYTES:
                raise ValueError("DEV source snapshot exceeds size bound")
            return json.loads(data)

    def metadata():
        try:
            return get_json(base)
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                return None
            raise

    def media(generation):
        # Version-specific GET prevents a mutation between metadata and download
        # from silently swapping the source content. Nonversioned old data -> 404.
        return get_json(base + "?alt=media&generation=" + urllib.parse.quote(generation, safe=""))

    return metadata, media


def main():
    if len(sys.argv) != 2 or os.environ.get("APP_ENV") != "dev":
        raise RuntimeError("DEV source snapshot accepts one output path in DEV only")
    source_sha = os.environ.get("SOURCE_SHA")
    image_sha = os.environ.get("JSCC_JOB_BUILD_SHA")
    if (not source_sha or not image_sha
            or not re.fullmatch(r"[0-9a-f]{40}", source_sha)
            or source_sha != image_sha):
        raise RuntimeError("Cloud Run Job image must match exact signed service SOURCE_SHA")
    raw_scope = os.environ.get("JSCC_RETRIEVE_SCOPE_JSON", "")
    scope = json.loads(raw_scope) if raw_scope else None
    scope = scope if scope and scope.get("scopes") else None
    expected = os.environ.get("JSCC_SOURCE_CATALOG_GENERATION", "").strip() or None
    if scope is not None:
        signed = scope.get("source_catalog_generation")
        if not isinstance(signed, str) or signed != expected:
            raise RuntimeError("Bounded Retrieve must carry same signed source generation to Job")
    bucket = os.environ.get("GCP_RUNTIME_BUCKET", "")
    metadata, media = cloud_reader(bucket)
    generation, payload = source_snapshot(
        expected, metadata, media,
        lambda: json.loads((Path(__file__).resolve().parents[1] / "data/sources.json").read_text(encoding="utf-8")),
        scope,
    )
    output = Path(sys.argv[1])
    if not output.parent.is_dir() or output.exists():
        raise RuntimeError("DEV per-run snapshot target must be new inside an existing directory")
    with output.open("x", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False)
        handle.write("\n")
    print(f"JSCC585_SOURCE_SNAPSHOT_PINNED_GENERATION={generation}")


if __name__ == "__main__":
    main()
