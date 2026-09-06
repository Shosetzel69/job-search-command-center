#!/usr/bin/env python3
"""Canonical job normalization, geography filtering and scoring."""

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

EU_COUNTRY_CODES = {
    "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE",
    "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT",
    "RO", "SK", "SI", "ES", "SE",
}
ASIA_COUNTRY_CODES = {
    "AF", "AM", "AZ", "BH", "BD", "BT", "BN", "KH", "CN", "GE", "HK",
    "IN", "ID", "IR", "IQ", "IL", "JP", "JO", "KZ", "KW", "KG", "LA",
    "LB", "MO", "MY", "MV", "MN", "MM", "NP", "KP", "OM", "PK", "PS",
    "PH", "QA", "SA", "SG", "KR", "LK", "SY", "TW", "TJ", "TH", "TL",
    "TR", "TM", "AE", "UZ", "VN", "YE",
}
REGION_COUNTRIES = {
    "EU": EU_COUNTRY_CODES,
    "US": {"US"},
    "ASIA": ASIA_COUNTRY_CODES,
}

COUNTRY_NAMES = {
    "RO": "Romania", "BE": "Belgia", "LU": "Luxemburg", "FR": "Franta",
    "DE": "Germania", "NL": "Tarile de Jos", "PL": "Polonia", "PT": "Portugalia",
    "ES": "Spania", "IT": "Italia", "IE": "Irlanda", "AT": "Austria", "CZ": "Cehia",
    "SK": "Slovacia", "HU": "Ungaria", "BG": "Bulgaria", "GR": "Grecia",
    "HR": "Croatia", "SI": "Slovenia", "EE": "Estonia", "LV": "Letonia",
    "LT": "Lituania", "DK": "Danemarca", "SE": "Suedia", "FI": "Finlanda",
    "NO": "Norvegia", "CH": "Elvetia", "CY": "Cipru", "MT": "Malta",
    "US": "Statele Unite", "GB": "Regatul Unit", "UA": "Ucraina", "TR": "Turcia",
    "AE": "Emiratele Arabe Unite", "IN": "India", "CN": "China", "JP": "Japonia",
    "SG": "Singapore", "KR": "Coreea de Sud", "HK": "Hong Kong", "IL": "Israel",
    "SA": "Arabia Saudita", "QA": "Qatar", "MY": "Malaezia", "TH": "Thailanda",
    "VN": "Vietnam", "ID": "Indonezia", "PH": "Filipine", "PK": "Pakistan",
    "BD": "Bangladesh",
}
COUNTRY_NAME_TO_CODE = {name.lower(): code for code, name in COUNTRY_NAMES.items()}
COUNTRY_NAME_TO_CODE.update({
    "belgium": "BE", "france": "FR", "germany": "DE", "netherlands": "NL",
    "poland": "PL", "portugal": "PT", "spain": "ES", "italy": "IT",
    "ireland": "IE", "austria": "AT", "czech republic": "CZ", "czechia": "CZ",
    "slovakia": "SK", "hungary": "HU", "bulgaria": "BG", "greece": "GR",
    "croatia": "HR", "slovenia": "SI", "estonia": "EE", "latvia": "LV",
    "lithuania": "LT", "denmark": "DK", "sweden": "SE", "finland": "FI",
    "norway": "NO", "switzerland": "CH", "united states": "US", "usa": "US",
    "united kingdom": "GB", "uk": "GB", "india": "IN", "china": "CN",
    "japan": "JP", "singapore": "SG", "south korea": "KR", "hong kong": "HK",
    "turkey": "TR", "türkiye": "TR", "ukraine": "UA", "united arab emirates": "AE",
    "uae": "AE",
})


@dataclass
class CollectionResult:
    connector: str
    query: str
    ok: bool
    records: list[dict[str, Any]]
    total_available: int
    error: str | None = None


class JobsPipeConnector:
    """Direct JobsPipe client retained for the direct/fallback transport."""

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

        output = json.loads(body)
        if not isinstance(output.get("data"), list):
            raise RuntimeError("provider response does not contain a data array")
        return output

    def collect(self, config: dict[str, Any]) -> list[CollectionResult]:
        titles = configured_titles(config)
        countries = resolve_target_country_codes(config)
        if not titles:
            raise RuntimeError("No enabled role titles")
        collection_hours = int(config.get("collection_freshness_hours", config.get("freshness_hours", 24)))
        freshness_days = max(1, math.ceil(collection_hours / 24))
        common = {
            "job_title_or": titles,
            "posted_at_max_age_days": freshness_days,
            "limit": 25,
            "include_total_results": True,
        }
        queries: dict[str, dict[str, Any]] = {"remote": {**common, "remote": True}}
        if countries:
            queries["target_geography"] = {**common, "job_country_code_or": countries}

        results: list[CollectionResult] = []
        for name, payload in queries.items():
            try:
                response = self._post(payload)
                records = response.get("data") or []
                total = int(response.get("metadata", {}).get("total_results") or len(records))
                results.append(CollectionResult(self.name, name, True, records, total))
            except Exception as exc:
                results.append(CollectionResult(self.name, name, False, [], 0, str(exc)))
        return results


def configured_titles(config: dict[str, Any]) -> list[str]:
    titles: list[str] = []
    for group in (config.get("role_groups") or {}).values():
        if group.get("enabled"):
            titles.extend(group.get("titles") or [])
    return list(dict.fromkeys(str(title).strip() for title in titles if str(title).strip()))


def normalize_region(value: Any) -> str:
    return str(value or "").strip().upper()


def configured_target_country_codes(config: dict[str, Any]) -> set[str]:
    """Return explicit country selections, preserving an intentionally empty new field."""
    if "target_country_codes" in config:
        values = config.get("target_country_codes") or []
    else:
        values = config.get("search_country_codes") or []
    return {str(value).strip().upper() for value in values if str(value).strip()}


def configured_target_regions(config: dict[str, Any]) -> set[str]:
    return {normalize_region(value) for value in (config.get("target_regions") or []) if normalize_region(value)}


def configured_excluded_country_codes(config: dict[str, Any]) -> set[str]:
    return {str(value).strip().upper() for value in (config.get("excluded_country_codes") or []) if str(value).strip()}


def configured_excluded_regions(config: dict[str, Any]) -> set[str]:
    return {normalize_region(value) for value in (config.get("excluded_regions") or []) if normalize_region(value)}


def resolve_target_country_codes(config: dict[str, Any]) -> list[str]:
    codes = configured_target_country_codes(config)
    for region in configured_target_regions(config):
        codes.update(REGION_COUNTRIES.get(region, set()))
    return sorted(codes)


def excluded_country_codes(config: dict[str, Any]) -> set[str]:
    codes = configured_excluded_country_codes(config)
    for region in configured_excluded_regions(config):
        codes.update(REGION_COUNTRIES.get(region, set()))
    return codes


def validate_geography_config(config: dict[str, Any]) -> None:
    target_regions = configured_target_regions(config)
    excluded_regions = configured_excluded_regions(config)
    target_countries = configured_target_country_codes(config)
    excluded_countries = configured_excluded_country_codes(config)

    unsupported = (target_regions | excluded_regions) - set(REGION_COUNTRIES)
    if unsupported:
        raise RuntimeError(f"Unsupported geographic region: {', '.join(sorted(unsupported))}")
    if target_regions & excluded_regions:
        raise RuntimeError("Geographic inclusion/exclusion conflict")
    if target_countries & excluded_countries:
        raise RuntimeError("Geographic inclusion/exclusion conflict")
    if any(REGION_COUNTRIES[region] & excluded_countries for region in target_regions):
        raise RuntimeError("Geographic inclusion/exclusion overlap")
    if any(REGION_COUNTRIES[region] & target_countries for region in excluded_regions):
        raise RuntimeError("Geographic inclusion/exclusion overlap")


def load_config() -> dict[str, Any]:
    config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    if config.get("schema_version") != SCHEMA_VERSION:
        raise RuntimeError(f"Unsupported search config schema: {config.get('schema_version')}")
    if not isinstance(config.get("role_groups"), dict):
        raise RuntimeError("role_groups must be an object")
    if not isinstance(config.get("work_modes"), dict):
        raise RuntimeError("work_modes must be an object")

    mode = str(config.get("jobspipe_mode") or ("direct" if config.get("jobspipe_enabled", True) else "disabled")).lower()
    if mode not in {"disabled", "apify", "direct"}:
        raise RuntimeError("jobspipe_mode must be disabled, apify or direct")
    apify_max = int(config.get("jobspipe_apify_max_items_per_run", 5000))
    if apify_max < 100 or apify_max > 20000:
        raise RuntimeError("jobspipe_apify_max_items_per_run must be 100-20000")

    validate_geography_config(config)
    return config


def compile_config_patterns(config: dict[str, Any]):
    company_patterns = config.get("excluded_company_patterns") or []
    excluded_company = re.compile("|".join(f"(?:{pattern})" for pattern in company_patterns), re.I) if company_patterns else None

    role_keywords = [re.escape(value) for value in (config.get("excluded_role_keywords") or [])]
    excluded_role = re.compile(r"\b(?:" + "|".join(role_keywords) + r")\b", re.I) if role_keywords else None

    erp_terms = [re.escape(value) for value in (config.get("deep_erp_terms") or [])]
    deep_erp = re.compile(r"\b(?:" + "|".join(erp_terms) + r")\b", re.I) if erp_terms else None
    return excluded_company, excluded_role, deep_erp


def parse_posted_datetime(value: Any) -> datetime | None:
    if value is None or value == "":
        return None
    try:
        parsed = datetime.fromisoformat(str(value).strip().replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def list_values(value: Any) -> list[str]:
    values = value if isinstance(value, list) else ([] if not value else [value])
    output: list[str] = []
    for item in values:
        if isinstance(item, dict):
            item = item.get("name") or item.get("country") or item.get("code")
        text = str(item or "").strip()
        if text and text not in output:
            output.append(text)
    return output


def normalize_job_geography(job: dict[str, Any], remote: bool) -> tuple[list[str], list[str], str, bool]:
    """Normalize country fields and determine the remote scope without inventing a country."""
    country_codes: list[str] = []
    raw_codes = [job.get("country_code"), job.get("job_country_code"), *list_values(job.get("country_codes"))]
    for value in raw_codes:
        code = str(value or "").strip().upper()
        if len(code) == 2 and code not in country_codes:
            country_codes.append(code)

    countries = list_values(job.get("countries"))
    for country in countries:
        code = COUNTRY_NAME_TO_CODE.get(country.lower())
        if code and code not in country_codes:
            country_codes.append(code)

    for code in country_codes:
        name = COUNTRY_NAMES.get(code, code)
        if name not in countries:
            countries.append(name)

    if not remote:
        return countries, country_codes, "Country" if country_codes else "Unknown", True

    # An explicit country restriction takes precedence over generic scope wording.
    if country_codes:
        return countries, country_codes, "Country", "RO" in country_codes

    scope_text = " ".join([
        str(job.get("location") or ""),
        " ".join(countries),
        " ".join(list_values(job.get("remote_locations"))),
        str(job.get("description") or "")[:5000],
    ])
    if re.search(r"\b(worldwide|work from anywhere|anywhere in the world|global remote)\b", scope_text, re.I):
        scope = "Worldwide"
    elif re.search(r"\bEMEA\b", scope_text, re.I):
        scope = "EMEA"
    elif re.search(r"\b(EU|European Union|Europe only|within Europe|across Europe|Europe)\b", scope_text, re.I):
        scope = "EU"
    else:
        # Confirmed rule: remote without a stated territory is Worldwide.
        scope = "Worldwide"
    return countries, country_codes, scope, True


def geography_matches(job_codes: set[str], remote_scope: str, config: dict[str, Any], remote: bool) -> bool:
    target_codes = set(resolve_target_country_codes(config))
    target_regions = configured_target_regions(config)
    excluded_codes = excluded_country_codes(config)
    excluded_regions = configured_excluded_regions(config)

    if remote and remote_scope == "Worldwide":
        # Confirmed rule: a regional exclusion does not eliminate Worldwide remote.
        return True

    if remote and remote_scope in {"EU", "EMEA"}:
        if "EU" in excluded_regions or "RO" in excluded_codes:
            return False
        if not target_codes and not target_regions:
            return True
        return "EU" in target_regions or bool(target_codes & EU_COUNTRY_CODES)

    allowed_codes = job_codes - excluded_codes
    if not allowed_codes and job_codes:
        return False
    if not target_codes:
        return True
    if not job_codes:
        # Unknown geography is retained rather than assigned an invented country.
        return True
    return bool(allowed_codes & target_codes)


def canonical_source_name(connector: str | None) -> str:
    if str(connector or "").lower().startswith("jobspipe"):
        return "JobsPipe"
    return str(connector or "Necunoscuta")


def process_records(config: dict[str, Any], collection: list[CollectionResult], now: datetime) -> dict[str, Any]:
    display_freshness_hours = int(config.get("freshness_hours", 24))
    collection_freshness_hours = int(config.get("collection_freshness_hours", display_freshness_hours))
    fit_threshold = int(config.get("fit_threshold", 80))
    keep_reposts = bool(config.get("keep_reposts", True))
    work_modes = config.get("work_modes") or {}
    target_codes = set(resolve_target_country_codes(config))
    excluded_company, excluded_role, deep_erp = compile_config_patterns(config)
    target_title = re.compile(r"\b(project|program|programme|delivery|service|scrum|pmo)\b", re.I)

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
        title = str(job.get("job_title") or job.get("title") or "").strip()
        company = str(job.get("company") or job.get("company_name") or "").strip()
        description = str(job.get("description") or "")
        text = f"{title} {description}"
        location = job.get("location") or job.get("short_location") or "Nespecificat"
        remote = bool(job.get("remote")) or str(job.get("work_arrangement") or "").lower() == "remote"
        hybrid = bool(job.get("hybrid")) or str(job.get("work_arrangement") or "").lower() == "hybrid"
        countries, country_codes, remote_scope, romania_eligible = normalize_job_geography(job, remote)
        codes = set(country_codes)
        posted = job.get("date_posted") or job.get("posted_at")
        posted_dt = parse_posted_datetime(posted)
        key = job.get("id") or (
            re.sub(r"\W+", " ", title.lower()).strip(),
            company.lower(),
            str(location).lower(),
        )
        reason: str | None = None

        if key in seen:
            reason = "duplicate"
        elif not target_title.search(title):
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
        elif remote and not romania_eligible:
            reason = "remote not eligible from Romania"
        elif not geography_matches(codes, remote_scope, config, remote):
            reason = "outside target or excluded geography"
        elif not keep_reposts and bool(job.get("reposted")):
            reason = "repost disabled by configuration"
        elif posted_dt and (now - posted_dt).total_seconds() > collection_freshness_hours * 3600:
            reason = f"older than {collection_freshness_hours} hours"

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
        if not remote and not hybrid and codes and target_codes and not (codes & target_codes):
            score -= 12
        score = max(40, min(96, score))

        age = max(0, int((now - posted_dt).total_seconds() // 3600)) if posted_dt else 0
        arrangement_raw = str(job.get("work_arrangement") or "").strip().lower()
        if remote:
            arrangement = "Remote"
        elif hybrid:
            arrangement = "Hybrid"
        elif arrangement_raw in {"onsite", "on-site", "office", "in-office"}:
            arrangement = "Onsite"
        else:
            arrangement = "N/A"

        employment_statuses = list_values(job.get("employment_statuses"))
        employment = ", ".join(employment_statuses) or "Nespecificat"
        url = job.get("final_url") or job.get("source_url") or job.get("url")

        pros: list[str] = []
        if remote:
            pros.append("Remote")
        if (codes & target_codes) or (remote and remote_scope in {"Worldwide", "EU", "EMEA"}):
            pros.append("Geografie eligibila")
        if re.search(r"bank|financial|compliance|regulated|governance", text, re.I):
            pros.append("Mediu reglementat relevant")
        if re.search(r"European Commission|European Parliament|EU institution|public sector", text, re.I):
            pros.append("Context public sau institutii europene")
        if not pros:
            pros.append("Titlu si responsabilitati relevante pentru profil")

        risks: list[str] = []
        if not remote and codes and target_codes and not (codes & target_codes):
            risks.append("Necesita prezenta in afara geografiei selectate")
        if re.search(r"Dutch|German|native French|fluent French", text, re.I):
            risks.append("Cerinta lingvistica trebuie verificata")
        provider = (job.get("sources") or [{}])[0].get("provider")
        if provider == "indeed" and not job.get("final_url"):
            risks.append("Link direct catre angajator neconfirmat")
        if not re.search(r"contract|freelance|b2b", text, re.I):
            risks.append("Forma B2B nu este confirmata")
        if not risks:
            risks.append("Conditiile contractuale trebuie confirmate")

        selected.append({
            "id": job.get("id"),
            "title": title,
            "company": company,
            "initial": "".join(value[0] for value in company.split()[:2]).upper() or "?",
            "fit": score,
            "location": location,
            "countries": countries,
            "country_codes": country_codes,
            "remote_scope": remote_scope,
            "romania_eligible": romania_eligible if remote else None,
            "mode": arrangement,
            "type": employment.replace("_", " ").title(),
            "age": age,
            "remote": remote,
            "b2b": any(value.lower() in {"contract", "contractor", "freelance"} for value in employment_statuses),
            "repost": bool(job.get("reposted")),
            "status": "new" if score >= fit_threshold else "review",
            "pros": pros[:2],
            "risks": risks[:2],
            "url": url,
            "description": description.strip(),
            "date_posted": posted,
            "source": provider or canonical_source_name(collection[0].connector if collection else None),
            "verified_at": job.get("verified_at"),
        })

    selected.sort(key=lambda item: (-item["fit"], item["age"], item["company"].lower()))
    return {
        "schema_version": SCHEMA_VERSION,
        "generated_at": now.isoformat(),
        "freshness_hours": collection_freshness_hours,
        "collection_freshness_hours": collection_freshness_hours,
        "criteria": {
            "roles": configured_titles(config),
            "geography": {
                "regions": sorted(configured_target_regions(config)),
                "country_codes": sorted(configured_target_country_codes(config)),
                "excluded_regions": sorted(configured_excluded_regions(config)),
                "excluded_country_codes": sorted(configured_excluded_country_codes(config)),
            },
            "work_mode_priority": config.get("work_mode_priority") or [],
            "source_strategy": config.get("source_strategy") or "all active sources equally",
            "display_freshness_hours": display_freshness_hours,
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

    sources = sorted({canonical_source_name(result.connector) for result in collection})
    source_results = [
        {
            "source": canonical_source_name(result.connector),
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
        "sources": sources,
        "sources_processed": len(sources),
        "failed_sources": sorted({canonical_source_name(result.connector) for result in failed}),
        "source_results": source_results,
        "records_inspected": sum(len(result.records) for result in successful),
        "jobs_published": jobs_published,
        "excluded": excluded,
        "limitations": [],
    }
    STATUS_PATH.write_text(json.dumps(status, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return state


def validate_output() -> None:
    config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    jobs = json.loads(JOBS_PATH.read_text(encoding="utf-8"))
    status = json.loads(STATUS_PATH.read_text(encoding="utf-8"))

    root_required = {
        "schema_version", "generated_at", "freshness_hours", "criteria",
        "records_inspected", "results", "excluded_count", "jobs",
    }
    status_required = {
        "schema_version", "run_id", "status", "started_at", "completed_at", "sources",
        "sources_processed", "records_inspected", "jobs_published", "excluded", "limitations",
    }
    job_required = {
        "title", "company", "fit", "location", "mode", "remote", "b2b", "repost",
        "status", "pros", "risks", "description", "date_posted", "source",
    }

    assert config.get("schema_version") == SCHEMA_VERSION
    assert jobs.get("schema_version") == SCHEMA_VERSION
    assert status.get("schema_version") == SCHEMA_VERSION
    assert not (root_required - jobs.keys()), root_required - jobs.keys()
    assert not (status_required - status.keys()), status_required - status.keys()
    assert status["status"] in {"running", "completed", "completed_with_errors", "failed"}
    assert isinstance(status["sources_processed"], int)
    assert isinstance(jobs["jobs"], list)
    for index, job in enumerate(jobs["jobs"]):
        missing = job_required - job.keys()
        assert not missing, f"job {index} missing {sorted(missing)}"
        if "countries" in job:
            assert isinstance(job["countries"], list)
        if "country_codes" in job:
            assert isinstance(job["country_codes"], list)


def main() -> int:
    if "--validate-only" in sys.argv:
        validate_output()
        print("Configuration and JSON contracts valid")
        return 0

    now = datetime.now(timezone.utc)
    config = load_config()
    try:
        connector = JobsPipeConnector(os.environ.get("JOBSPIPE_API_KEY", ""))
        collection = connector.collect(config)
    except Exception as exc:
        status = {
            "schema_version": SCHEMA_VERSION,
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
        }
        STATUS_PATH.write_text(json.dumps(status, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(str(exc), file=sys.stderr)
        return 2

    if any(result.ok for result in collection):
        output = process_records(config, collection, now)
        JOBS_PATH.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        jobs_published = output["results"]
        excluded_count = output["excluded_count"]
    else:
        jobs_published = 0
        excluded_count = 0

    state = write_status(now, collection, jobs_published, excluded_count)
    if any(result.ok for result in collection):
        validate_output()
    return 2 if state == "failed" else 0


if __name__ == "__main__":
    raise SystemExit(main())
