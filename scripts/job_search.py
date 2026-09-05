#!/usr/bin/env python3
"""Static-first job search engine used by GitHub Actions.

The workflow is intentionally thin. Source-specific collection lives behind
connector classes; normalization/filtering/scoring is source-independent.
"""

from __future__ import annotations

import json
import math
import os
import re
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
CONFIG_PATH = DATA / "search-config.json"
JOBS_PATH = DATA / "jobs.json"
STATUS_PATH = DATA / "run-status.json"
SCHEMA_VERSION = "1.0"


@dataclass
class CollectionResult:
    connector: str
    query: str
    ok: bool
    records: list[dict[str, Any]]
    total_available: int
    error: str | None = None


class JobConnector:
    """Minimal connector contract.

    A connector collects provider-specific data. It must return raw records;
    filtering and scoring remain outside the connector.
    """

    name = "base"

    def collect(self, config: dict[str, Any]) -> list[CollectionResult]:
        raise NotImplementedError


class JobsPipeConnector(JobConnector):
    name = "jobspipe"
    endpoint = "https://api.jobspipe.dev/v1/jobs/search"

    def __init__(self, api_key: str) -> None:
        if not api_key:
            raise RuntimeError("JOBSPIPE_API_KEY is not configured")
        self.api_key = api_key

    def _post(self, payload: dict[str, Any]) -> dict[str, Any]:
        request = Request(
            self.endpoint,
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
                "User-Agent": "job-search-command-center/1.0",
            },
            method="POST",
        )
        try:
            with urlopen(request, timeout=45) as response:
                body = response.read().decode("utf-8")
        except HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")[:500]
            raise RuntimeError(f"HTTP {exc.code}: {detail}") from exc
        except URLError as exc:
            raise RuntimeError(f"network error: {exc.reason}") from exc

        payload_out = json.loads(body)
        if not isinstance(payload_out.get("data"), list):
            raise RuntimeError("provider response does not contain a data array")
        return payload_out

    @staticmethod
    def _queries(config: dict[str, Any]) -> dict[str, dict[str, Any]]:
        groups = config.get("role_groups") or {}
        titles: list[str] = []
        for group in groups.values():
            if group.get("enabled"):
                titles.extend(group.get("titles") or [])
        titles = list(dict.fromkeys(titles))
        if not titles:
            raise RuntimeError("No enabled role titles")

        countries = config.get("search_country_codes") or []
        if not countries:
            raise RuntimeError("No search countries")

        freshness_days = max(1, math.ceil(int(config.get("freshness_hours", 24)) / 24))
        core_titles: list[str] = []
        for key in ("pm", "delivery", "service"):
            group = groups.get(key) or {}
            if group.get("enabled"):
                core_titles.extend(group.get("titles") or [])
        core_titles = list(dict.fromkeys(core_titles)) or titles

        common = {"posted_at_max_age_days": freshness_days, "limit": 25, "include_total_results": True}
        return {
            "geography": {**common, "job_title_or": titles, "job_country_code_or": countries},
            "remote": {**common, "job_title_or": titles, "remote": True},
            "core_remote": {**common, "job_title_or": core_titles, "remote": True},
        }

    def collect(self, config: dict[str, Any]) -> list[CollectionResult]:
        results: list[CollectionResult] = []
        for query_name, payload in self._queries(config).items():
            try:
                response = self._post(payload)
                records = response.get("data") or []
                total = response.get("metadata", {}).get("total_results", len(records))
                results.append(CollectionResult(self.name, query_name, True, records, int(total or 0)))
            except Exception as exc:  # connector errors must not kill sibling queries
                results.append(CollectionResult(self.name, query_name, False, [], 0, str(exc)))
        return results


def load_config() -> dict[str, Any]:
    config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    if config.get("schema_version") != SCHEMA_VERSION:
        raise RuntimeError(f"Unsupported search config schema: {config.get('schema_version')}")
    if not isinstance(config.get("role_groups"), dict):
        raise RuntimeError("role_groups must be an object")
    if not isinstance(config.get("work_modes"), dict):
        raise RuntimeError("work_modes must be an object")
    return config


def configured_titles(config: dict[str, Any]) -> list[str]:
    titles: list[str] = []
    for group in (config.get("role_groups") or {}).values():
        if group.get("enabled"):
            titles.extend(group.get("titles") or [])
    return list(dict.fromkeys(titles))


def compile_config_patterns(config: dict[str, Any]):
    company_patterns = config.get("excluded_company_patterns") or []
    excluded_company = re.compile("|".join(f"(?:{p})" for p in company_patterns), re.I) if company_patterns else None

    role_keywords = [re.escape(x) for x in (config.get("excluded_role_keywords") or [])]
    excluded_role = re.compile(r"\b(?:" + "|".join(role_keywords) + r")\b", re.I) if role_keywords else None

    erp_terms = [re.escape(x) for x in (config.get("deep_erp_terms") or [])]
    deep_erp = re.compile(r"\b(?:" + "|".join(erp_terms) + r")\b", re.I) if erp_terms else None
    return excluded_company, excluded_role, deep_erp


def process_records(config: dict[str, Any], collection: list[CollectionResult], now: datetime) -> dict[str, Any]:
    freshness_hours = int(config.get("freshness_hours", 24))
    fit_threshold = int(config.get("fit_threshold", 80))
    keep_reposts = bool(config.get("keep_reposts", True))
    search_countries = set(config.get("search_country_codes") or [])
    europe = set(config.get("eligible_remote_country_codes") or [])
    work_modes = config.get("work_modes") or {}
    excluded_company, excluded_role, deep_erp = compile_config_patterns(config)
    target = re.compile(r"\b(project|program|programme|delivery|service|scrum|pmo)\b", re.I)

    raw: list[dict[str, Any]] = []
    totals: dict[str, int] = {}
    for result in collection:
        if result.ok:
            raw.extend(result.records)
            totals[f"{result.connector}:{result.query}"] = result.total_available

    seen: set[Any] = set()
    selected: list[dict[str, Any]] = []
    excluded: list[dict[str, str]] = []

    for job in raw:
        title = (job.get("job_title") or "").strip()
        company = (job.get("company") or "").strip()
        description = job.get("description") or ""
        text = f"{title} {description}"
        location = job.get("location") or job.get("short_location") or "Nespecificat"
        code = (job.get("country_code") or "").upper()
        countries = job.get("countries") or []
        remote = bool(job.get("remote")) or job.get("work_arrangement") == "remote"
        hybrid = bool(job.get("hybrid")) or job.get("work_arrangement") == "hybrid"
        posted = job.get("date_posted")
        key = job.get("id") or (re.sub(r"\W+", " ", title.lower()).strip(), company.lower(), str(location).lower())
        reason: str | None = None

        if key in seen:
            reason = "duplicate"
        elif not target.search(title):
            reason = "title outside target"
        elif excluded_company and excluded_company.search(company):
            reason = "excluded company"
        elif excluded_role and excluded_role.search(title):
            reason = "non-IT role"
        elif deep_erp and deep_erp.search(text) and re.search(r"implement|consultant|specialist|functional", text, re.I):
            reason = "deep ERP/SAP implementation"
        elif remote and not work_modes.get("remote", True):
            reason = "remote disabled by configuration"
        elif hybrid and not work_modes.get("hybrid", True):
            reason = "hybrid disabled by configuration"
        elif remote and code and europe and code not in europe and not any(c in ("Romania", "Europe", "European Union") for c in countries):
            reason = "remote geography not eligible"
        elif remote and not code:
            eligibility_text = f"{location} {job.get('url') or ''} {job.get('source_url') or ''} {' '.join(map(str, countries))}"
            if not re.search(r"Europe|European|EMEA|Romania|Ukraine|Poland|Portugal|Spain|France|Germany|Belgium|Luxembourg|Netherlands|Ireland|Italy|Austria|Czech|Slovak|Hungary|Bulgaria|Greece|Croatia|Slovenia|Estonia|Latvia|Lithuania|Denmark|Sweden|Finland|Norway|Switzerland|Cyprus|Malta", eligibility_text, re.I):
                reason = "remote eligibility for Europe not explicit"
        if not reason and not keep_reposts and bool(job.get("reposted")):
            reason = "repost disabled by configuration"
        if not reason and posted:
            try:
                posted_dt = datetime.fromisoformat(str(posted).replace("Z", "+00:00"))
                if (now - posted_dt).total_seconds() > freshness_hours * 3600:
                    reason = f"older than {freshness_hours} hours"
            except Exception:
                # JobsPipe already limits collection to posted_at_max_age_days.
                # Keep the record instead of discarding a potentially fresh job
                # only because the provider timestamp format is not ISO-8601.
                pass

        if reason:
            excluded.append({"title": title, "company": company, "reason": reason})
            continue
        seen.add(key)

        score = 68
        title_lower = title.lower()
        if "it project" in title_lower or "technical project" in title_lower:
            score += 13
        elif "project manager" in title_lower:
            score += 9
        if "delivery" in title_lower:
            score += 9
        if "service" in title_lower:
            score += 6
        if "program" in title_lower or "programme" in title_lower or "pmo" in title_lower:
            score += 6
        if "scrum" in title_lower:
            score += 3
        if remote:
            score += 8
        elif hybrid:
            score += 4
        if re.search(r"contract|freelance|b2b", text, re.I):
            score += 6
        if re.search(r"European Commission|European Parliament|EU institution|public sector", text, re.I):
            score += 7
        if re.search(r"bank|financial|compliance|regulated|governance", text, re.I):
            score += 5
        if re.search(r"Dutch|German|native French|fluent French", text, re.I):
            score -= 7
        if not remote and not hybrid and code not in search_countries and code:
            score -= 12
        score = max(40, min(96, score))

        age = 0
        if posted:
            try:
                posted_dt = datetime.fromisoformat(str(posted).replace("Z", "+00:00"))
                age = max(0, int((now - posted_dt).total_seconds() // 3600))
            except Exception:
                age = 0

        arrangements = "Remote" if remote else ("Hybrid" if hybrid else "Onsite")
        employment_statuses = job.get("employment_statuses") or []
        employment = ", ".join(employment_statuses) or "Nespecificat"
        url = job.get("final_url") or job.get("source_url") or job.get("url")

        pros: list[str] = []
        if remote:
            pros.append("Remote")
        if code in search_countries:
            pros.append("Geografie prioritara")
        if re.search(r"bank|financial|compliance|regulated|governance", text, re.I):
            pros.append("Mediu reglementat relevant")
        if re.search(r"European Commission|European Parliament|EU institution|public sector", text, re.I):
            pros.append("Context public sau institutii europene")
        if not pros:
            pros.append("Titlu si responsabilitati relevante pentru profil")

        risks: list[str] = []
        if not remote and code and code not in search_countries:
            risks.append("Necesita prezenta in afara geografiei prioritare")
        if re.search(r"Dutch|German|native French|fluent French", text, re.I):
            risks.append("Cerinta lingvistica trebuie verificata")
        if ((job.get("sources") or [{}])[0].get("provider") == "indeed") and not job.get("final_url"):
            risks.append("Link direct catre angajator neconfirmat")
        if not re.search(r"contract|freelance|b2b", text, re.I):
            risks.append("Forma B2B nu este confirmata")
        if not risks:
            risks.append("Conditiile contractuale trebuie confirmate")

        selected.append(
            {
                "id": job.get("id"),
                "title": title,
                "company": company,
                "initial": "".join(x[0] for x in company.split()[:2]).upper() or "?",
                "fit": score,
                "location": location,
                "mode": arrangements,
                "type": employment.replace("_", " ").title(),
                "age": age,
                "remote": remote,
                "b2b": any(x in ("contract", "contractor", "freelance") for x in employment_statuses),
                "repost": bool(job.get("reposted")),
                "status": "new" if score >= fit_threshold else "review",
                "pros": pros[:2],
                "risks": risks[:2],
                "url": url,
                "description": description.strip(),
                "date_posted": posted,
                "source": (job.get("sources") or [{}])[0].get("provider"),
                "verified_at": job.get("verified_at"),
            }
        )

    selected.sort(key=lambda item: (-item["fit"], item["age"], item["company"].lower()))
    return {
        "schema_version": SCHEMA_VERSION,
        "generated_at": now.isoformat(),
        "freshness_hours": freshness_hours,
        "criteria": {
            "roles": configured_titles(config),
            "geography": config.get("search_country_codes") or [],
            "work_mode_priority": config.get("work_mode_priority") or [],
            "source_strategy": config.get("source_strategy") or "all active sources equally",
            "fit_threshold": fit_threshold,
            "keep_reposts": keep_reposts,
            "exclusions": config.get("exclusions") or [],
        },
        "raw_matches_available": totals,
        "records_inspected": len(raw),
        "results": len(selected),
        "excluded_count": len(excluded),
        "jobs": selected,
        "excluded_sample": excluded[:20],
    }


def write_status(now: datetime, collection: list[CollectionResult], jobs_published: int, excluded: int) -> str:
    successful = [result for result in collection if result.ok]
    failed = [result for result in collection if not result.ok]
    if not successful:
        state = "failed"
    elif failed:
        state = "completed_with_errors"
    else:
        state = "completed"

    source_results = [
        {
            "connector": result.connector,
            "query": result.query,
            "status": "completed" if result.ok else "failed",
            "records": len(result.records),
            "total_available": result.total_available,
            "error": result.error,
        }
        for result in collection
    ]
    status = {
        "schema_version": SCHEMA_VERSION,
        "run_id": "github-" + now.strftime("%Y%m%dT%H%M%SZ"),
        "status": state,
        "started_at": now.isoformat(),
        "completed_at": datetime.now(timezone.utc).isoformat(),
        "sources": sorted({result.connector for result in collection}),
        "source_results": source_results,
        "records_inspected": sum(len(result.records) for result in successful),
        "jobs_published": jobs_published,
        "excluded": excluded,
        "limitations": ["JobsPipe free-plan result cap applies to each query"],
    }
    STATUS_PATH.write_text(json.dumps(status, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return state


def validate_output() -> None:
    config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    jobs = json.loads(JOBS_PATH.read_text(encoding="utf-8"))
    status = json.loads(STATUS_PATH.read_text(encoding="utf-8"))

    root_required = {"schema_version", "generated_at", "freshness_hours", "criteria", "records_inspected", "results", "excluded_count", "jobs"}
    status_required = {"schema_version", "run_id", "status", "started_at", "completed_at", "sources", "records_inspected", "jobs_published", "excluded", "limitations"}
    job_required = {"title", "company", "fit", "location", "mode", "remote", "b2b", "repost", "status", "pros", "risks", "description", "date_posted", "source"}

    assert config.get("schema_version") == SCHEMA_VERSION
    assert jobs.get("schema_version") == SCHEMA_VERSION
    assert status.get("schema_version") == SCHEMA_VERSION
    assert not (root_required - jobs.keys()), root_required - jobs.keys()
    assert not (status_required - status.keys()), status_required - status.keys()
    assert status["status"] in {"running", "completed", "completed_with_errors", "failed"}
    assert isinstance(jobs["jobs"], list)
    for index, job in enumerate(jobs["jobs"]):
        missing = job_required - job.keys()
        assert not missing, f"job {index} missing {sorted(missing)}"


def main() -> int:
    if "--validate-only" in sys.argv:
        validate_output()
        print("Configuration and JSON contracts valid")
        return 0

    now = datetime.now(timezone.utc)
    config = load_config()

    try:
        connectors: list[JobConnector] = [JobsPipeConnector(os.environ.get("JOBSPIPE_API_KEY", ""))]
    except Exception as exc:
        STATUS_PATH.write_text(
            json.dumps(
                {
                    "schema_version": SCHEMA_VERSION,
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
            )
            + "\n",
            encoding="utf-8",
        )
        print(str(exc), file=sys.stderr)
        return 2

    collection: list[CollectionResult] = []
    for connector in connectors:
        collection.extend(connector.collect(config))

    if any(result.ok for result in collection):
        output = process_records(config, collection, now)
        JOBS_PATH.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        jobs_published = output["results"]
        excluded = output["excluded_count"]
    else:
        jobs_published = 0
        excluded = 0

    state = write_status(now, collection, jobs_published, excluded)
    if any(result.ok for result in collection):
        validate_output()

    for result in collection:
        suffix = f" records={len(result.records)}" if result.ok else f" error={result.error}"
        print(f"{result.connector}/{result.query}: {'ok' if result.ok else 'failed'}{suffix}")
    print(f"Search status: {state}; jobs={jobs_published}; excluded={excluded}")
    return 2 if state == "failed" else 0


if __name__ == "__main__":
    raise SystemExit(main())