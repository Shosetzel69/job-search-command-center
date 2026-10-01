#!/usr/bin/env python3
"""JobsPipe collection through the official Apify Actor transport."""

from __future__ import annotations

import json
import math
import os
import sys
from datetime import datetime, timezone
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import job_search as engine
import job_search_optimized as optimized

ACTOR_ENDPOINT = "https://api.apify.com/v2/actors/jobspipe~jobspipe-job-search/run-sync-get-dataset-items?clean=true"


def current_job_count() -> int:
    try:
        current = json.loads(engine.JOBS_PATH.read_text(encoding="utf-8"))
        return len(current.get("jobs") or [])
    except Exception:
        return 0


def _post_actor(token: str, payload: dict[str, Any]) -> list[dict[str, Any]]:
    if not token:
        raise RuntimeError("APIFY_TOKEN is not configured")
    request = Request(
        ACTOR_ENDPOINT,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json", "User-Agent": "job-search-command-center/1.0"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=330) as response:
            body = response.read().decode("utf-8")
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:800]
        raise RuntimeError(f"Apify HTTP {exc.code}: {detail}") from exc
    except URLError as exc:
        raise RuntimeError(f"Apify network error: {exc.reason}") from exc
    output = json.loads(body)
    if isinstance(output, list):
        return [item for item in output if isinstance(item, dict)]
    if isinstance(output, dict) and isinstance(output.get("items"), list):
        return [item for item in output["items"] if isinstance(item, dict)]
    raise RuntimeError("Apify response does not contain a dataset item array")


def _query_specs(config: dict[str, Any]) -> list[tuple[str, dict[str, Any]]]:
    titles = engine.configured_titles(config)
    if not titles:
        raise RuntimeError("No enabled role titles")
    target_countries = engine.resolve_target_country_codes(config)
    collection_hours = int(config.get("collection_freshness_hours", config.get("freshness_hours", 24)))
    posted_days = max(1, math.ceil(collection_hours / 24))
    max_items = max(100, min(20000, int(config.get("jobspipe_apify_max_items_per_run", 5000))))
    target_limit = max(1, int(round(max_items * 0.4))) if target_countries else 0
    remote_limit = max_items - target_limit
    common = {"searchTerms": titles, "postedWithinDays": posted_days}
    if config.get("_jscc_shared_collection"):
        return [("global_scope", {**common, "maxItems": max_items})]

    specs: list[tuple[str, dict[str, Any]]] = []
    if target_limit:
        specs.append(("target_geography", {**common, "countries": target_countries, "maxItems": target_limit}))
    if remote_limit:
        specs.append(("remote_global", {**common, "remote": True, "maxItems": remote_limit}))
    if not specs:
        raise RuntimeError("No eligible JobsPipe Apify query could be built")
    return specs


def collect(config: dict[str, Any]) -> list[engine.CollectionResult]:
    token = os.environ.get("APIFY_TOKEN", "")
    try:
        specs = _query_specs(config)
    except Exception as exc:
        return [engine.CollectionResult("jobspipe-apify", "configuration", False, [], 0, str(exc))]
    results: list[engine.CollectionResult] = []
    for name, payload in specs:
        try:
            records = _post_actor(token, payload)
            results.append(engine.CollectionResult("jobspipe-apify", name, True, records, len(records)))
        except Exception as exc:
            results.append(engine.CollectionResult("jobspipe-apify", name, False, [], 0, str(exc)))
    return results


def update_status(collection: list[engine.CollectionResult], max_items: int) -> None:
    status = json.loads(engine.STATUS_PATH.read_text(encoding="utf-8"))
    returned = sum(len(result.records) for result in collection if result.ok)
    estimated_requests = sum(math.ceil(len(result.records) / 500) for result in collection if result.ok and result.records)
    status["limitations"] = []
    status["jobspipe_transport"] = {
        "mode": "apify",
        "actor": "jobspipe~jobspipe-job-search",
        "max_items_per_run": max_items,
        "items_returned": returned,
        "estimated_upstream_requests": estimated_requests,
        "billing_model": "per upstream request/page",
    }
    engine.STATUS_PATH.write_text(json.dumps(status, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    if "--validate-only" in sys.argv:
        engine.validate_output()
        optimized.validate_state()
        print("Configuration, JSON contracts and state valid")
        return 0
    now = datetime.now(timezone.utc)
    config = engine.load_config()
    collection = collect(config)
    state = optimized.load_state(now)
    successful = any(result.ok for result in collection)
    if successful:
        output = engine.process_records(config, collection, now)
        output = optimized.merge_with_existing(output, state, config, now)
        output["incremental_sync"] = False
        max_items = max(100, min(20000, int(config.get("jobspipe_apify_max_items_per_run", 5000))))
        returned = sum(len(result.records) for result in collection if result.ok)
        output["jobspipe_usage"] = {
            "mode": "apify",
            "max_items_per_run": max_items,
            "items_returned": returned,
            "estimated_upstream_requests": sum(math.ceil(len(result.records) / 500) for result in collection if result.ok and result.records),
        }
        engine.JOBS_PATH.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        jobs_published, excluded = output["results"], output["excluded_count"]
        optimized.save_state(state)
    else:
        jobs_published, excluded = current_job_count(), 0
    run_state = engine.write_status(now, collection, jobs_published, excluded)
    update_status(collection, max(100, min(20000, int(config.get("jobspipe_apify_max_items_per_run", 5000)))))
    if successful:
        engine.validate_output()
        optimized.validate_state()
    for result in collection:
        suffix = f" records={len(result.records)}" if result.ok else f" error={result.error}"
        print(f"{result.connector}/{result.query}: {'ok' if result.ok else 'failed'}{suffix}")
    print(f"Search status: {run_state}; jobs={jobs_published}; excluded={excluded}")
    return 2 if run_state == "failed" else 0


if __name__ == "__main__":
    raise SystemExit(main())
