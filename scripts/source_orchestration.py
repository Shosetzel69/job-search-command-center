"""Catalog-driven collection using the existing CollectionResult contract."""

import json
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from urllib.parse import urlsplit

import job_search as engine
import job_search_apify as apify
import job_search_jobicy as jobicy
import job_search_web as web
import job_search_optimized as optimized

REGISTRY = json.loads((engine.ROOT / "shared/source-connectors.json").read_text())
SOURCES_PATH = engine.DATA / "sources.json"
COUNTERS = ("sources_configured", "sources_active", "sources_attempted", "sources_succeeded",
            "sources_failed", "sources_unsupported", "sources_skipped", "sources_inactive")


def connector_for(source):
    try:
        parsed = urlsplit(source.get("url") or "")
        if parsed.scheme != "https" or parsed.username or parsed.password or parsed.port:
            return None
        return next((key for key, spec in REGISTRY.items() if parsed.hostname in spec["hosts"]), None)
    except ValueError:
        return None


def build_plan(catalog):
    if not isinstance(catalog, dict) or not isinstance(catalog.get("sources"), list):
        raise ValueError("Source catalog must contain a sources array")
    plan = []
    seen = set()
    for source in catalog["sources"]:
        connector = connector_for(source)
        if not connector:
            try:
                web.public_url(source.get("url") or "")
                connector = "web"
            except web.FetchError:
                connector = None
        route_key = source.get("url") if connector == "web" else connector
        item = {"source": source.get("name") or source.get("url") or "Unknown",
                "source_id": source.get("id") or source.get("url"), "url": source.get("url"), "connector": connector,
                "active": source.get("active") is not False, "status": "pending",
                "records": 0, "error": None}
        if not item["active"]:
            item.update(status="inactive", error="Disabled in source catalog")
        elif not connector:
            item.update(status="unsupported", error="Invalid or unsafe source URL")
        elif route_key in seen:
            item.update(status="skipped", error="Duplicate provider endpoint already planned")
        else:
            seen.add(route_key)
        plan.append(item)
    return plan


def collect_sources(config, state, now, plan):
    # Web sources execute independently; slow sites cannot starve the rest of the catalog.
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
            record_results(item, results)
            collection.extend(results)
    return collection, metadata, mode


def record_results(item, results):
    item["status"] = "completed" if results and all(result.ok for result in results) else "failed"
    item["records"] = sum(len(result.records) for result in results if result.ok)
    item["error"] = "; ".join(result.error or "Collection failed" for result in results if not result.ok) or None
    item["queries"] = [{"query": r.query, "status": "completed" if r.ok else "failed",
                        "records": len(r.records), "error": r.error} for r in results]


def collect_api_sources(config, state, now, plan):
    collection = []
    metadata = {}
    mode = str(config.get("jobspipe_mode") or ("direct" if config.get("jobspipe_enabled", True) else "disabled")).lower()
    for item in plan:
        if item["status"] != "pending" or item["connector"] == "web":
            continue
        connector = item["connector"]
        if connector == "jobspipe" and mode == "disabled":
            item.update(status="skipped", error="JobsPipe disabled by configuration")
            continue
        if connector == "jobspipe" and mode == "direct" and state.get("usage", {}).get("provider_quota_exhausted_month") == now.strftime("%Y-%m"):
            item.update(status="skipped", error="JobsPipe direct monthly quota exhausted; no API call")
            continue
        if connector == "jobicy":
            last = engine.parse_posted_datetime(state.get("source_last_attempt", {}).get(connector))
            if last and (now - last).total_seconds() < 3600:
                item.update(status="skipped", error="Jobicy hourly polling limit; no API call")
                continue
            state.setdefault("source_last_attempt", {})[connector] = now.isoformat()
        try:
            if connector == "jobicy":
                results = jobicy.collect(config)
            elif mode == "apify":
                results = apify.collect(config)
            elif mode == "direct":
                results, credits, previews, budget = optimized.collect_incremental(config, state, now)
                metadata = {"credits_used": credits, "preview_counts": previews, "run_budget": budget,
                            "estimated_monthly_credits": state.get("usage", {}).get("estimated_credits_used", 0)}
            else:
                raise ValueError(f"Unsupported jobspipe_mode: {mode}")
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
    status["limitations"] = [f'{item["source"]}: {item["error"]}' for item in plan if item["status"] in {"skipped", "unsupported"}]
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
