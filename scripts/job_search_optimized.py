#!/usr/bin/env python3
"""Credit-aware incremental orchestration for the direct JobsPipe transport."""

from __future__ import annotations

import json
import math
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from typing import Any

import job_search as engine
from job_identity import deduplicate

STATE_PATH = engine.RUNTIME_DATA / "search-state.json"


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
    try:
        parsed = datetime.fromisoformat(str(value).strip().replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    except Exception:
        return None


def build_query_specs(config: dict[str, Any], state: dict[str, Any], now: datetime) -> dict[str, dict[str, Any]]:
    titles = engine.configured_titles(config)
    if not titles:
        raise RuntimeError("No enabled role titles")

    target_countries = engine.resolve_target_country_codes(config)
    collection_hours = int(config.get("collection_freshness_hours", config.get("freshness_hours", 24)))
    freshness_days = max(1, math.ceil(collection_hours / 24))
    overlap_minutes = max(0, int(config.get("jobspipe_incremental_overlap_minutes", 2)))
    fallback = now - timedelta(hours=collection_hours)

    def incremental_fields(name: str) -> dict[str, Any]:
        progress = state.setdefault("query_progress", {}).setdefault(name, {})
        parsed = parse_datetime(progress.get("watermark")) or fallback
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
    if config.get("_jscc_shared_collection"):
        specs["global_scope"] = {
            **common,
            **incremental_fields("global_scope"),
        }
        return specs

    if target_countries:
        specs["target_geography"] = {
            **common,
            "job_country_code_or": target_countries,
            **incremental_fields("target_geography"),
        }

    specs["remote_scope"] = {
        **common,
        "remote": True,
        **incremental_fields("remote_scope"),
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
    client: PacedJobsPipe,
    specs: dict[str, dict[str, Any]],
    state: dict[str, Any],
) -> tuple[dict[str, int], dict[str, str]]:
    counts: dict[str, int] = {}
    errors: dict[str, str] = {}
    for name, spec in specs.items():
        progress = state.setdefault("query_progress", {}).setdefault(name, {})
        if progress.get("cursor"):
            # Continue unfinished paid pagination without altering the cursor query.
            counts[name] = max(1, int(progress.get("remaining_estimate") or 1))
            continue
        try:
            response = client.post({**spec, "limit": 1, "blur_company_data": True})
            counts[name] = max(0, int(response.get("metadata", {}).get("total_results") or 0))
        except Exception as exc:
            errors[name] = str(exc)
    return counts, errors


def allocate_budget(counts: dict[str, int], budget: int) -> dict[str, int]:
    """Favor remote coverage while preserving target-geography coverage."""
    allocations = {name: 0 for name in counts}
    if budget <= 0:
        return allocations

    if "global_scope" in counts:
        allocations["global_scope"] = min(max(0, counts["global_scope"]), budget)
        return allocations

    base_targets = {"remote_scope": 8, "target_geography": 6}
    remaining = budget
    for name in ("remote_scope", "target_geography"):
        if name not in counts or remaining <= 0:
            continue
        amount = min(counts[name], base_targets[name], remaining)
        allocations[name] = amount
        remaining -= amount

    while remaining > 0:
        progressed = False
        for name in ("remote_scope", "target_geography"):
            if name in counts and allocations[name] < counts[name] and remaining > 0:
                allocations[name] += 1
                remaining -= 1
                progressed = True
        if not progressed:
            break
    return allocations


def update_query_progress(
    state: dict[str, Any],
    name: str,
    response: dict[str, Any],
    records: list[dict[str, Any]],
    now: datetime,
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

    completed_watermark = (
        parse_datetime(progress.get("max_discovered_at_seen"))
        or parse_datetime(progress.get("poll_started_at"))
        or now
    )
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
    config: dict[str, Any],
    state: dict[str, Any],
    now: datetime,
) -> tuple[list[engine.CollectionResult], int, dict[str, int], int]:
    client = PacedJobsPipe(os.environ.get("JOBSPIPE_API_KEY", ""))
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
    parsed = parse_datetime(value)
    if not parsed:
        return None
    return max(0, int((now - parsed).total_seconds() // 3600))


def job_key(job: dict[str, Any]) -> str:
    if job.get("id"):
        return f"id:{str(job.get('source') or '').casefold()}:{job['id']}"
    return "fallback:" + "|".join(
        str(job.get(field) or "").strip().lower()
        for field in ("title", "company", "location")
    )


def existing_job_rejection_reason(job: dict[str, Any], config: dict[str, Any]) -> str | None:
    """Reapply mutable search criteria to a normalized job retained from a prior run."""
    title = str(job.get("title") or "").strip()
    company = str(job.get("company") or "").strip()
    description = str(job.get("description") or "")
    text = f"{title} {description}"

    remote = bool(job.get("remote"))
    mode_label = str(job.get("mode") or "").strip().casefold()
    mode_code = {
        "remote": "remote",
        "hybrid": "hybrid",
        "hibrid": "hybrid",
        "onsite": "onsite",
        "on-site": "onsite",
    }.get(mode_label)
    if remote:
        mode_code = "remote"

    country_codes = {
        str(value).strip().upper()
        for value in (job.get("country_codes") or [])
        if str(value).strip()
    }
    remote_scope = str(job.get("remote_scope") or "").strip() or (
        "Worldwide" if remote and not country_codes else "Country" if country_codes else "Unknown"
    )

    contract_type = str(job.get("contract_type") or "").strip().lower()
    if not contract_type:
        contract_type = engine.canonical_nomenclatures.normalize_contract_type(
            [job.get("type")] if job.get("type") else [],
            engine.NOMENCLATURES,
        )
    selected_contract_types = engine.configured_contract_types(config)
    work_modes = config.get("work_modes") or {}
    excluded_company, excluded_role, deep_erp = engine.compile_config_patterns(config)

    if excluded_company and excluded_company.search(company):
        return "excluded company"
    if excluded_role and excluded_role.search(title):
        return "non-IT role"
    if deep_erp and deep_erp.search(text) and re.search(r"implement|consultant|specialist|functional", text, re.I):
        return "deep ERP/SAP implementation"
    if mode_code in {"remote", "hybrid", "onsite"} and not work_modes.get(mode_code, mode_code != "onsite"):
        return f"{mode_code} disabled by configuration"
    if contract_type != "unknown" and selected_contract_types and contract_type not in selected_contract_types:
        return "contract type disabled by configuration"
    if remote and job.get("romania_eligible") is False:
        return "remote not eligible from Romania"
    if not engine.geography_matches(country_codes, remote_scope, config, remote):
        return "outside target or excluded geography"
    if not bool(config.get("keep_reposts", True)) and bool(job.get("repost")):
        return "repost disabled by configuration"
    return None


def merge_with_existing(
    new_output: dict[str, Any],
    state: dict[str, Any],
    config: dict[str, Any],
    now: datetime,
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
    criteria_pruned = 0
    criteria_pruned_reasons: dict[str, int] = {}

    for key, job in merged.items():
        first_seen.setdefault(key, now.isoformat())
        age = parse_job_age_hours(job.get("date_posted"), now)
        if age is None:
            age = parse_job_age_hours(first_seen.get(key), now) or 0
        if age > collection_hours:
            expired += 1
            continue

        job["age"] = age
        job.setdefault("countries", [])
        job.setdefault("country_codes", [])
        if "remote_scope" not in job:
            job["remote_scope"] = "Worldwide" if job.get("remote") and not job.get("country_codes") else "Unknown"

        rejection_reason = existing_job_rejection_reason(job, config)
        if rejection_reason:
            criteria_pruned += 1
            criteria_pruned_reasons[rejection_reason] = criteria_pruned_reasons.get(rejection_reason, 0) + 1
            continue

        retained.append(job)
        retained_keys.add(key)

    state["job_first_seen"] = {key: first_seen[key] for key in retained_keys if key in first_seen}
    retained.sort(
        key=lambda item: (
            -int(item.get("fit") or 0),
            int(item.get("age") or 0),
            str(item.get("company") or "").lower(),
        )
    )

    before_dedup = len(retained)
    retained = deduplicate(retained)
    new_output["cross_source_duplicates_removed"] = before_dedup - len(retained)
    new_output["jobs"] = retained
    new_output["results"] = len(retained)
    new_output["freshness_hours"] = collection_hours
    new_output["collection_freshness_hours"] = collection_hours
    new_output["incremental_sync"] = True
    new_output["expired_pruned"] = expired
    new_output["criteria_revalidated_pruned"] = criteria_pruned
    new_output["criteria_revalidation_reasons"] = criteria_pruned_reasons
    new_output["jobspipe_usage"] = {
        "month_utc": state.get("usage", {}).get("month_utc"),
        "estimated_credits_used": state.get("usage", {}).get("estimated_credits_used", 0),
        "monthly_guard": state.get("usage", {}).get("monthly_guard"),
        "last_run_credits": state.get("usage", {}).get("last_run_credits", 0),
    }
    return new_output


def append_status_metadata(
    credits_used: int,
    preview_counts: dict[str, int],
    budget: int,
    state: dict[str, Any],
) -> None:
    status = json.loads(engine.STATUS_PATH.read_text(encoding="utf-8"))
    status["jobspipe_transport"] = {"mode": "direct"}
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
        status = {
            "schema_version": engine.SCHEMA_VERSION,
            "run_id": "github-" + now.strftime("%Y%m%dT%H%M%SZ"),
            "status": "failed",
            "started_at": now.isoformat(),
            "completed_at": datetime.now(timezone.utc).isoformat(),
            "sources": ["JobsPipe"],
            "sources_processed": 1,
            "failed_sources": ["JobsPipe"],
            "source_results": [],
            "records_inspected": 0,
            "jobs_published": 0,
            "excluded": 0,
            "limitations": [str(exc)],
            "jobspipe_transport": {"mode": "direct"},
        }
        engine.STATUS_PATH.write_text(json.dumps(status, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
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
