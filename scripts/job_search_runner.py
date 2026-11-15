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
import shared_corpus_repository as shared_corpus

HISTORY_PATH = engine.RUNTIME_DATA / "run-history.json"
HISTORY_LIMIT = 10


def retrieve_context(now: datetime) -> tuple[str, str | None, dict | None]:
    run_id = str(os.environ.get("JSCC_RUN_ID") or "").strip() or ("github-" + now.strftime("%Y%m%dT%H%M%SZ"))
    signature = str(os.environ.get("JSCC_REQUEST_SIGNATURE") or "").strip().casefold() or None
    raw_scope = str(os.environ.get("JSCC_RETRIEVE_SCOPE_JSON") or "").strip()
    scope = None
    if raw_scope:
        parsed = json.loads(raw_scope)
        if not isinstance(parsed, dict):
            raise RuntimeError("JSCC_RETRIEVE_SCOPE_JSON must be an object")
        scopes = parsed.get("scopes")
        if not isinstance(scopes, list) or not scopes:
            raise RuntimeError("bounded retrieve scope must contain scopes")
        scope = parsed
    if signature and (len(signature) != 64 or any(ch not in "0123456789abcdef" for ch in signature)):
        raise RuntimeError("JSCC_REQUEST_SIGNATURE must be a lowercase sha256")
    if scope and not signature:
        raise RuntimeError("bounded retrieve scope requires JSCC_REQUEST_SIGNATURE")
    return run_id, signature, scope


def terminal_failure_status(now: datetime, run_id: str, signature: str | None, scope: dict | None, exc: Exception) -> dict:
    try:
        current = json.loads(engine.STATUS_PATH.read_text(encoding="utf-8"))
        if not isinstance(current, dict):
            current = {}
    except Exception:
        current = {}
    # The launcher seeds run-status.json from a previous snapshot. Never relabel
    # that run's counters, timestamps or limitations as this failed run.
    if current.get("run_id") != run_id:
        current = {}
    current.update({
        "schema_version": engine.SCHEMA_VERSION,
        "run_id": run_id,
        "status": "failed",
        "started_at": current.get("started_at") or now.isoformat(),
        "completed_at": datetime.now(timezone.utc).isoformat(),
        "request_signature": signature,
        "retrieve_scope": scope,
    })
    current.setdefault("sources", [])
    current.setdefault("sources_processed", 0)
    current.setdefault("failed_sources", [])
    current.setdefault("source_results", [])
    current.setdefault("records_inspected", 0)
    current.setdefault("jobs_published", current_job_count())
    current.setdefault("excluded", 0)
    limitations = list(current.get("limitations") or [])
    limitations.append(f"run_failure: {type(exc).__name__}: {str(exc)[:500]}")
    current["limitations"] = limitations
    engine.STATUS_PATH.write_text(json.dumps(current, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return current


def quota_exhausted_this_month(state: dict, now: datetime) -> bool:
    return state.get("usage", {}).get("provider_quota_exhausted_month") == now.strftime("%Y-%m")


def current_job_count() -> int:
    if orchestration.nile_only_dev_retrieve():
        return 0
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
        "publication_basis": status.get("publication_basis"),
        "excluded_basis": status.get("excluded_basis"),
        "excluded": int(status.get("excluded") or 0),
        "excluded_by_reason": status.get("excluded_by_reason") or {},
        "excluded_by_category": status.get("excluded_by_category") or {},
        "role_filter_audit": status.get("role_filter_audit") or {},
        "shared_corpus": status.get("shared_corpus") or {},
        "source_results": status.get("source_results") or [],
        "source_outcome_counts": status.get("source_outcome_counts") or {},
        "source_record_totals": status.get("source_record_totals") or {},
        "provider_scope_inventory": status.get("provider_scope_inventory") or {},
        "canonical_publication": status.get("canonical_publication"),
        "coverage_before": status.get("coverage_before"),
        "coverage_after": status.get("coverage_after"),
        "source_failure_codes": status.get("source_failure_codes") or {},
        "source_failure_stages": status.get("source_failure_stages") or {},
        "limitations": status.get("limitations") or [],
        "request_signature": status.get("request_signature"),
        "retrieve_scope": status.get("retrieve_scope"),
        "progress": status.get("progress") or {},
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



def persist_terminal_evidence():
    """Persist the terminal Run, then mirror its authoritative Coverage snapshot."""
    nile_only = orchestration.nile_only_dev_retrieve()
    if not nile_only:
        append_run_history()
    status = json.loads(engine.STATUS_PATH.read_text(encoding="utf-8"))
    if nile_only:
        status["trigger"] = os.environ.get("RUN_TRIGGER") or os.environ.get("GITHUB_EVENT_NAME") or "unknown"
        source_sha = (os.environ.get("SOURCE_SHA") or "").strip().lower()
        if source_sha:
            status["source_sha"] = source_sha
    evidence = shared_corpus.persist_operational_run(status)
    if isinstance(evidence, dict) and "coverage_after" in evidence:
        for key in ("coverage_before", "coverage_after"):
            status[key] = evidence.get(key)
    if nile_only or (isinstance(evidence, dict) and "coverage_after" in evidence):
        engine.STATUS_PATH.write_text(json.dumps(status, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        if not nile_only:
            append_run_history()


def stamp_jobs_provenance() -> bool:
    """Bind a newly generated jobs snapshot to the exact terminal run.

    Existing/stale jobs are intentionally left byte-for-byte unchanged when a run
    does not produce a new jobs snapshot.
    """
    if orchestration.nile_only_dev_retrieve():
        return False
    try:
        status = json.loads(engine.STATUS_PATH.read_text(encoding="utf-8"))
        jobs = json.loads(engine.JOBS_PATH.read_text(encoding="utf-8"))
    except Exception:
        return False

    if jobs.get("generated_at") != status.get("started_at"):
        return False

    jobs["run_id"] = status.get("run_id")
    jobs["run_status"] = status.get("status")
    jobs["run_completed_at"] = status.get("completed_at")
    if status.get("source_sha"):
        jobs["source_sha"] = status.get("source_sha")
    engine.JOBS_PATH.write_text(
        json.dumps(jobs, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return True


def validate_history() -> None:
    if orchestration.nile_only_dev_retrieve():
        snapshot = json.loads(engine.STATUS_PATH.read_text(encoding="utf-8"))
        canonical = shared_corpus.read_operational_run(snapshot["run_id"])
        for field in ("run_id", "status", "records_inspected", "jobs_published", "excluded"):
            assert canonical.get(field) == snapshot.get(field), "Nile operational evidence mismatch: " + field
        return
    payload = json.loads(HISTORY_PATH.read_text(encoding="utf-8"))
    assert payload.get("schema_version") == engine.SCHEMA_VERSION
    assert isinstance(payload.get("runs"), list)
    assert len(payload["runs"]) <= HISTORY_LIMIT

    status = json.loads(engine.STATUS_PATH.read_text(encoding="utf-8"))
    if status.get("status") in {"completed", "completed_with_errors", "failed"}:
        assert payload["runs"], "terminal run must have a corresponding history entry"
        assert payload["runs"][0].get("run_id") == status.get("run_id"), "latest history run must match terminal run-status"

    if orchestration.nile_only_dev_retrieve():
        return
    try:
        jobs = json.loads(engine.JOBS_PATH.read_text(encoding="utf-8"))
    except Exception:
        jobs = {}
    if jobs.get("generated_at") == status.get("started_at"):
        assert jobs.get("run_id") == status.get("run_id"), "new jobs snapshot must identify its producing run"
        assert jobs.get("run_status") == status.get("status")
        if status.get("source_sha"):
            assert jobs.get("source_sha") == status.get("source_sha")


def validate_dev_output():
    """Validate the operational contract without a legacy jobs file."""
    config = json.loads(engine.CONFIG_PATH.read_text(encoding="utf-8"))
    status = json.loads(engine.STATUS_PATH.read_text(encoding="utf-8"))
    assert config.get("schema_version") == engine.SCHEMA_VERSION
    engine.validate_geography_config(config)
    assert not (engine.configured_contract_types(config) - engine.ACTIVE_CONTRACT_TYPES)
    assert status.get("schema_version") == engine.SCHEMA_VERSION
    assert status.get("status") in {"completed", "completed_with_errors"}
    assert status.get("publication_basis") == "distinct_active_shared_jobs_by_api_preferred_source"
    publication = status["canonical_publication"]
    assert publication["measured"] is True
    assert status["jobs_published"] == publication["canonical_jobs_published_this_run"]
    assert status["jobs_published"] == (
        publication["attributed_to_planned_sources"] + publication["attributed_to_other_sources"])
    assert status["excluded"] == max(0, status["records_inspected"]
        - int(status["shared_corpus"].get("records_projected", 0)))
    assert not engine.JOBS_PATH.exists(), "DEV must not publish a legacy jobs snapshot"


def validate_result():
    if orchestration.nile_only_dev_retrieve():
        validate_dev_output()
    else:
        engine.validate_output()


def verify_dev_worker_ownership(env=None, storage=None):
    """No canonical Cloud Run DEV collector/recovery writes without its owned lock."""
    env=dict(os.environ if env is None else env)
    if env.get("APP_ENV")!="dev" or env.get("CLOUD_RUN_JOB")!="jscc-search-dev":
        return
    from gcp_dev_run_supervisor import admit, Storage, LOCK, ACTIVE
    run_id=admit(env)
    store=storage or Storage(env["GCP_RUNTIME_BUCKET"])
    _, lock=store.read(LOCK)
    _, active=store.read(ACTIVE)
    if (lock!=active or lock.get("run_id")!=run_id
            or lock.get("source_sha")!=env["SOURCE_SHA"]
            or (lock.get("request_signature") or "")!=env.get("JSCC_REQUEST_SIGNATURE","")
            or (lock.get("retrieve_scope") or {})!=json.loads(env.get("JSCC_RETRIEVE_SCOPE_JSON") or "{}")):
        raise RuntimeError("DEV worker run ownership denied")


def main() -> int:
    if "--validate-only" not in sys.argv:
        verify_dev_worker_ownership()
    if "--persist-recovery-status" in sys.argv:
        # Supervisor invokes this only after confirming the owned DEV lock.
        # A fresh process can repair a terminal failure even when collection
        # exited before its ordinary terminal persistence.
        if not orchestration.nile_only_dev_retrieve():
            raise RuntimeError("Recovery persistence is DEV-only")
        status = json.loads(engine.STATUS_PATH.read_text(encoding="utf-8"))
        if status.get("run_id") != os.environ.get("JSCC_RUN_ID") or status.get("status") != "failed":
            raise RuntimeError("Recovery status ownership or phase mismatch")
        persist_terminal_evidence()
        validate_history()
        return 0
    if "--validate-only" in sys.argv:
        validate_result()
        optimized.validate_state()
        validate_history()
        print("Configuration, JSON contracts, history and state valid")
        return 0

    now = datetime.now(timezone.utc)
    run_id, request_signature, retrieve_scope = retrieve_context(now)
    try:
        # A scoped UI refresh owns its criteria; the runtime seed does not represent a user profile.
        if retrieve_scope:
            seed = json.loads(engine.CONFIG_PATH.read_text(encoding="utf-8"))
            scoped = shared_corpus.shared_collection_config(seed, retrieve_scope, request_signature)
            scoped["schema_version"] = seed.get("schema_version")
            config = engine.load_config(scoped)
        else:
            config = engine.load_config()
        config = shared_corpus.apply_collection_policy(config)
        shared_corpus.persist_run_started(
            run_id,
            now,
            {
                "request_signature": request_signature,
                "retrieve_scope": retrieve_scope,
                "trigger": os.environ.get("RUN_TRIGGER") or os.environ.get("GITHUB_EVENT_NAME") or "unknown",
                "source_sha": (os.environ.get("SOURCE_SHA") or "").strip().lower() or None,
            },
        )
        code = orchestration.run(
            config,
            now,
            run_id=run_id,
            retrieve_scope=retrieve_scope,
            request_signature=request_signature,
        )
    except Exception as exc:
        terminal_failure_status(now, run_id, request_signature, retrieve_scope, exc)
        persist_terminal_evidence()
        stamp_jobs_provenance()
        validate_history()
        print(f"Run failed: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 2

    persist_terminal_evidence()
    stamp_jobs_provenance()
    if code == 0:
        validate_result()
    optimized.validate_state()
    validate_history()
    return code


if __name__ == "__main__":
    raise SystemExit(main())
