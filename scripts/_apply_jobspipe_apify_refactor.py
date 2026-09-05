#!/usr/bin/env python3
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, content: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


def regex_once(text: str, pattern: str, replacement: str, label: str) -> str:
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one regex match, found {count}")
    return updated


# ---------------------------------------------------------------------------
# Canonical configuration
# ---------------------------------------------------------------------------
config_path = ROOT / "data/search-config.json"
config = json.loads(config_path.read_text(encoding="utf-8"))
config.pop("jobspipe_enabled", None)
config["jobspipe_mode"] = "disabled"
config["jobspipe_apify_max_items_per_run"] = 5000
config.setdefault("jobspipe_credit_budget_per_run", 14)
config.setdefault("jobspipe_monthly_credit_guard", 950)
config.setdefault("jobspipe_incremental_overlap_minutes", 2)
config_path.write_text(json.dumps(config, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


# ---------------------------------------------------------------------------
# Apify transport
# ---------------------------------------------------------------------------
apify_module = r'''#!/usr/bin/env python3
"""JobsPipe collection through the official Apify Actor transport.

The Actor wraps JobsPipe's production search endpoint and returns the same
normalized JobsPipe records. This module only owns transport/orchestration;
normalization, filtering, deduplication and scoring stay in job_search.py.
"""

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
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "User-Agent": "job-search-command-center/1.0",
        },
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

    payload_out = json.loads(body)
    if isinstance(payload_out, list):
        return [item for item in payload_out if isinstance(item, dict)]
    if isinstance(payload_out, dict) and isinstance(payload_out.get("items"), list):
        return [item for item in payload_out["items"] if isinstance(item, dict)]
    raise RuntimeError("Apify response does not contain a dataset item array")


def _query_specs(config: dict[str, Any]) -> list[tuple[str, dict[str, Any]]]:
    titles = engine.configured_titles(config)
    if not titles:
        raise RuntimeError("No enabled role titles")

    priority = list(dict.fromkeys(config.get("search_country_codes") or []))
    priority_set = set(priority)
    remote_europe = [
        code for code in dict.fromkeys(config.get("eligible_remote_country_codes") or [])
        if code not in priority_set
    ]
    collection_hours = int(config.get("collection_freshness_hours", config.get("freshness_hours", 24)))
    posted_days = max(1, math.ceil(collection_hours / 24))
    max_items = max(100, min(20000, int(config.get("jobspipe_apify_max_items_per_run", 5000))))

    if priority and remote_europe:
        priority_limit = max(1, int(round(max_items * 0.4)))
        remote_limit = max(1, max_items - priority_limit)
    elif priority:
        priority_limit, remote_limit = max_items, 0
    else:
        priority_limit, remote_limit = 0, max_items

    common = {
        "searchTerms": titles,
        "postedWithinDays": posted_days,
    }
    specs: list[tuple[str, dict[str, Any]]] = []
    if priority_limit:
        specs.append(("priority_geography", {**common, "countries": priority, "maxItems": priority_limit}))
    if remote_limit and remote_europe:
        specs.append(("remote_europe", {**common, "countries": remote_europe, "remote": True, "maxItems": remote_limit}))
    if not specs:
        raise RuntimeError("No eligible JobsPipe Apify query could be built")
    return specs


def collect(config: dict[str, Any]) -> list[engine.CollectionResult]:
    token = os.environ.get("APIFY_TOKEN", "")
    results: list[engine.CollectionResult] = []
    try:
        specs = _query_specs(config)
    except Exception as exc:
        return [engine.CollectionResult("jobspipe-apify", "configuration", False, [], 0, str(exc))]

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
        jobs_published = output["results"]
        excluded = output["excluded_count"]
        optimized.save_state(state)
    else:
        jobs_published = current_job_count()
        excluded = 0

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
'''
write("scripts/job_search_apify.py", apify_module)


# ---------------------------------------------------------------------------
# Runner mode dispatcher
# ---------------------------------------------------------------------------
runner = r'''#!/usr/bin/env python3
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
'''
write("scripts/job_search_runner.py", runner)


# ---------------------------------------------------------------------------
# Core config validation + generic status wording
# ---------------------------------------------------------------------------
engine_text = read("scripts/job_search.py")
engine_text = replace_once(
    engine_text,
    '    if not isinstance(config.get("work_modes"), dict):\n        raise RuntimeError("work_modes must be an object")\n    return config\n',
    '    if not isinstance(config.get("work_modes"), dict):\n        raise RuntimeError("work_modes must be an object")\n    mode = str(config.get("jobspipe_mode") or ("direct" if config.get("jobspipe_enabled", True) else "disabled")).lower()\n    if mode not in {"disabled", "apify", "direct"}:\n        raise RuntimeError("jobspipe_mode must be disabled, apify or direct")\n    apify_max = int(config.get("jobspipe_apify_max_items_per_run", 5000))\n    if apify_max < 100 or apify_max > 20000:\n        raise RuntimeError("jobspipe_apify_max_items_per_run must be 100-20000")\n    return config\n',
    "engine config validation",
)
engine_text = replace_once(
    engine_text,
    '        "limitations": ["JobsPipe free-plan result cap applies to each query"],',
    '        "limitations": [],',
    "generic status limitations",
)
write("scripts/job_search.py", engine_text)


# ---------------------------------------------------------------------------
# Workflow secrets + syntax validation
# ---------------------------------------------------------------------------
workflow = read(".github/workflows/job-search-full.yml")
workflow = replace_once(
    workflow,
    '      - "scripts/job_search_optimized.py"\n      - "scripts/job_search_runner.py"',
    '      - "scripts/job_search_optimized.py"\n      - "scripts/job_search_apify.py"\n      - "scripts/job_search_runner.py"',
    "workflow paths",
)
workflow = replace_once(
    workflow,
    '      JOBSPIPE_API_KEY: ${{ secrets.JOBSPIPE_API_KEY }}',
    '      JOBSPIPE_API_KEY: ${{ secrets.JOBSPIPE_API_KEY }}\n      APIFY_TOKEN: ${{ secrets.APIFY_TOKEN }}',
    "workflow env",
)
workflow = replace_once(
    workflow,
    'run: python3 -m py_compile scripts/job_search.py scripts/job_search_optimized.py scripts/job_search_runner.py',
    'run: python3 -m py_compile scripts/job_search.py scripts/job_search_optimized.py scripts/job_search_apify.py scripts/job_search_runner.py',
    "workflow syntax validation",
)
write(".github/workflows/job-search-full.yml", workflow)


# ---------------------------------------------------------------------------
# Command API config contract
# ---------------------------------------------------------------------------
api_text = read("command-api/src/index.js")
new_validate = r'''function validateUserConfigPatch(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw Object.assign(new Error('Invalid configuration payload'), { status: 400 });
  }

  const output = {};
  const booleanKeys = [
    'rolePm', 'roleDelivery', 'roleService', 'roleScrum', 'roleProgram',
    'workRemote', 'workHybrid', 'keepReposts', 'immediateStart', 'jobspipeEnabled',
  ];

  for (const key of booleanKeys) {
    if (key in input) {
      if (typeof input[key] !== 'boolean') {
        throw Object.assign(new Error(`${key} must be boolean`), { status: 400 });
      }
      output[key] = input[key];
    }
  }

  if ('jobspipeMode' in input) {
    const value = String(input.jobspipeMode || '').toLowerCase();
    if (!['disabled', 'apify', 'direct'].includes(value)) {
      throw Object.assign(new Error('jobspipeMode must be disabled, apify or direct'), { status: 400 });
    }
    output.jobspipeMode = value;
  }

  const integerRules = {
    jobspipeApifyMaxItems: [100, 20000],
    jobspipeDirectRunBudget: [1, 1000],
    jobspipeDirectMonthlyGuard: [1, 100000],
  };
  for (const [key, [min, max]] of Object.entries(integerRules)) {
    if (key in input) {
      const value = Number(input[key]);
      if (!Number.isInteger(value) || value < min || value > max) {
        throw Object.assign(new Error(`${key} must be ${min}-${max}`), { status: 400 });
      }
      output[key] = value;
    }
  }

  if ('freshness' in input) {
    const value = Number(input.freshness);
    if (![24, 36, 48, 120].includes(value)) {
      throw Object.assign(new Error('freshness must be 24, 36, 48 or 120'), { status: 400 });
    }
    output.freshness = value;
  }

  if ('fitThreshold' in input) {
    const value = Number(input.fitThreshold);
    if (!Number.isInteger(value) || value < 50 || value > 100) {
      throw Object.assign(new Error('fitThreshold must be 50-100'), { status: 400 });
    }
    output.fitThreshold = value;
  }

  for (const key of ['rateMin', 'rateMax']) {
    if (key in input) {
      const value = Number(input[key]);
      if (!Number.isFinite(value) || value < 0 || value > 5000) {
        throw Object.assign(new Error(`${key} is invalid`), { status: 400 });
      }
      output[key] = value;
    }
  }

  if ('rateMin' in output && 'rateMax' in output && output.rateMin > output.rateMax) {
    throw Object.assign(new Error('rateMin cannot exceed rateMax'), { status: 400 });
  }

  if ('exclusions' in input) {
    if (
      !Array.isArray(input.exclusions) ||
      input.exclusions.length > 20 ||
      input.exclusions.some((x) => typeof x !== 'string' || x.length > 200)
    ) {
      throw Object.assign(new Error('exclusions must be an array of at most 20 short strings'), { status: 400 });
    }
    output.exclusions = [...new Set(input.exclusions.map((x) => x.trim()).filter(Boolean))];
  }

  return output;
}

'''
api_text = regex_once(
    api_text,
    r'function validateUserConfigPatch\(input\) \{.*?\n\}\n\n(?=function applyUserConfigPatch)',
    new_validate,
    "command api validation",
)
new_apply = r'''function applyUserConfigPatch(config, patch) {
  const groups = config.role_groups || {};
  const mapping = {
    rolePm: 'pm',
    roleDelivery: 'delivery',
    roleService: 'service',
    roleScrum: 'scrum',
    roleProgram: 'program',
  };

  for (const [inputKey, groupKey] of Object.entries(mapping)) {
    if (inputKey in patch && groups[groupKey]) groups[groupKey].enabled = patch[inputKey];
  }
  config.role_groups = groups;

  config.work_modes ||= {};
  if ('workRemote' in patch) config.work_modes.remote = patch.workRemote;
  if ('workHybrid' in patch) config.work_modes.hybrid = patch.workHybrid;
  if ('freshness' in patch) config.freshness_hours = patch.freshness;
  if ('fitThreshold' in patch) config.fit_threshold = patch.fitThreshold;
  if ('keepReposts' in patch) config.keep_reposts = patch.keepReposts;
  if ('rateMin' in patch) config.rate_min_eur_day = patch.rateMin;
  if ('rateMax' in patch) config.rate_max_eur_day = patch.rateMax;
  if ('immediateStart' in patch) config.immediate_start = patch.immediateStart;
  if ('jobspipeMode' in patch) config.jobspipe_mode = patch.jobspipeMode;
  if ('jobspipeEnabled' in patch && !('jobspipeMode' in patch)) config.jobspipe_mode = patch.jobspipeEnabled ? 'direct' : 'disabled';
  if ('jobspipeApifyMaxItems' in patch) config.jobspipe_apify_max_items_per_run = patch.jobspipeApifyMaxItems;
  if ('jobspipeDirectRunBudget' in patch) config.jobspipe_credit_budget_per_run = patch.jobspipeDirectRunBudget;
  if ('jobspipeDirectMonthlyGuard' in patch) config.jobspipe_monthly_credit_guard = patch.jobspipeDirectMonthlyGuard;
  delete config.jobspipe_enabled;
  if ('exclusions' in patch) config.exclusions = patch.exclusions;
  return config;
}

'''
api_text = regex_once(
    api_text,
    r'function applyUserConfigPatch\(config, patch\) \{.*?\n\}\n\n(?=async function updateSearchConfig)',
    new_apply,
    "command api apply patch",
)
write("command-api/src/index.js", api_text)


# ---------------------------------------------------------------------------
# React UI settings
# ---------------------------------------------------------------------------
ui = read("frontend/src/main.jsx")
new_criteria_from_config = r'''function criteriaFromConfig(config) {
  const groups = config?.role_groups || {}, modes = config?.work_modes || {};
  const legacyMode = config?.jobspipe_enabled === true ? 'direct' : 'disabled';
  return {
    rolePm: groups.pm?.enabled !== false, roleDelivery: groups.delivery?.enabled !== false, roleService: groups.service?.enabled !== false,
    roleScrum: groups.scrum?.enabled !== false, roleProgram: groups.program?.enabled !== false, workRemote: modes.remote !== false, workHybrid: modes.hybrid !== false,
    freshness: Number(config?.freshness_hours ?? 24), fitThreshold: Number(config?.fit_threshold ?? 80), keepReposts: config?.keep_reposts !== false,
    rateMin: Number(config?.rate_min_eur_day ?? 250), rateMax: Number(config?.rate_max_eur_day ?? 650), immediateStart: config?.immediate_start !== false,
    jobspipeMode: config?.jobspipe_mode || legacyMode,
    jobspipeApifyMaxItems: Number(config?.jobspipe_apify_max_items_per_run ?? 5000),
    jobspipeDirectRunBudget: Number(config?.jobspipe_credit_budget_per_run ?? 14),
    jobspipeDirectMonthlyGuard: Number(config?.jobspipe_monthly_credit_guard ?? 950),
    exclusions: Array.isArray(config?.exclusions) ? [...config.exclusions] : [],
  };
}

'''
ui = regex_once(ui, r'function criteriaFromConfig\(config\) \{.*?\n\}\n\n(?=const jobKey)', new_criteria_from_config, "criteriaFromConfig")

new_criteria_page = r'''function CriteriaPage({ draft,setDraft,saved,onSave,saving }) {
  const dirty=JSON.stringify(draft)!==JSON.stringify(saved),update=(key,value)=>setDraft(v=>({...v,[key]:value}));
  const addExclusion=value=>{if(value&&!draft.exclusions.includes(value))update('exclusions',[...draft.exclusions,value])},removeExclusion=value=>update('exclusions',draft.exclusions.filter(x=>x!==value));
  return <div className="space-y-5"><div className="grid grid-cols-1 gap-6 md:grid-cols-2"><CriteriaCard title="Roluri urmarite"><CheckRow checked={draft.rolePm} onChange={v=>update('rolePm',v)}>Project Manager / IT Project Manager</CheckRow><CheckRow checked={draft.roleDelivery} onChange={v=>update('roleDelivery',v)}>Delivery / Technical Project Manager</CheckRow><CheckRow checked={draft.roleService} onChange={v=>update('roleService',v)}>Service Manager</CheckRow><CheckRow checked={draft.roleScrum} onChange={v=>update('roleScrum',v)}>Scrum Master, fara nivel excesiv de senior</CheckRow><CheckRow checked={draft.roleProgram} onChange={v=>update('roleProgram',v)}>Program / PMO Manager</CheckRow></CriteriaCard><CriteriaCard title="Mod de lucru" note="Ordinea ramane Remote, Hibrid, apoi celelalte rezultate eligibile."><CheckRow checked={draft.workRemote} onChange={v=>update('workRemote',v)}>Remote</CheckRow><CheckRow checked={draft.workHybrid} onChange={v=>update('workHybrid',v)}>Hibrid</CheckRow></CriteriaCard><CriteriaCard title="Praguri de selectie"><label className="block text-sm text-slate-700">Vechimea implicita<select value={draft.freshness} onChange={e=>update('freshness',Number(e.target.value))} className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-50"><option value={24}>24 ore</option><option value={36}>36 ore</option><option value={48}>48 ore</option><option value={120}>5 zile</option></select></label><label className="block text-sm text-slate-700">Scor minim pentru fit ridicat<div className="mt-1.5 flex items-center gap-2"><input type="number" min="50" max="100" value={draft.fitThreshold} onChange={e=>update('fitThreshold',Number(e.target.value))} className="h-10 w-28 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-50"/><span className="text-slate-400">%</span></div></label><CheckRow checked={draft.keepReposts} onChange={v=>update('keepReposts',v)}>Pastreaza si marcheaza repostarile</CheckRow></CriteriaCard><CriteriaCard title="Contract si disponibilitate"><label className="block text-sm text-slate-700">Interval B2B zilnic<div className="mt-1.5 flex items-center gap-2"><input type="number" value={draft.rateMin} onChange={e=>update('rateMin',Number(e.target.value))} className="h-10 w-28 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-50"/><span className="text-slate-400">—</span><input type="number" value={draft.rateMax} onChange={e=>update('rateMax',Number(e.target.value))} className="h-10 w-28 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-50"/><span className="text-slate-400">EUR/zi</span></div></label><CheckRow checked={draft.immediateStart} onChange={v=>update('immediateStart',v)}>Prioritizeaza disponibilitatea imediata</CheckRow></CriteriaCard><CriteriaCard title="JobsPipe" note="Alege transportul. In perioada de stabilizare modul ramane Oprit."><label className="block text-sm text-slate-700">Transport<select value={draft.jobspipeMode} onChange={e=>update('jobspipeMode',e.target.value)} className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-50"><option value="disabled">Oprit</option><option value="apify">Apify - recomandat pentru volum</option><option value="direct">JobsPipe Direct - fallback</option></select></label>{draft.jobspipeMode==='apify'&&<><label className="block text-sm text-slate-700">Maximum joburi brute / rulare<input type="number" min="100" max="20000" step="100" value={draft.jobspipeApifyMaxItems} onChange={e=>update('jobspipeApifyMaxItems',Number(e.target.value))} className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-50"/></label><div className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">Actorul JobsPipe din Apify pagineaza automat. Plafonul implicit este 5.000 pentru stabilizare si poate fi marit dupa masurarea costului si duratei. Necesita secretul GitHub Actions <code>APIFY_TOKEN</code>.</div></>}{draft.jobspipeMode==='direct'&&<><label className="block text-sm text-slate-700">Buget credite / rulare<input type="number" min="1" max="1000" value={draft.jobspipeDirectRunBudget} onChange={e=>update('jobspipeDirectRunBudget',Number(e.target.value))} className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-50"/></label><label className="block text-sm text-slate-700">Prag lunar local<input type="number" min="1" max="100000" value={draft.jobspipeDirectMonthlyGuard} onChange={e=>update('jobspipeDirectMonthlyGuard',Number(e.target.value))} className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-50"/></label><div className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">Modul Direct pastreaza preview-ul, polling-ul incremental, cursorul si circuit breaker-ul de quota. Necesita <code>JOBSPIPE_API_KEY</code>.</div></>}{draft.jobspipeMode==='disabled'&&<div className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">Nu se executa nicio cerere JobsPipe sau Apify. Rezultatele existente sunt pastrate.</div>}</CriteriaCard><CriteriaCard title="Excluderi" className="md:col-span-2"><select defaultValue="" onChange={e=>{addExclusion(e.target.value);e.target.value='';}} className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-50"><option value="">Selecteaza o propunere de excludere</option>{EXCLUSION_SUGGESTIONS.map(x=><option key={x}>{x}</option>)}</select><div className="flex flex-wrap gap-2 pt-1">{draft.exclusions.length?draft.exclusions.map(x=><button key={x} onClick={()=>removeExclusion(x)} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-200">{x}<Icon name="close" className="h-3 w-3"/></button>):<span className="text-sm text-slate-400">Nicio excludere selectata.</span>}</div></CriteriaCard></div><div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm"><span className={cx('text-sm font-medium',dirty?'text-amber-600':'text-slate-500')}>{dirty?'Modificari nesalvate':'Preferinte salvate'}</span><button onClick={onSave} disabled={!dirty||saving} className="h-10 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">{saving?'Se salveaza...':'Salveaza preferintele'}</button></div></div>;
}

'''
ui = regex_once(ui, r'function CriteriaPage\(\{ draft,setDraft,saved,onSave,saving \}\) \{.*?\n\}\n\n(?=function SourcesPage)', new_criteria_page, "CriteriaPage")

old_save = "  const saveCriteria=useCallback(async()=>{if(!auth.token||saving)return;setSaving(true);try{await commandApi('/config',auth.token,{method:'PUT',body:JSON.stringify(draftCriteria)});setSavedCriteria(draftCriteria);setCanonicalConfig(current=>current?{...current,freshness_hours:draftCriteria.freshness,fit_threshold:draftCriteria.fitThreshold,jobspipe_enabled:draftCriteria.jobspipeEnabled}:current);setFilters(current=>({...current,freshness:draftCriteria.freshness}));notify('Preferintele au fost salvate. O noua verificare va porni automat.','success');}catch(error){notify(`Preferintele nu au putut fi salvate: ${error.message}`,'error');}finally{setSaving(false);}},[auth.token,saving,draftCriteria,notify]);"
new_save = "  const saveCriteria=useCallback(async()=>{if(!auth.token||saving)return;setSaving(true);try{await commandApi('/config',auth.token,{method:'PUT',body:JSON.stringify(draftCriteria)});setSavedCriteria(draftCriteria);setCanonicalConfig(current=>current?{...current,freshness_hours:draftCriteria.freshness,fit_threshold:draftCriteria.fitThreshold,jobspipe_mode:draftCriteria.jobspipeMode,jobspipe_apify_max_items_per_run:draftCriteria.jobspipeApifyMaxItems,jobspipe_credit_budget_per_run:draftCriteria.jobspipeDirectRunBudget,jobspipe_monthly_credit_guard:draftCriteria.jobspipeDirectMonthlyGuard}:current);setFilters(current=>({...current,freshness:draftCriteria.freshness}));notify('Preferintele au fost salvate. O noua verificare va porni automat.','success');}catch(error){notify(`Preferintele nu au putut fi salvate: ${error.message}`,'error');}finally{setSaving(false);}},[auth.token,saving,draftCriteria,notify]);"
ui = replace_once(ui, old_save, new_save, "saveCriteria")
write("frontend/src/main.jsx", ui)


# ---------------------------------------------------------------------------
# Documentation
# ---------------------------------------------------------------------------
requirements = read("docs/requirements.md")
requirements = requirements.replace(
    "- CFR-50: In `Criterii de selectie` exista checkbox-ul `Activeaza JobsPipe`, sincronizat cu `jobspipe_enabled`.\n- CFR-51: JobsPipe este dezactivat implicit in perioada de stabilizare; modificarea devine efectiva dupa `Salveaza preferintele`.\n",
    "- CFR-50: In `Criterii de selectie` exista configuratia JobsPipe cu modurile `disabled`, `apify` si `direct`, persistata prin `Salveaza preferintele`.\n- CFR-51: Modul implicit ramane `disabled` in perioada de stabilizare. Pentru `apify` se configureaza plafonul de joburi brute/rulare; pentru `direct` se configureaza bugetul de credite/rulare si pragul lunar local.\n- CFR-69: Modul `apify` foloseste Actorul oficial `jobspipe~jobspipe-job-search` si trimite secretul `APIFY_TOKEN` numai din GitHub Actions.\n- CFR-70: Modul `direct` ramane fallback si pastreaza preview-ul, polling-ul incremental, cursorul, bugetul si circuit breaker-ul de quota.\n- CFR-71: Schimbarea modului JobsPipe din UI modifica configuratia canonica, iar selectarea `disabled` garanteaza zero cereri JobsPipe/Apify.\n"
)
requirements = requirements.replace(
    "- CNF-13: `jobspipe_enabled=false` garanteaza zero consum JobsPipe pana la reactivare.\n",
    "- CNF-13: `jobspipe_mode=disabled` garanteaza zero cereri JobsPipe/Apify pana la reactivare.\n- CNF-18: `APIFY_TOKEN` este stocat exclusiv in GitHub Actions Secrets si nu este expus frontend-ului sau Cloudflare Worker-ului.\n"
)
requirements = requirements.replace(
    "- JobsPipe ramane dezactivat prin `jobspipe_enabled=false` in perioada de stabilizare.\n",
    "- JobsPipe ramane dezactivat prin `jobspipe_mode=disabled` in perioada de stabilizare; dupa stabilizare, modul recomandat este `apify`, iar `direct` ramane fallback.\n"
)
write("docs/requirements.md", requirements)

functional = read("docs/functionalitati.md")
functional = functional.replace("- JobsPipe enabled/disabled;", "- mod JobsPipe: Oprit / Apify / Direct;\n- plafon configurabil de joburi brute/rulare pentru Apify;\n- buget si prag lunar configurabile pentru Direct;")
functional = regex_once(
    functional,
    r'## 12\. JobsPipe\n\n.*?\n## 13\. Persistenta',
    '''## 12. JobsPipe\n\nTransport configurabil:\n\n- `disabled` - fara cereri externe; implicit in perioada de stabilizare;\n- `apify` - transport recomandat pentru volum, prin Actorul oficial `jobspipe~jobspipe-job-search`;\n- `direct` - fallback/diagnostic cu mecanismele existente de quota.\n\nApify:\n\n- plafon implicit: 5.000 joburi brute/rulare;\n- plafon UI permis: 100-20.000;\n- doua cautari fara suprapunere: geografiile prioritare si remote Europe;\n- Actorul pagineaza automat;\n- necesita `APIFY_TOKEN` in GitHub Actions Secrets.\n\nDirect:\n\n- preview gratuit;\n- polling incremental;\n- cursor backlog;\n- buget per rulare;\n- guard lunar;\n- circuit breaker quota;\n- necesita `JOBSPIPE_API_KEY`.\n\nStare curenta:\n\n`jobspipe_mode=disabled`\n\n## 13. Persistenta''',
    "functional JobsPipe section",
)
write("docs/functionalitati.md", functional)

architecture = read("docs/architecture.md")
architecture = architecture.replace(
    "`JobsPipeConnector` este implementat, dar `jobspipe_enabled=false` in perioada de stabilizare.\n\nCand JobsPipe este activ:\n\n- preview gratuit;\n- polling incremental cu `discovered_at_gte`;\n- cursor pentru backlog;\n- buget per run;\n- guard lunar local.\n",
    "JobsPipe are trei moduri de transport: `disabled`, `apify`, `direct`.\n\n- `disabled` este starea curenta in perioada de stabilizare;\n- `apify` este transportul recomandat dupa stabilizare si foloseste Actorul oficial `jobspipe~jobspipe-job-search`;\n- `direct` ramane fallback si foloseste `JobsPipeConnector` cu preview, `discovered_at_gte`, cursor, buget per run si guard lunar.\n\nSecretul `APIFY_TOKEN` exista numai in GitHub Actions; `JOBSPIPE_API_KEY` este folosit numai de modul Direct.\n"
)
architecture = architecture.replace(
    "`jobspipe_enabled` controleaza explicit accesul providerului JobsPipe.",
    "`jobspipe_mode` controleaza transportul JobsPipe (`disabled|apify|direct`). `jobspipe_apify_max_items_per_run` controleaza plafonul tehnic Apify, iar setarile de credit/guard raman active numai pentru Direct."
)
write("docs/architecture.md", architecture)

data_contract = read("docs/data-contract.md")
data_contract = data_contract.replace(
    "- `jobspipe_credit_budget_per_run` - limita locala de credite JobsPipe pentru o rulare;",
    "- `jobspipe_mode` - `disabled`, `apify` sau `direct`;\n- `jobspipe_apify_max_items_per_run` - plafon tehnic de joburi brute returnate prin Actorul Apify;\n- `jobspipe_credit_budget_per_run` - limita locala de credite JobsPipe pentru modul Direct;"
)
data_contract = data_contract.replace(
    "- `jobspipe_credit_budget_per_run = 14`;",
    "- `jobspipe_mode = disabled`;\n- `jobspipe_apify_max_items_per_run = 5000`;\n- `jobspipe_credit_budget_per_run = 14`;"
)
write("docs/data-contract.md", data_contract)

source_strategy = read("docs/source-strategy.md")
source_strategy += "\n## Transport JobsPipe\n\n- `disabled` - implicit in stabilizare;\n- `apify` - recomandat pentru volum dupa stabilizare; Actor oficial JobsPipe, billing per upstream request/page;\n- `direct` - fallback cu quota guards;\n- transportul nu schimba regulile de filtrare/scoring si nici strategia egala a surselor din catalog.\n"
write("docs/source-strategy.md", source_strategy)

readme = read("README.md")
readme = readme.replace("`jobspipe_enabled=false`", "`jobspipe_mode=disabled`")
readme = readme.replace(
    "Cand va fi reactivat, foloseste:\n\n- preview gratuit;\n- polling incremental;\n- cursor backlog;\n- 14 credite maximum/rulare;\n- guard lunar 950;\n- circuit breaker quota.",
    "Dupa stabilizare, transportul recomandat este Apify prin Actorul oficial JobsPipe, cu plafon initial 5.000 joburi brute/rulare. Modul Direct ramane fallback si pastreaza preview-ul, polling-ul incremental, cursorul, limita de 14 credite/rulare, guard-ul lunar 950 si circuit breaker-ul de quota."
)
write("README.md", readme)

changelog = read("CHANGELOG.md")
needle = "## 0.03 - 2026-09-05\n"
addition = "## 0.04 - 2026-09-05\n\n### JobsPipe transport\n\n- Adaugat `jobspipe_mode`: `disabled`, `apify`, `direct`.\n- Apify devine transportul recomandat dupa stabilizare.\n- JobsPipe Direct ramane fallback cu quota guards.\n- UI permite selectarea transportului si configurarea limitelor specifice.\n- Adaugat suport pentru secretul GitHub Actions `APIFY_TOKEN`.\n- Plafon Apify implicit: 5.000 joburi brute/rulare; configurabil 100-20.000.\n- Starea curenta ramane `disabled`.\n\n"
if addition not in changelog:
    changelog = changelog.replace(needle, addition + needle, 1)
write("CHANGELOG.md", changelog)

print("JobsPipe Apify/direct/disabled refactor applied successfully")
