"""Catalog-driven collection using the existing CollectionResult contract."""

import json
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlsplit

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
        item = {"source": source.get("name") or source.get("url") or "Unknown",
                "source_id": source.get("id") or source.get("url"), "url": source.get("url"),
                "connector": "deferred" if deferred else connector,
                "collection_method": "deferred" if deferred else connector,
                "active": source.get("active") is not False, "status": "pending",
                "records": 0, "error": None, "failure_reason": None}
        if route:
            item["connector_config"] = route
            if route.get("enabled") is False:
                item["active"] = False
                reason = route.get("disabled_reason") or "ATS route disabled"
                item.update(status="inactive", error=reason, failure_reason=reason)
        if item["status"] == "pending" and not item["active"]:
            item.update(status="inactive", error="Disabled in source catalog", failure_reason="Disabled in source catalog")
        elif item["status"] == "pending" and deferred:
            reason = f"{deferred} provider root deferred; generic web crawling disabled while dedicated provider route is postponed"
            item.update(status="skipped", error=reason, failure_reason=reason, deferred_provider=deferred)
        elif item["status"] == "pending" and not connector:
            item.update(status="unsupported", error="Invalid or unsafe source URL", failure_reason="Invalid or unsafe source URL")
        elif item["status"] == "pending" and route_key in seen:
            item.update(status="skipped", error="Duplicate provider endpoint already planned",
                        failure_reason="Duplicate provider endpoint already planned")
        elif item["status"] == "pending":
            seen.add(route_key)
        plan.append(item)
    return plan


def collect_sources(config, state, now, plan):
    with ThreadPoolExecutor(max_workers=12) as pool:
        futures = {item["source_id"]: pool.submit(web.collect, {"id": item["source_id"], "name": item["source"], "url": item["url"]}, config, now)
                   for item in plan if item["connector"] == "web" and item["status"] == "pending"}
        collection, metadata, mode = collect_api_sources(config, state, now, plan)
        for item in plan:
            if item["connector"] != "web" or item["status"] != "pending":
                continue
            try:
                results, details = futures[item["source_id"]].result()
                item.update(details)
            except Exception as exc:
                results = [engine.CollectionResult("web:" + str(item["source_id"]), "collect", False, [], 0, str(exc))]
                item["web_outcome"] = "error"
                item["failure_reason"] = str(exc)
            record_results(item, results)
            collection.extend(results)
    return collection, metadata, mode


def record_results(item, results):
    item["status"] = "completed" if results and all(result.ok for result in results) else "failed"
    item["records"] = sum(len(result.records) for result in results if result.ok)
    item["error"] = "; ".join(result.error or "Collection failed" for result in results if not result.ok) or None
    if item.get("error") and not item.get("failure_reason"):
        item["failure_reason"] = item["error"]
    item["queries"] = [{"query": r.query, "status": "completed" if r.ok else "failed",
                        "records": len(r.records), "error": r.error} for r in results]


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


def collect_api_sources(config, state, now, plan):
    collection = []
    metadata = {}
    mode = str(config.get("jobspipe_mode") or ("direct" if config.get("jobspipe_enabled", True) else "disabled")).lower()
    ats_connectors = {"smartrecruiters", "workday", "greenhouse", "ashby", "recruitee", "bamboohr"}
    for item in plan:
        if item["status"] != "pending" or item["connector"] == "web":
            continue
        connector = item["connector"]
        if connector == "jobspipe" and mode == "disabled":
            item.update(status="skipped", error="JobsPipe disabled by configuration",
                        failure_reason="JobsPipe disabled by configuration")
            continue
        if connector == "jobspipe" and mode == "direct" and state.get("usage", {}).get("provider_quota_exhausted_month") == now.strftime("%Y-%m"):
            item.update(status="skipped", error="JobsPipe direct monthly quota exhausted; no API call",
                        failure_reason="JobsPipe direct monthly quota exhausted; no API call")
            continue
        if connector == "jobicy":
            last = engine.parse_posted_datetime(state.get("source_last_attempt", {}).get(connector))
            if last and (now - last).total_seconds() < 3600:
                item.update(status="skipped", error="Jobicy hourly polling limit; no API call",
                            failure_reason="Jobicy hourly polling limit; no API call")
                continue
            state.setdefault("source_last_attempt", {})[connector] = now.isoformat()
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
                raise ValueError(f"Unsupported connector: {connector}")
            if not results:
                raise ValueError("Connector returned no collection result")
        except Exception as exc:
            results = [engine.CollectionResult(connector, "collect", False, [], 0, str(exc))]
        collection.extend(results)
        record_results(item, results)
        if connector == "jobspipe" and mode == "direct" and "Monthly request quota exceeded" in (item["error"] or ""):
            state.setdefault("usage", {})["provider_quota_exhausted_month"] = now.strftime("%Y-%m")
    return collection, metadata, mode


def run(config, now):
    state = optimized.load_state(now)
    plan = build_plan(json.loads(SOURCES_PATH.read_text(encoding="utf-8")))
    collection, metadata, mode = collect_sources(config, state, now, plan)
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
    print(json.dumps({field: status[field] for field in COUNTERS}))
    return 2 if status["status"] == "failed" else 0
