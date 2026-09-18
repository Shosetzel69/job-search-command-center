"""Catalog-driven collection using the existing CollectionResult contract."""

import hashlib
import json
import socket
from concurrent.futures import ThreadPoolExecutor
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit

import diagnostics
import job_search as engine
import job_search_apify as apify
import job_search_ashby as ashby
import job_search_bamboohr as bamboohr
import job_search_greenhouse as greenhouse
import job_search_jobicy as jobicy
import job_search_recruitee as recruitee
import job_search_smartrecruiters as smartrecruiters
import job_search_web as web
import job_search_workday as workday
import job_search_optimized as optimized

REGISTRY = json.loads((engine.ROOT / "shared/source-connectors.json").read_text())
ATS_ROUTES = json.loads((engine.ROOT / "shared/validated-ats-routes.json").read_text()).get("routes", {})
SOURCES_PATH = engine.DATA / "sources.json"
COUNTERS = ("sources_configured", "sources_active", "sources_attempted", "sources_succeeded",
            "sources_failed", "sources_unsupported", "sources_skipped", "sources_inactive", "sources_with_records", "sources_partial",
            "sources_blocked", "sources_no_extractable_jobs")
POLICY_EXCLUDED_SOURCE_NAMES = {"monster"}

DEFERRED_PROVIDER_ROOTS = {
    "linkedin.com": ("LinkedIn", "jobs"),
    "www.linkedin.com": ("LinkedIn", "jobs"),
    "indeed.com": ("Indeed", "root"),
    "www.indeed.com": ("Indeed", "root"),
    "www.workday.com": ("Workday", "root"),
    "workday.com": ("Workday", "root"),
    "www.greenhouse.com": ("Greenhouse", "root"),
    "greenhouse.com": ("Greenhouse", "root"),
    "jobs.workable.com": ("Workable", "root"),
    "www.smartrecruiters.com": ("SmartRecruiters", "root"),
    "smartrecruiters.com": ("SmartRecruiters", "root"),
    "jobs.ashbyhq.com": ("Ashby", "root"),
    "www.lever.co": ("Lever", "root"),
    "lever.co": ("Lever", "root"),
}


def policy_excluded(source):
    return str(source.get("name") or "").strip().casefold() in POLICY_EXCLUDED_SOURCE_NAMES


def connector_for(source):
    route = ATS_ROUTES.get(source.get("name"))
    if route:
        return route.get("connector")
    try:
        parsed = urlsplit(source.get("url") or "")
        if parsed.scheme != "https" or parsed.username or parsed.password or parsed.port:
            return None
        return next((key for key, spec in REGISTRY.items() if parsed.hostname in spec["hosts"]), None)
    except ValueError:
        return None


def deferred_provider(source):
    if source.get("name") in ATS_ROUTES:
        return None
    try:
        parsed = urlsplit(source.get("url") or "")
        spec = DEFERRED_PROVIDER_ROOTS.get((parsed.hostname or "").lower())
        if not spec:
            return None
        provider, scope = spec
        path = (parsed.path or "/").rstrip("/") or "/"
        if scope == "root" and path == "/":
            return provider
        if scope == "jobs" and (path == "/jobs" or path.startswith("/jobs/")):
            return provider
        return None
    except ValueError:
        return None


class ClassifiedSourceError(Exception):
    def __init__(self, message, error_code, failure_stage, http_status=None):
        super().__init__(message)
        self.error_code = error_code
        self.failure_stage = failure_stage
        self.http_status = http_status


CANONICAL_OUTCOMES = {
    "success",
    "success_empty",
    "failed",
    "deferred_provider",
    "blocked_credentials",
    "validation_pending",
    "disabled_config",
    "excluded_policy",
    "skipped",
}


def error_code_for_http_status(status):
    if not isinstance(status, int):
        return None
    if status == 401:
        return "AUTH_REQUIRED"
    if status == 403:
        return "ACCESS_DENIED"
    if status == 429:
        return "RATE_LIMITED"
    if 400 <= status < 500:
        return "HTTP_CLIENT_ERROR"
    if status >= 500:
        return "HTTP_SERVER_ERROR"
    return None


def classify_exception(exc):
    if isinstance(exc, ClassifiedSourceError):
        return exc.error_code, exc.failure_stage, exc.http_status
    if isinstance(exc, HTTPError):
        code = error_code_for_http_status(exc.code) or "HTTP_CLIENT_ERROR"
        stage = "authentication" if exc.code in {401, 403} else "fetch"
        return code, stage, exc.code
    if isinstance(exc, json.JSONDecodeError):
        return "PARSE_ERROR", "parse", None
    if isinstance(exc, socket.gaierror):
        return "DNS_ERROR", "fetch", None
    if isinstance(exc, (TimeoutError, socket.timeout)):
        return "TIMEOUT", "fetch", None
    if isinstance(exc, URLError):
        reason = exc.reason
        if isinstance(reason, socket.gaierror):
            return "DNS_ERROR", "fetch", None
        if isinstance(reason, (TimeoutError, socket.timeout)):
            return "TIMEOUT", "fetch", None
        return "NETWORK_ERROR", "fetch", None
    if isinstance(exc, ConnectionError):
        return "NETWORK_ERROR", "fetch", None
    if isinstance(exc, ValueError):
        return "SCHEMA_ERROR", "parse", None
    if isinstance(exc, RuntimeError):
        return "CONNECTOR_ERROR", "fetch", None
    return "UNEXPECTED_ERROR", "fetch", None


def failure_result(connector, query, exc):
    error_code, failure_stage, http_status = classify_exception(exc)
    return engine.CollectionResult(
        connector,
        query,
        False,
        [],
        0,
        diagnostics.sanitize_text(exc),
        error_code=error_code,
        failure_stage=failure_stage,
        http_status=http_status,
    )


def disabled_route_outcome(reason):
    if reason == "connector_requires_credentials":
        return "blocked_credentials"
    if reason == "live_api_route_not_validated":
        return "validation_pending"
    return "disabled_config"


def prepare_source_execution_ids(plan, run_id):
    for index, item in enumerate(plan):
        if item.get("source_execution_id"):
            continue
        raw_identity = f"{run_id}\0{item.get('source_id')}\0{index}".encode("utf-8")
        item["source_execution_id"] = hashlib.sha256(raw_identity).hexdigest()[:24]


def finalize_source_outcomes(plan, run_id):
    prepare_source_execution_ids(plan, run_id)
    for item in plan:
        if not item.get("outcome"):
            if item.get("status") == "completed":
                item["outcome"] = "success" if item.get("records", 0) else "success_empty"
            elif item.get("status") == "failed":
                item["outcome"] = "failed"
                item["error_code"] = item.get("error_code") or "UNEXPECTED_ERROR"
                item["failure_stage"] = item.get("failure_stage") or "postprocess"
            else:
                item["outcome"] = "skipped"
        if item["outcome"] not in CANONICAL_OUTCOMES:
            raise ValueError(f"Unsupported source outcome: {item['outcome']}")
        if item["outcome"] != "failed":
            item["error_code"] = None
            item["failure_stage"] = None


def emit_source_started(run_id, item):
    diagnostics.emit_event(
        "source.collection.started",
        "INFO",
        run_id=run_id,
        **diagnostics.source_fields(item),
        attempt=1,
    )


def emit_source_final(run_id, item):
    outcome = item.get("outcome")
    if outcome in {"success", "success_empty"}:
        event_name = "source.collection.completed"
    elif outcome == "failed":
        event_name = "source.collection.failed"
    else:
        event_name = "source.collection.skipped"
    diagnostics.emit_event(
        event_name,
        diagnostics.source_level(item),
        run_id=run_id,
        **diagnostics.source_fields(item),
        outcome=outcome,
        legacy_status=item.get("status"),
        records=item.get("records", 0),
        error_code=item.get("error_code"),
        failure_stage=item.get("failure_stage"),
        http_status=item.get("http_status"),
        message=item.get("error") or item.get("failure_reason"),
        attempt=1,
    )


def aggregate_source_results(plan):
    outcome_counts = {}
    error_code_counts = {}
    failure_stage_counts = {}
    for item in plan:
        outcome = item.get("outcome") or "unknown"
        outcome_counts[outcome] = outcome_counts.get(outcome, 0) + 1
        if outcome != "failed":
            continue
        error_code = item.get("error_code") or "UNEXPECTED_ERROR"
        failure_stage = item.get("failure_stage") or "postprocess"
        error_code_counts[error_code] = error_code_counts.get(error_code, 0) + 1
        failure_stage_counts[failure_stage] = failure_stage_counts.get(failure_stage, 0) + 1
    return {
        "source_outcome_counts": dict(sorted(outcome_counts.items())),
        "source_failure_codes": dict(sorted(error_code_counts.items())),
        "source_failure_stages": dict(sorted(failure_stage_counts.items())),
    }


def build_plan(catalog):
    if not isinstance(catalog, dict) or not isinstance(catalog.get("sources"), list):
        raise ValueError("Source catalog must contain a sources array")
    plan = []
    seen = set()
    for source in catalog["sources"]:
        route = ATS_ROUTES.get(source.get("name"))
        connector = connector_for(source)
        deferred = None if connector else deferred_provider(source)
        if not connector and not deferred:
            try:
                web.public_url(source.get("url") or "")
                connector = "web"
            except web.FetchError:
                connector = None
        if route:
            route_key = "ats:" + source.get("name", "")
        else:
            route_key = source.get("url") if connector == "web" else connector or ("deferred:" + deferred if deferred else None)
        excluded_by_policy = policy_excluded(source)
        item = {"source": source.get("name") or source.get("url") or "Unknown",
                "source_id": source.get("id") or source.get("url"), "url": source.get("url"),
                "connector": "deferred" if deferred else connector,
                "collection_method": "deferred" if deferred else connector,
                "active": source.get("active") is not False and not excluded_by_policy, "status": "pending",
                "outcome": None, "source_execution_id": None,
                "records": 0, "error": None, "failure_reason": None,
                "error_code": None, "failure_stage": None, "http_status": None,
                "policy_excluded": excluded_by_policy}
        if excluded_by_policy:
            reason = "Excluded operationally by project source policy"
            item.update(status="inactive", outcome="excluded_policy", error=reason, failure_reason=reason)
        if route:
            item["connector_config"] = route
            if route.get("enabled") is False:
                item["active"] = False
                reason = route.get("disabled_reason") or "ATS route disabled"
                item.update(status="inactive", outcome=disabled_route_outcome(reason),
                            error=reason, failure_reason=reason)
        if item["status"] == "pending" and not item["active"]:
            item.update(status="inactive", outcome="disabled_config",
                        error="Disabled in source catalog", failure_reason="Disabled in source catalog")
        elif item["status"] == "pending" and deferred:
            reason = f"{deferred} provider root deferred; generic web crawling disabled while dedicated provider route is postponed"
            item.update(status="skipped", outcome="deferred_provider",
                        error=reason, failure_reason=reason, deferred_provider=deferred)
        elif item["status"] == "pending" and not connector:
            item.update(status="unsupported", outcome="failed", error="Invalid or unsafe source URL",
                        failure_reason="Invalid or unsafe source URL", error_code="CONFIG_ERROR",
                        failure_stage="preflight")
        elif item["status"] == "pending" and route_key in seen:
            item.update(status="skipped", outcome="skipped",
                        error="Duplicate provider endpoint already planned",
                        failure_reason="Duplicate provider endpoint already planned")
        elif item["status"] == "pending":
            seen.add(route_key)
        plan.append(item)
    return plan


def collect_sources(config, state, now, plan, run_id=None):
    run_id = run_id or ("github-" + now.strftime("%Y%m%dT%H%M%SZ"))
    prepare_source_execution_ids(plan, run_id)
    with ThreadPoolExecutor(max_workers=12) as pool:
        futures = {}
        for item in plan:
            if item["connector"] != "web" or item["status"] != "pending":
                continue
            emit_source_started(run_id, item)
            futures[item["source_id"]] = pool.submit(
                web.collect,
                {"id": item["source_id"], "name": item["source"], "url": item["url"]},
                config,
                now,
            )
        collection, metadata, mode = collect_api_sources(config, state, now, plan, run_id)
        for item in plan:
            if item["connector"] != "web" or item["status"] != "pending":
                continue
            try:
                results, details = futures[item["source_id"]].result()
                item.update(details)
            except Exception as exc:
                results = [failure_result("web:" + str(item["source_id"]), "collect", exc)]
                item["web_outcome"] = "error"
                item["failure_reason"] = diagnostics.sanitize_text(exc)
            record_results(item, results)
            collection.extend(results)
    return collection, metadata, mode


def record_results(item, results):
    failed = [result for result in results if not result.ok]
    item["status"] = "completed" if results and not failed else "failed"
    item["records"] = sum(len(result.records) for result in results if result.ok)
    item["error"] = "; ".join(
        diagnostics.sanitize_text(result.error or "Collection failed") for result in failed
    ) or None
    if not results:
        item["outcome"] = "failed"
        item["error"] = item["error"] or "Connector returned no collection result"
        item["failure_reason"] = item.get("failure_reason") or item["error"]
        item["error_code"] = "CONNECTOR_ERROR"
        item["failure_stage"] = "fetch"
        item["http_status"] = None
    elif failed:
        item["outcome"] = "failed"
        first = failed[0]
        http_status = first.http_status if first.http_status is not None else item.get("http_status")
        item["http_status"] = http_status
        item["error_code"] = first.error_code or error_code_for_http_status(http_status) or "CONNECTOR_ERROR"
        item["failure_stage"] = first.failure_stage or "fetch"
    else:
        item["outcome"] = "success" if item["records"] else "success_empty"
        item["error_code"] = None
        item["failure_stage"] = None
    if item.get("error") and not item.get("failure_reason"):
        item["failure_reason"] = item["error"]
    item["queries"] = [{
        "query": result.query,
        "status": "completed" if result.ok else "failed",
        "outcome": ("success" if result.records else "success_empty") if result.ok else "failed",
        "records": len(result.records),
        "error": diagnostics.sanitize_text(result.error) if result.error else None,
        "error_code": None if result.ok else (result.error_code or "CONNECTOR_ERROR"),
        "failure_stage": None if result.ok else (result.failure_stage or "fetch"),
        "http_status": result.http_status,
    } for result in results]


def collect_ats(item):
    route = item.get("connector_config") or {}
    connector = item["connector"]
    company = item["source"]
    if connector == "smartrecruiters":
        return smartrecruiters.collect(route["company_identifier"])
    if connector == "workday":
        return workday.collect(route["career_url"], company)
    if connector == "greenhouse":
        return greenhouse.collect(route["board_token"], company)
    if connector == "ashby":
        return ashby.collect(route["board_name"], company)
    if connector == "recruitee":
        return recruitee.collect(route["subdomain"], company)
    if connector == "bamboohr":
        return bamboohr.collect(route["subdomain"], company)
    raise ValueError(f"Unsupported ATS connector: {connector}")


def collect_api_sources(config, state, now, plan, run_id=None):
    collection = []
    metadata = {}
    mode = str(config.get("jobspipe_mode") or ("direct" if config.get("jobspipe_enabled", True) else "disabled")).lower()
    ats_connectors = {"smartrecruiters", "workday", "greenhouse", "ashby", "recruitee", "bamboohr"}
    for item in plan:
        if item["status"] != "pending" or item["connector"] == "web":
            continue
        connector = item["connector"]
        if connector == "jobspipe" and mode == "disabled":
            item.update(status="skipped", outcome="disabled_config",
                        error="JobsPipe disabled by configuration",
                        failure_reason="JobsPipe disabled by configuration")
            continue
        if connector == "jobspipe" and mode == "direct" and state.get("usage", {}).get("provider_quota_exhausted_month") == now.strftime("%Y-%m"):
            item.update(status="skipped", outcome="skipped",
                        error="JobsPipe direct monthly quota exhausted; no API call",
                        failure_reason="JobsPipe direct monthly quota exhausted; no API call")
            continue
        if connector == "jobicy":
            last = engine.parse_posted_datetime(state.get("source_last_attempt", {}).get(connector))
            if last and (now - last).total_seconds() < 3600:
                item.update(status="skipped", outcome="skipped",
                            error="Jobicy hourly polling limit; no API call",
                            failure_reason="Jobicy hourly polling limit; no API call")
                continue
            state.setdefault("source_last_attempt", {})[connector] = now.isoformat()
        if run_id:
            emit_source_started(run_id, item)
        try:
            if connector in ats_connectors:
                results = collect_ats(item)
            elif connector == "jobicy":
                results = jobicy.collect(config)
            elif connector == "jobspipe" and mode == "apify":
                results = apify.collect(config)
            elif connector == "jobspipe" and mode == "direct":
                results, credits, previews, budget = optimized.collect_incremental(config, state, now)
                metadata = {"credits_used": credits, "preview_counts": previews, "run_budget": budget,
                            "estimated_monthly_credits": state.get("usage", {}).get("estimated_credits_used", 0)}
            else:
                raise ClassifiedSourceError(
                    f"Unsupported connector: {connector}",
                    "CONFIG_ERROR",
                    "route_resolution",
                )
            if not results:
                raise ClassifiedSourceError(
                    "Connector returned no collection result",
                    "CONNECTOR_ERROR",
                    "fetch",
                )
        except Exception as exc:
            results = [failure_result(connector, "collect", exc)]
        collection.extend(results)
        record_results(item, results)
        if connector == "jobspipe" and mode == "direct" and "Monthly request quota exceeded" in (item["error"] or ""):
            state.setdefault("usage", {})["provider_quota_exhausted_month"] = now.strftime("%Y-%m")
    return collection, metadata, mode


def run(config, now):
    state = optimized.load_state(now)
    run_id = "github-" + now.strftime("%Y%m%dT%H%M%SZ")
    plan = build_plan(json.loads(SOURCES_PATH.read_text(encoding="utf-8")))
    prepare_source_execution_ids(plan, run_id)
    diagnostics.emit_event(
        "search.run.started",
        "INFO",
        run_id=run_id,
        source_strategy=config.get("source_strategy") or "all active sources equally",
        sources_configured=len(plan),
        sources_active=sum(item["active"] for item in plan),
    )
    collection, metadata, mode = collect_sources(config, state, now, plan, run_id)
    successful = any(result.ok for result in collection)
    if successful:
        output = engine.process_records(config, collection, now)
        output = optimized.merge_with_existing(output, state, config, now)
        output["incremental_sync"] = mode == "direct"
        engine.JOBS_PATH.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        published, excluded = output["results"], output["excluded_count"]
    else:
        current = json.loads(engine.JOBS_PATH.read_text()) if engine.JOBS_PATH.exists() else {}
        published, excluded = len(current.get("jobs") or []), 0
    engine.write_status(now, collection, published, excluded)
    if mode == "apify" and any(item["connector"] == "jobspipe" and item["status"] in {"completed", "failed"} for item in plan):
        apify.update_status([r for r in collection if r.connector.startswith("jobspipe")],
                            max(100, min(20000, int(config.get("jobspipe_apify_max_items_per_run", 5000)))))
    status = json.loads(engine.STATUS_PATH.read_text())
    finalize_source_outcomes(plan, status["run_id"])
    status["source_outcome_schema_version"] = "1.0"
    status.update(aggregate_source_results(plan))
    attempted = [item for item in plan if item["status"] in {"completed", "failed"}]
    status.update({"source_strategy": config.get("source_strategy") or "all active sources equally",
                   "sources_configured": len(plan), "sources_active": sum(item["active"] for item in plan),
                   "sources_attempted": len(attempted), "sources_processed": len(attempted),
                   "sources": [item["source"] for item in attempted], "source_results": plan,
                   "failed_sources": [item["source"] for item in plan if item["status"] == "failed"]})
    for field, value in (("succeeded", "completed"), ("failed", "failed"), ("unsupported", "unsupported"),
                         ("skipped", "skipped"), ("inactive", "inactive")):
        status["sources_" + field] = sum(item["status"] == value for item in plan)
    status["sources_with_records"] = sum(item["records"] > 0 for item in plan)
    for outcome in ("partial", "blocked", "no_extractable_jobs"):
        status["sources_" + outcome] = sum(item.get("web_outcome") == outcome for item in plan)
    status["limitations"] = [f'{item["source"]}: {item["error"]}' for item in plan if item["status"] in {"skipped", "unsupported", "inactive"} and item.get("error")]
    if not collection and not status["sources_unsupported"]:
        status["status"] = "completed"
    if successful and (status["sources_failed"] or status["sources_unsupported"]):
        status["status"] = "completed_with_errors"
    status.setdefault("jobspipe_transport", {"mode": mode})
    status["jobspipe_transport"]["provider_enabled"] = any(item["connector"] == "jobspipe" and item["active"] for item in plan) and mode != "disabled"
    if metadata:
        status["jobspipe_optimization"] = metadata
    engine.STATUS_PATH.write_text(json.dumps(status, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    optimized.save_state(state)

    for item in plan:
        emit_source_final(run_id, item)

    run_level = "ERROR" if status["status"] == "failed" else ("WARN" if status["status"] == "completed_with_errors" else "INFO")
    diagnostics.emit_event(
        "search.run.completed",
        run_level,
        run_id=run_id,
        status=status["status"],
        records_inspected=status.get("records_inspected", 0),
        jobs_published=status.get("jobs_published", 0),
        excluded=status.get("excluded", 0),
        **{field: status[field] for field in COUNTERS},
    )
    print(json.dumps({field: status[field] for field in COUNTERS}))
    return 2 if status["status"] == "failed" else 0
