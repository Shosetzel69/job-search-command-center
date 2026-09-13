#!/usr/bin/env python3
"""Workflow entry point for catalog-driven collection and run history."""

from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone

import job_search as engine
import job_search_apify as apify
import job_search_optimized as optimized
import source_orchestration as orchestration

HISTORY_PATH = engine.DATA / "run-history.json"
HISTORY_LIMIT = 10


def quota_exhausted_this_month(state: dict, now: datetime) -> bool:
    return state.get("usage", {}).get("provider_quota_exhausted_month") == now.strftime("%Y-%m")


def current_job_count() -> int:
    try:
        current = json.loads(engine.JOBS_PATH.read_text(encoding="utf-8"))
        return len(current.get("jobs") or [])
    except Exception:
        return 0


def configured_mode(config: dict) -> str:
    mode = config.get("jobspipe_mode")
    if mode:
        return str(mode).lower()
    return "direct" if config.get("jobspipe_enabled", True) else "disabled"


def _base_status(now: datetime, state: str, mode: str, limitation: str | None = None) -> dict:
    failed = state == "failed"
    provider_processed = mode != "disabled"
    return {
        "schema_version": engine.SCHEMA_VERSION,
        "run_id": "github-" + now.strftime("%Y%m%dT%H%M%SZ"),
        "status": state,
        "started_at": now.isoformat(),
        "completed_at": datetime.now(timezone.utc).isoformat(),
        "sources": ["JobsPipe"] if provider_processed else [],
        "sources_processed": 1 if provider_processed else 0,
        "failed_sources": ["JobsPipe"] if failed and provider_processed else [],
        "source_results": [{
            "source": "JobsPipe",
            "connector": "jobspipe",
            "query": "transport_mode" if mode == "disabled" else "quota_guard",
            "status": "failed" if failed else "completed",
            "records": 0,
            "total_available": 0,
            "error": limitation if failed else None,
        }],
        "records_inspected": 0,
        "jobs_published": current_job_count(),
        "excluded": 0,
        "limitations": [limitation] if limitation else [],
        "jobspipe_transport": {"mode": mode, "provider_enabled": provider_processed},
    }


def write_provider_disabled_status(now: datetime) -> None:
    status = _base_status(
        now,
        "completed",
        "disabled",
        "JobsPipe transport disabled by configuration; no provider calls executed",
    )
    engine.STATUS_PATH.write_text(json.dumps(status, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def write_quota_skipped_status(state: dict, now: datetime) -> None:
    message = "JobsPipe direct monthly quota already reported exhausted; API call skipped until next UTC month"
    status = _base_status(now, "failed", "direct", message)
    status["jobspipe_optimization"] = {
        "preview_counts": {},
        "credits_used": 0,
        "run_budget": 0,
        "estimated_monthly_credits": state.get("usage", {}).get("estimated_credits_used", 0),
        "monthly_guard": state.get("usage", {}).get("monthly_guard"),
        "incremental": True,
        "provider_quota_exhausted": True,
    }
    engine.STATUS_PATH.write_text(json.dumps(status, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def mark_provider_quota_if_reported(now: datetime) -> None:
    try:
        status = json.loads(engine.STATUS_PATH.read_text(encoding="utf-8"))
    except Exception:
        return
    errors = [str(item.get("error") or "") for item in status.get("source_results", [])]
    if not any("Monthly request quota exceeded" in error for error in errors):
        return
    state = optimized.load_state(now)
    state.setdefault("usage", {})["provider_quota_exhausted_month"] = now.strftime("%Y-%m")
    optimized.save_state(state)


def append_run_history() -> None:
    try:
        status = json.loads(engine.STATUS_PATH.read_text(encoding="utf-8"))
    except Exception:
        return
    try:
        history = json.loads(HISTORY_PATH.read_text(encoding="utf-8")) if HISTORY_PATH.exists() else {}
    except Exception:
        history = {}

    trigger = os.environ.get("RUN_TRIGGER") or os.environ.get("GITHUB_EVENT_NAME") or "unknown"
    source_sha = (os.environ.get("SOURCE_SHA") or "").strip().lower()
    status["trigger"] = trigger
    if source_sha:
        status["source_sha"] = source_sha
    engine.STATUS_PATH.write_text(json.dumps(status, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    runs = history.get("runs") if isinstance(history.get("runs"), list) else []
    started = engine.parse_posted_datetime(status.get("started_at"))
    completed = engine.parse_posted_datetime(status.get("completed_at"))
    duration_seconds = None
    if started and completed:
        duration_seconds = max(0, int((completed - started).total_seconds()))

    entry = {
        "run_id": status.get("run_id"),
        "status": status.get("status"),
        "trigger": trigger,
        "source_sha": status.get("source_sha"),
        "started_at": status.get("started_at"),
        "completed_at": status.get("completed_at"),
        "duration_seconds": duration_seconds,
        "transport": (status.get("jobspipe_transport") or {}).get("mode"),
        "sources": status.get("sources") or [],
        "sources_processed": int(status.get("sources_processed") or 0),
        "failed_sources": status.get("failed_sources") or [],
        "records_inspected": int(status.get("records_inspected") or 0),
        "jobs_published": int(status.get("jobs_published") or 0),
        "excluded": int(status.get("excluded") or 0),
        "source_results": status.get("source_results") or [],
        "limitations": status.get("limitations") or [],
        "publication": "published",
    }
    entry.update({key: status[key] for key in (*orchestration.COUNTERS, "source_strategy") if key in status})
    runs = [run for run in runs if run.get("run_id") != entry["run_id"]]
    runs.insert(0, entry)
    HISTORY_PATH.write_text(
        json.dumps(
            {"schema_version": engine.SCHEMA_VERSION, "runs": runs[:HISTORY_LIMIT]},
            ensure_ascii=False,
            indent=2,
        ) + "\n",
        encoding="utf-8",
    )


def validate_history() -> None:
    payload = json.loads(HISTORY_PATH.read_text(encoding="utf-8"))
    assert payload.get("schema_version") == engine.SCHEMA_VERSION
    assert isinstance(payload.get("runs"), list)
    assert len(payload["runs"]) <= HISTORY_LIMIT


def main() -> int:
    if "--validate-only" in sys.argv:
        engine.validate_output()
        optimized.validate_state()
        validate_history()
        print("Configuration, JSON contracts, history and state valid")
        return 0

    now = datetime.now(timezone.utc)
    config = engine.load_config()
    code = orchestration.run(config, now)

    append_run_history()
    if code == 0:
        engine.validate_output()
    optimized.validate_state()
    validate_history()
    return code


if __name__ == "__main__":
    raise SystemExit(main())
