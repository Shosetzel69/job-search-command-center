#!/usr/bin/env python3
"""Workflow entry point with a provider-quota circuit breaker."""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone

import job_search as engine
import job_search_optimized as optimized


def quota_exhausted_this_month(state: dict, now: datetime) -> bool:
    return state.get("usage", {}).get("provider_quota_exhausted_month") == now.strftime("%Y-%m")


def write_quota_skipped_status(state: dict, now: datetime) -> None:
    try:
        current = json.loads(engine.JOBS_PATH.read_text(encoding="utf-8"))
        jobs_published = len(current.get("jobs") or [])
    except Exception:
        jobs_published = 0

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
                "error": "JobsPipe monthly quota already reported exhausted; API call skipped until next UTC month",
            }
        ],
        "records_inspected": 0,
        "jobs_published": jobs_published,
        "excluded": 0,
        "limitations": ["JobsPipe monthly quota exhausted; collection skipped to avoid redundant API calls"],
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
        return optimized.main()

    now = datetime.now(timezone.utc)
    state = optimized.load_state(now)
    if quota_exhausted_this_month(state, now):
        write_quota_skipped_status(state, now)
        optimized.save_state(state)
        engine.validate_output()
        optimized.validate_state()
        print("JobsPipe quota circuit breaker active; provider call skipped.")
        return 2

    code = optimized.main()
    if code == 2:
        mark_provider_quota_if_reported(now)
    return code


if __name__ == "__main__":
    raise SystemExit(main())
