#!/usr/bin/env python3
"""Deterministic seed/import for the ATC-275-03 shared corpus."""

from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

import shared_corpus_repository as repository


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    raw = args.input.read_bytes()
    payload = json.loads(raw)
    jobs = payload.get("jobs")
    if not isinstance(jobs, list):
        raise RuntimeError("input must contain a jobs array")

    run_id = "seed-" + hashlib.sha256(raw).hexdigest()[:20]
    now = datetime.now(timezone.utc)
    collection = [
        type("SeedResult", (), {
            "ok": True,
            "connector": "legacy-import",
            "records": jobs,
        })()
    ]
    result = repository.persist_collection(collection, [], run_id=run_id, now=now)
    print(json.dumps({"run_id": run_id, **result}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
