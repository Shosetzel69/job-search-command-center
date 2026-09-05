#!/usr/bin/env python3
"""Credit-aware incremental orchestration for the JobsPipe connector.

The existing job_search module remains responsible for normalization, filtering,
scoring and output validation. This module optimizes collection for the JobsPipe
Free plan by using free previews, incremental discovery watermarks, cursors and a
monthly credit guard.
"""

from __future__ import annotations

import json
import math
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from typing import Any

import job_search as engine

STATE_PATH = engine.DATA / "search-state.json"


def load_state(now: datetime) -> dict[str, Any]:
    if STATE_PATH.exists():
        try:
            state = json.loads(STATE_PATH.read_text(encoding="utf-8"))
        except Exception:
            state = {}
    else:
        state = {}

    state.setdefault("schema_version", engine.SCHEMA_VERSION)
    state.setdefault("query_progress", {})
    state.setdefault("job_first_seen", {})
    state.setdefault("usage", {})

    # Migrate the first incremental-state draft without losing its watermarks.
    for name, watermark in (state.pop("query_watermarks", {}) or {}).items():
        state["query_progress"].setdefault(name, {})["watermark"] = watermark

    month = now.strftime("%Y-%m")
    if state["usage"].get("month_utc") != month:
        state["usage"] = {"month_utc": month, "estimated_credits_used": 0}
    return state


def save_state(state: dict[str, Any]) -> None:
    STATE_PATH.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def discovered_timestamp(value: datetime) -> str:
    return value.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def parse_datetime(value: Any) -> datetime | None:
    if not value:
        return None
    text = str(value).strip()
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    except Exception:
        return None


def build_query_specs(config: dict[str, Any], state: dict[str, Any], now: datetime) -> dict[str, dict[str, Any]]:
    titles = engine.configured_titles(config)
    if not titles:
        raise RuntimeError("No enabled role titles")

    priority_countries = list(dict.fromkeys(config.get("search_country_codes") or []))
    priority_set = set(priority_countries)
    eligible_remote = list(dict.fromkeys(config.get("eligible_remote_country_codes") or []))
    remote_countries = [code for code in eligible_remote if code not in priority_set]
    collection_hours = int(config.get("collection_freshness_hours", config.get("freshness_hours", 24)))
    freshness_days = max(1, math.ceil(collection_hours / 24))
    overlap_minutes = max(0, int(config.get("jobspipe_incremental_overlap_minutes", 2)))
    fallback = now - timedelta(hours=collection_hours)

    def incremental_fields(name: str) -> dict[str, Any]:
        progress = state.setdefault("query_progress", {}).setdefault(name, {})
        raw = progress.get("watermark")
        parsed = parse_datetime(raw) or fallback
        fields: dict[str, Any] = {
            "discovered_at_gte": discovered_timestamp(parsed - timedelta(minutes=overlap_minutes))
        }
        if progress.get("cursor"):
            fields["cursor"] = progress["cursor"]
        return fields

    common = {
        "job_title_or": titles,
        "posted_at_max_age_days": freshness_days,
        "include_total_results": True,
    }
    specs: dict[str, dict[str, Any]] = {}
    if priority_countries:
        specs["priority_geography"] = {
            **common,
            "job_country_code_or": priority_countries,
            **incremental_fields("priority_geography"),
        }
    if remote_countries:
        specs["remote_europe"] = {
            **common,
            "job_country_code_or": remote_countries,
            "remote": True,
            **incremental_fields("remote_europe"),
        }
    return specs


class PacedJobsPipe:
    def __init__(self, api_key: str) -> None:
        self.connector = engine.JobsPipeConnector(api_key)
        self.last_call = 0.0

    def post(self, payload: dict[str, Any]) -> dict[str, Any]:
        elapsed = time.monotonic() - self.last_call
        if self.last_call and elapsed < 0.55:
            time.sleep(0.55 - elapsed)
        try:
            return self.connector._post(payload)
        finally:
            self.last_call = time.monotonic()


def preview_queries(
    client: PacedJobsPipe, specs: dict[str, dict[str, Any]], state: dict[str, Any]
) -> tuple[dict[str, int], dict[str, str]]:
    counts: dict[str, int] = {}
    errors: dict[str, str] = {}
    for name, spec in specs.items():
        progress = state.setdefault("query_progress", {}).setdefault(name, {})
        if progress.get("cursor"):
            # A stored cursor means there is unfinished paid pagination. Do not alter
            # the cursor query with preview-only fields; continue it directly.
            counts[name] = max(1, int(progress.get("remaining_estimate") or 1))
            continue
        try:
            response = client.post({**spec, "limit": 1, "blur_company_data": True})
            counts[name] = max(0, int(response.get("metadata", {}).get("total_results") or 0))
        except Exception as exc:
            errors[name] = str(exc)
    return counts, errors


def allocate_budget(counts: dict[str, int], budget: int) -> dict[str, int]:
    """Allocate a bounded run budget, favoring remote while preserving local coverage."""
    allocations = {name: 0 for name in counts}
    if budget <= 0:
        return allocations

    base_targets = {"remote_europe": 8, "priority_geography": 6}
    remaining = budget
    for name in ("remote_europe", "priority_geography"):
        if name not in counts or remaining <= 0:
            continue
        amount = min(counts[name], base_targets[name], remaining)
        allocations[name] = amount
        remaining -= amount

    while remaining > 0:
        progressed = False
        for name in ("remote_europe", "priority_geography"):
            if name in counts and allocations[name] < counts[name] and remaining > 0:
                allocations[name] += 1
                remaining -= 1
                progressed = True
        if not progressed:
            break
    return allocations


def update_query_progress(
    state: dict[str, Any], name: str, response: dict[str, Any], records: list[dict[str, Any]], now: datetime
) -> None:
    progress = state.setdefault("query_progress", {}).setdefault(name, {})
    progress.setdefault("poll_started_at", now.isoformat())

    seen_times = [parse_datetime(record.get("discovered_at")) for record in records]
    seen_times = [value for value in seen_times if value is not None]
    previous_max = parse_datetime(progress.get("max_discovered_at_seen"))
    if previous_max:
        seen_times.append(previous_max)
    if seen_times:
        progress["max_discovered_at_seen"] = max(seen_times).isoformat()

    metadata = response.get("metadata", {}) or {}
    next_cursor = metadata.get("next_cursor")
    if next_cursor:
        progress["cursor"] = next_cursor
        total = max(0, int(metadata.get("total_results") or 0))
        previous_remaining = max(0, int(progress.get("remaining_estimate") or total))
        progress["remaining_estimate"] = max(1, previous_remaining - len(records))
        return

    # Sweep completed. Move the watermark only after the cursor chain is exhausted.
    completed_watermark = parse_datetime(progress.get("max_discovered_at_seen")) or parse_datetime(progress.get("poll_started_at")) or now
    progress["watermark"] = completed_watermark.isoformat()
    progress.pop("cursor", None)
    progress.pop("remaining_estimate", None)
    progress.pop("poll_started_at", None)
    progress.pop("max_discovered_at_seen", None)


def mark_empty_query_complete(state: dict[str, Any], name: str, now: datetime) -> None:
    progress = state.setdefault("query_progress", {}).setdefault(name, {})
    progress["watermark"] = now.isoformat()
    progress.pop("cursor", None)
    progress.pop("remaining_estimate", None)
    progress.pop("poll_started_at", None)
    progress.pop("max_discovered_at_seen", None)


def collect_incremental(
    config: dict[str, Any], state: dict[str, Any], now: datetime
) -> tuple[list[engine.CollectionResult], int, dict[str, int], int]:
    api_key = os.environ.get("JOBSPIPE_API_KEY", "")
    client = PacedJobsPipe(api_key)
    specs = build_query_specs(config, state, now)
    preview_counts, preview_errors = preview_queries(client, specs, state)

    monthly_guard = max(0, int(config.get("jobspipe_monthly_credit_guard", 950)))
    per_run_budget = max(0, int(config.get("jobspipe_credit_budget_per_run", 14)))
    used = max(0, int(state.get("usage", {}).get("estimated_credits_used", 0)))
    remaining_month = max(0, monthly_guard - used)
    budget = min(per_run_budget, remaining_month)
    allocations = allocate_budget(preview_counts, budget)

    results: list[engine.CollectionResult] = []
    credits_used = 0

    for name, spec in specs.items():
        if name in preview_errors:
            results.append(engine.CollectionResult("jobspipe", name, False, [], 0, f"preview failed: {preview_errors[name]}"))
            continue

        total = preview_counts.get(name, 0)
        progress = state.setdefault("query_progress", {}).setdefault(name, {})
        if total == 0 and not progress.get("cursor"):
            results.append(engine.CollectionResult("jobspipe", name, True, [], 0))
            mark_empty_query_complete(state, name, now)
            continue

        limit = allocations.get(name, 0)
        if limit <= 0:
            results.append(engine.CollectionResult("jobspipe", name, False, [], total, "local JobsPipe monthly credit guard reached"))
            continue

        try:
            progress.setdefault("poll_started_at", now.isoformat())
            response = client.post({**spec, "limit": limit})
            records = response.get("data") or []
            credits_used += len(records)
            metadata_total = max(total, int(response.get("metadata", {}).get("total_results") or 0))
            results.append(engine.CollectionResult("jobspipe", name, True, records, metadata_total))
            update_query_progress(state, name, response, records, now)
        except Exception as exc:
            results.append(engine.CollectionResult("jobspipe", name, False, [], total, str(exc)))

    state["usage"]["estimated_credits_used"] = used + credits_used
    state["usage"]["last_run_credits"] = credits_used
    state["usage"]["monthly_guard"] = monthly_guard
    state["usage"]["per_run_budget"] = per_run_budget
    return results, credits_used, preview_counts, budget


def parse_job_age_hours(value: Any, now: datetime) -> int | None:
    if not value:
        return None
    text = str(value).strip()
    try:
        if len(text) == 10 and text[4] == "-" and text[7] == "-":
            parsed = datetime.fromisoformat(text).replace(tzinfo=timezone.utc)
        else:
            parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
        return max(0, int((now - parsed.astimezone(timezone.utc)).total_seconds() // 3600))
    except Exception:
        return None


def job_key(job: dict[str, Any]) -> str:
    if job.get("id"):
        return f"id:{job['id']}"
    return "fallback:" + "|".join(
        str(job.get(field) or "").strip().lower() for field in ("title", "company", "location")
    )


def merge_with_existing(
    new_output: dict[str, Any], state: dict[str, Any], config: dict[str, Any], now: datetime
) -> dict[str, Any]:
    existing_jobs: list[dict[str, Any]] = []
    if engine.JOBS_PATH.exists():
        try:
            current = json.loads(engine.JOBS_PATH.read_text(encoding="utf-8"))
            if current.get("schema_version") == engine.SCHEMA_VERSION:
                existing_jobs = current.get("jobs") or []
        except Exception:
            existing_jobs = []

    merged: dict[str, dict[str, Any]] = {job_key(job): job for job in existing_jobs}
    for job in new_output.get("jobs") or []:
        merged[job_key(job)] = job

    collection_hours = int(config.get("collection_freshness_hours", config.get("freshness_hours", 24)))
    first_seen = state.setdefault("job_first_seen", {})
    retained: list[dict[str, Any]] = []
    retained_keys: set[str] = set()
    expired = 0

    for key, job in merged.items():
        first_seen.setdefault(key, now.isoformat())
        age = parse_job_age_hours(job.get("date_posted"), now)
        if age is None:
            age = parse_job_age_hours(first_seen.get(key), now) or 0
        if age > collection_hours:
            expired += 1
            continue
        job["age"] = age
        retained.append(job)
        retained_keys.add(key)

    state["job_first_seen"] = {key: first_seen[key] for key in retained_keys if key in first_seen}
    retained.sort(key=lambda item: (-int(item.get("fit") or 0), int(item.get("age") or 0), str(item.get("company") or "").lower()))

    new_output["jobs"] = retained
    new_output["results"] = len(retained)
    new_output["freshness_hours"] = collection_hours
    new_output["collection_freshness_hours"] = collection_hours
    new_output["incremental_sync"] = True
    new_output["expired_pruned"] = expired
    new_output["jobspipe_usage"] = {
        "month_utc": state.get("usage", {}).get("month_utc"),
        "estimated_credits_used": state.get("usage", {}).get("estimated_credits_used", 0),
        "monthly_guard": state.get("usage", {}).get("monthly_guard"),
        "last_run_credits": state.get("usage", {}).get("last_run_credits", 0),
    }
    return new_output


def append_status_metadata(credits_used: int, preview_counts: dict[str, int], budget: int, state: dict[str, Any]) -> None:
    status = json.loads(engine.STATUS_PATH.read_text(encoding="utf-8"))
    status["jobspipe_optimization"] = {
        "preview_counts": preview_counts,
        "credits_used": credits_used,
        "run_budget": budget,
        "estimated_monthly_credits": state.get("usage", {}).get("estimated_credits_used", 0),
        "monthly_guard": state.get("usage", {}).get("monthly_guard"),
        "incremental": True,
        "query_progress": {
            name: {
                "has_cursor": bool(progress.get("cursor")),
                "remaining_estimate": progress.get("remaining_estimate", 0),
            }
            for name, progress in state.get("query_progress", {}).items()
        },
    }
    engine.STATUS_PATH.write_text(json.dumps(status, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def validate_state() -> None:
    if not STATE_PATH.exists():
        return
    state = json.loads(STATE_PATH.read_text(encoding="utf-8"))
    assert state.get("schema_version") == engine.SCHEMA_VERSION
    assert isinstance(state.get("query_progress", {}), dict)
    assert isinstance(state.get("job_first_seen", {}), dict)
    assert isinstance(state.get("usage", {}), dict)


def main() -> int:
    if "--validate-only" in sys.argv:
        engine.validate_output()
        validate_state()
        print("Configuration, output and incremental state valid")
        return 0

    now = datetime.now(timezone.utc)
    config = engine.load_config()
    state = load_state(now)

    try:
        collection, credits_used, preview_counts, budget = collect_incremental(config, state, now)
    except Exception as exc:
        engine.STATUS_PATH.write_text(
            json.dumps(
                {
                    "schema_version": engine.SCHEMA_VERSION,
                    "run_id": "github-" + now.strftime("%Y%m%dT%H%M%SZ"),
                    "status": "failed",
                    "started_at": now.isoformat(),
                    "completed_at": datetime.now(timezone.utc).isoformat(),
                    "sources": [],
                    "source_results": [],
                    "records_inspected": 0,
                    "jobs_published": 0,
                    "excluded": 0,
                    "limitations": [str(exc)],
                },
                ensure_ascii=False,
                indent=2,
            ) + "\n",
            encoding="utf-8",
        )
        print(str(exc), file=sys.stderr)
        return 2

    successful = any(result.ok for result in collection)
    if successful:
        output = engine.process_records(config, collection, now)
        output = merge_with_existing(output, state, config, now)
        engine.JOBS_PATH.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        jobs_published = output["results"]
        excluded = output["excluded_count"]
    else:
        try:
            current = json.loads(engine.JOBS_PATH.read_text(encoding="utf-8"))
            jobs_published = len(current.get("jobs") or [])
        except Exception:
            jobs_published = 0
        excluded = 0

    state_name = engine.write_status(now, collection, jobs_published, excluded)
    append_status_metadata(credits_used, preview_counts, budget, state)
    save_state(state)

    if successful:
        engine.validate_output()
    validate_state()

    for result in collection:
        suffix = f" records={len(result.records)} total={result.total_available}" if result.ok else f" error={result.error}"
        print(f"{result.connector}/{result.query}: {'ok' if result.ok else 'failed'}{suffix}")
    print(
        f"Search status: {state_name}; jobs={jobs_published}; credits_this_run={credits_used}; "
        f"estimated_month={state['usage'].get('estimated_credits_used', 0)}"
    )
    return 2 if state_name == "failed" else 0


if __name__ == "__main__":
    raise SystemExit(main())
