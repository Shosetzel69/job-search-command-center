#!/usr/bin/env python3
"""Workflow entry point for configurable JobsPipe transports."""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone

import job_search as engine
import job_search_apify as apify
import job_search_optimized as optimized


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


def write_provider_disabled_status(now: datetime) -> None:
    jobs_published = current_job_count()
    status = {
        "schema_version": engine.SCHEMA_VERSION,
        "run_id": "github-" + now.strftime("%Y%m%dT%H%M%SZ"),
        "status": "completed",
        "started_at": now.isoformat(),
        "completed_at": datetime.now(timezone.utc).isoformat(),
        "sources": ["jobspipe"],
        "source_results": [
            {
                "connector": "jobspipe",
                "query": "transport_mode",
                "status": "completed",
                "records": 0,
                "total_available": 0,
                "error": None,
            }
        ],
        "records_inspected": 0,
        "jobs_published": jobs_published,
        "excluded": 0,
        "limitations": ["JobsPipe transport disabled by configuration; no provider calls executed"],
        "jobspipe_transport": {
            "mode": "disabled",
            "provider_enabled": False,
        },
    }
    engine.STATUS_PATH.write_text(json.dumps(status, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def write_quota_skipped_status(state: dict, now: datetime) -> None:
    jobs_published = current_job_count()
    status = {
        "schema_version": engine.SCHEMA_VERSION,
        "run_id": "github-" + now.strftime("%Y%m%dT%H%M%SZ"),
        "status": "failed",
        "started_at": now.isoformat(),
        "completed_at": datetime.now(timezone.utc).isoformat(),
        "sources": ["jobspipe"],
        "source_results": [
            {
                "connector": "jobspipe",
                "query": "quota_guard",
                "status": "failed",
                "records": 0,
                "total_available": 0,
                "error": "JobsPipe direct monthly quota already reported exhausted; API call skipped until next UTC month",
            }
        ],
        "records_inspected": 0,
        "jobs_published": jobs_published,
        "excluded": 0,
        "limitations": ["JobsPipe direct monthly quota exhausted; collection skipped"],
        "jobspipe_transport": {"mode": "direct"},
        "jobspipe_optimization": {
            "preview_counts": {},
            "credits_used": 0,
            "run_budget": 0,
            "estimated_monthly_credits": state.get("usage", {}).get("estimated_credits_used", 0),
            "monthly_guard": state.get("usage", {}).get("monthly_guard"),
            "incremental": True,
            "provider_quota_exhausted": True,
        },
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


def main() -> int:
    if "--validate-only" in sys.argv:
        engine.validate_output()
        optimized.validate_state()
        print("Configuration, JSON contracts and state valid")
        return 0

    now = datetime.now(timezone.utc)
    config = engine.load_config()
    mode = configured_mode(config)

    if mode == "disabled":
        write_provider_disabled_status(now)
        engine.validate_output()
        optimized.validate_state()
        print("JobsPipe disabled by configuration; provider call skipped.")
        return 0

    if mode == "apify":
        return apify.main()

    if mode != "direct":
        raise RuntimeError(f"Unsupported jobspipe_mode: {mode}")

    state = optimized.load_state(now)
    if quota_exhausted_this_month(state, now):
        write_quota_skipped_status(state, now)
        optimized.save_state(state)
        engine.validate_output()
        optimized.validate_state()
        print("JobsPipe direct quota circuit breaker active; provider call skipped.")
        return 2

    code = optimized.main()
    if code == 2:
        mark_provider_quota_if_reported(now)
    try:
        status = json.loads(engine.STATUS_PATH.read_text(encoding="utf-8"))
        status["jobspipe_transport"] = {"mode": "direct"}
        engine.STATUS_PATH.write_text(json.dumps(status, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    except Exception:
        pass
    return code


if __name__ == "__main__":
    raise SystemExit(main())
