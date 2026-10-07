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

import diagnostics
from job_identity import deduplicate
import nomenclatures as canonical_nomenclatures
import role_taxonomy

ROOT = Path(__file__).resolve().parents[1]
CANDIDATE_DATA = ROOT / "data"

def _runtime_data_dir() -> Path:
    configured = str(os.environ.get("JSCC_RUNTIME_DATA_DIR") or "").strip()
    if configured:
        return Path(configured).expanduser().resolve()

    runtime_mode = str(os.environ.get("JSCC_RUNTIME_MODE") or "").strip().lower()
    cloud_runtime = bool(
        os.environ.get("K_SERVICE")
        or os.environ.get("CLOUD_RUN_JOB")
        or os.environ.get("CLOUD_RUN_EXECUTION")
    )
    if runtime_mode in {"container", "gcp", "cloud-run"} or cloud_runtime:
        raise RuntimeError(
            "JSCC_RUNTIME_DATA_DIR is required in container/GCP runtime; "
            "repository data fallback is disabled"
        )
    return CANDIDATE_DATA

RUNTIME_DATA = _runtime_data_dir()
# Backward-compatible alias for modules that mean mutable application runtime data.
DATA = RUNTIME_DATA
CONFIG_PATH = RUNTIME_DATA / "search-config.json"
JOBS_PATH = RUNTIME_DATA / "jobs.json"
STATUS_PATH = RUNTIME_DATA / "run-status.json"
SCHEMA_VERSION = "1.0"

NOMENCLATURES = canonical_nomenclatures.load_nomenclatures()
REGION_COUNTRIES = canonical_nomenclatures.region_countries(NOMENCLATURES)
COUNTRY_NAMES = canonical_nomenclatures.country_names(NOMENCLATURES)
COUNTRY_NAME_TO_CODE = canonical_nomenclatures.country_name_to_code(NOMENCLATURES)
ACTIVE_COUNTRY_CODES = canonical_nomenclatures.active_country_codes(NOMENCLATURES)
ACTIVE_REGION_CODES = canonical_nomenclatures.active_region_codes(NOMENCLATURES)
ACTIVE_CONTRACT_TYPES = canonical_nomenclatures.active_codes("contract_types", NOMENCLATURES)
EU_COUNTRY_CODES = REGION_COUNTRIES["EU"]


@dataclass
class CollectionResult:
    connector: str
    query: str
    ok: bool
    records: list[dict[str, Any]]
    total_available: int
    error: str | None = None
    error_code: str | None = None
    failure_stage: str | None = None
    http_status: int | None = None


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
    taxonomy = json.loads(role_taxonomy.DEFAULT_TAXONOMY_PATH.read_text(encoding="utf-8"))
    role_taxonomy.validate_taxonomy(taxonomy)
    families = [
        str(value).strip().upper()
        for value in (config.get("target_role_families") or [])
        if str(value).strip().upper() in role_taxonomy.CANONICAL_FAMILIES
        and str(value).strip().upper() != "UNKNOWN"
    ]
    selected_subfamilies = {
        str(value).strip()
        for value in (config.get("target_role_subfamilies") or [])
        if str(value).strip()
    }
    titles: list[str] = []
    for family in families:
        for member in taxonomy["families"][family]["members"]:
            if selected_subfamilies and member["code"] not in selected_subfamilies:
                continue
            label = str(member.get("label") or "").strip()
            if label and label not in titles:
                titles.append(label)
    return titles


ROLE_NEAR_MISS_PATTERNS = {
    "manager": re.compile(r"\bmanager\b", re.I),
    "lead": re.compile(r"\blead\b", re.I),
    "leader": re.compile(r"\bleader\b", re.I),
    "coordinator": re.compile(r"\bcoordinator\b", re.I),
    "agile": re.compile(r"\bagile\b", re.I),
    "transition": re.compile(r"\btransition\b", re.I),
    "transformation": re.compile(r"\btransformation\b", re.I),
    "implementation": re.compile(r"\bimplementation\b", re.I),
    "release": re.compile(r"\brelease\b", re.I),
    "portfolio": re.compile(r"\bportfolio\b", re.I),
    "engagement": re.compile(r"\bengagement\b", re.I),
}

ROLE_GENERIC_KEYWORDS = ("project", "program", "programme", "delivery", "service", "scrum", "pmo")


def normalize_role_text(value: Any) -> str:
    return re.sub(r"\W+", " ", str(value or "").casefold()).strip()


def configured_role_phrases(config: dict[str, Any]) -> list[str]:
    return [
        normalized
        for normalized in (normalize_role_text(title) for title in configured_titles(config))
        if normalized
    ]


def title_contains_role_phrase(title: str, phrases: list[str]) -> bool:
    normalized = f" {normalize_role_text(title)} "
    return any(f" {phrase} " in normalized for phrase in phrases)


def append_role_audit_example(target: dict[str, list[dict[str, str]]], key: str, title: str, company: str, limit: int = 10) -> None:
    examples = target.setdefault(key, [])
    example = {"title": title, "company": company}
    if len(examples) < limit and example not in examples:
        examples.append(example)


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


def configured_contract_types(config: dict[str, Any]) -> set[str]:
    values = config.get("contract_types")
    if values is None:
        return set(ACTIVE_CONTRACT_TYPES)
    return {str(value).strip().lower() for value in values if str(value).strip()}


def validate_geography_config(config: dict[str, Any]) -> None:
    target_regions = configured_target_regions(config)
    excluded_regions = configured_excluded_regions(config)
    target_countries = configured_target_country_codes(config)
    excluded_countries = configured_excluded_country_codes(config)

    unsupported_regions = (target_regions | excluded_regions) - ACTIVE_REGION_CODES
    if unsupported_regions:
        raise RuntimeError(f"Unsupported geographic region: {', '.join(sorted(unsupported_regions))}")
    unsupported_countries = (target_countries | excluded_countries) - ACTIVE_COUNTRY_CODES
    if unsupported_countries:
        raise RuntimeError(f"Unsupported country code: {', '.join(sorted(unsupported_countries))}")
    if not target_regions and not target_countries:
        raise RuntimeError("At least one target region or country is required")
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
    families = config.get("target_role_families")
    subfamilies = config.get("target_role_subfamilies")
    if not isinstance(families, list) or not families:
        raise RuntimeError("target_role_families must be a non-empty array")
    if not isinstance(subfamilies, list) or not subfamilies:
        raise RuntimeError("target_role_subfamilies must be a non-empty array")
    taxonomy = json.loads(role_taxonomy.DEFAULT_TAXONOMY_PATH.read_text(encoding="utf-8"))
    role_taxonomy.validate_taxonomy(taxonomy)
    valid_families = set(role_taxonomy.CANONICAL_FAMILIES) - {"UNKNOWN"}
    if any(str(value).strip().upper() not in valid_families for value in families):
        raise RuntimeError("Unsupported target Role Family")
    member_owner = {
        member["code"]: family
        for family in valid_families
        for member in taxonomy["families"][family]["members"]
    }
    selected_families = {str(value).strip().upper() for value in families}
    if any(member_owner.get(str(value).strip()) not in selected_families for value in subfamilies):
        raise RuntimeError("Role Subfamily must belong to a selected Role Family")
    if not isinstance(config.get("work_modes"), dict):
        raise RuntimeError("work_modes must be an object")
    for key in ("remote", "hybrid", "onsite"):
        if key in config["work_modes"] and not isinstance(config["work_modes"][key], bool):
            raise RuntimeError(f"work_modes.{key} must be boolean")

    contract_types = configured_contract_types(config)
    unsupported_contract_types = contract_types - ACTIVE_CONTRACT_TYPES
    if unsupported_contract_types:
        raise RuntimeError(f"Unsupported contract type: {', '.join(sorted(unsupported_contract_types))}")

    validate_jobspipe_config(config)

    validate_geography_config(config)
    return config


def validate_jobspipe_config(config: dict[str, Any]) -> str:
    mode = str(config.get("jobspipe_mode") or ("direct" if config.get("jobspipe_enabled", True) else "disabled")).lower()
    if mode not in {"disabled", "apify", "direct"}:
        raise RuntimeError("jobspipe_mode must be disabled, apify or direct")
    if mode == "apify":
        apify_max = int(config.get("jobspipe_apify_max_items_per_run", 5000))
        if apify_max < 100 or apify_max > 20000:
            raise RuntimeError("jobspipe_apify_max_items_per_run must be 100-20000")
    return mode


def compile_config_patterns(config: dict[str, Any]):
    company_patterns = config.get("excluded_company_patterns") or []
    excluded_company = re.compile("|".join(f"(?:{pattern})" for pattern in company_patterns), re.I) if company_patterns else None

    role_keywords = [re.escape(value) for value in (config.get("excluded_role_keywords") or [])]
    excluded_role = re.compile(r"\b(?:" + "|".join(role_keywords) + r")\b", re.I) if role_keywords else None

    erp_terms = [re.escape(value) for value in (config.get("deep_erp_terms") or [])]
    deep_erp = re.compile(r"\b(?:" + "|".join(erp_terms) + r")\b", re.I) if erp_terms else None
    return excluded_company, excluded_role, deep_erp


def exclusion_category(reason: str) -> str:
    normalized = str(reason or "").strip().lower()
    if normalized in {"duplicate", "cross-source duplicate"}:
        return "duplicate"
    if normalized == "web publication date unavailable":
        return "date"
    if normalized in {"title outside target", "non-it role", "deep erp/sap implementation"}:
        return "role"
    if normalized == "excluded company":
        return "company"
    if normalized.endswith("disabled by configuration") and normalized.split(" ", 1)[0] in {"remote", "hybrid", "onsite"}:
        return "work_mode"
    if normalized == "contract type disabled by configuration":
        return "contract"
    if normalized in {"remote not eligible from romania", "outside target or excluded geography"}:
        return "geo"
    if normalized == "repost disabled by configuration":
        return "repost"
    if normalized.startswith("older than ") and normalized.endswith(" hours"):
        return "freshness"
    return "other"


def sorted_counts(counts: dict[str, int]) -> dict[str, int]:
    return dict(sorted(counts.items(), key=lambda item: (-item[1], item[0])))


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
    countries: list[str] = []
    seen_country_names: set[str] = set()

    def add_country_name(value: Any) -> None:
        text = str(value or "").strip()
        key = text.casefold()
        if text and key not in seen_country_names:
            seen_country_names.add(key)
            countries.append(text)

    for country in list_values(job.get("countries")):
        text = str(country or "").strip()
        if not text:
            continue
        code = COUNTRY_NAME_TO_CODE.get(text.casefold())
        if code:
            if code not in country_codes:
                country_codes.append(code)
            add_country_name(COUNTRY_NAMES.get(code, code))
        else:
            add_country_name(text)

    raw_codes = [job.get("country_code"), job.get("job_country_code"), *list_values(job.get("country_codes"))]
    for value in raw_codes:
        code = str(value or "").strip().upper()
        if code in ACTIVE_COUNTRY_CODES and code not in country_codes:
            country_codes.append(code)
        if code in ACTIVE_COUNTRY_CODES:
            add_country_name(COUNTRY_NAMES.get(code, code))

    if not remote:
        return countries, country_codes, "Country" if country_codes else "Unknown", True

    if remote and job.get("romania_eligible") is False:
        return countries, country_codes, "Country" if country_codes else "Unknown", False

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
        scope = "Worldwide"
    return countries, country_codes, scope, True


def geography_matches(job_codes: set[str], remote_scope: str, config: dict[str, Any], remote: bool) -> bool:
    target_codes = set(resolve_target_country_codes(config))
    target_regions = configured_target_regions(config)
    excluded_codes = excluded_country_codes(config)
    excluded_regions = configured_excluded_regions(config)

    if not target_codes and not target_regions:
        return False
    if remote and remote_scope == "Worldwide":
        return True
    if remote and remote_scope in {"EU", "EMEA"}:
        if "EU" in excluded_regions or "RO" in excluded_codes:
            return False
        return "EU" in target_regions or bool(target_codes & EU_COUNTRY_CODES)

    allowed_codes = job_codes - excluded_codes
    if not allowed_codes and job_codes:
        return False
    if not job_codes:
        return False
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
    selected_contract_types = configured_contract_types(config)
    target_codes = set(resolve_target_country_codes(config))
    excluded_company, excluded_role, deep_erp = compile_config_patterns(config)
    target_title = re.compile(r"\b(project|program|programme|delivery|service|scrum|pmo)\b", re.I)
    configured_phrases = configured_role_phrases(config)

    raw: list[dict[str, Any]] = []
    totals: dict[str, int] = {}
    for result in collection:
        if result.ok:
            raw.extend({**record, "_collection_source": canonical_source_name(result.connector)} for record in result.records)
            totals[f"{result.connector}:{result.query}"] = result.total_available

    seen: set[Any] = set()
    selected: list[dict[str, Any]] = []
    excluded: list[dict[str, str]] = []
    excluded_by_reason: dict[str, int] = {}
    excluded_by_category: dict[str, int] = {}
    role_filter_audit: dict[str, Any] = {
        "role_gate_evaluated": 0,
        "role_rejected_total": 0,
        "rejected_near_miss_total": 0,
        "rejected_near_miss_by_signal": {},
        "rejected_near_miss_examples": {},
        "accepted_title_gate_total": 0,
        "explicit_role_match_count": 0,
        "generic_keyword_only_count": 0,
        "generic_keyword_only_by_keyword": {},
        "generic_keyword_only_examples": {},
    }

    def record_exclusion(reason: str, count: int = 1) -> None:
        excluded_by_reason[reason] = excluded_by_reason.get(reason, 0) + count
        category = exclusion_category(reason)
        excluded_by_category[category] = excluded_by_category.get(category, 0) + count

    for job in raw:
        title = str(job.get("job_title") or job.get("title") or "").strip()
        company = str(job.get("company") or job.get("company_name") or "").strip()
        description = str(job.get("description") or "")
        text = f"{title} {description}"
        location = job.get("location") or job.get("short_location") or "Nespecificat"
        arrangement_raw = str(job.get("work_arrangement") or job.get("work_mode") or "").strip()
        remote = bool(job.get("remote")) or arrangement_raw.lower() == "remote"
        hybrid = bool(job.get("hybrid")) or arrangement_raw.lower() == "hybrid"
        if remote:
            arrangement_code = "remote"
        elif hybrid:
            arrangement_code = "hybrid"
        else:
            arrangement_code = canonical_nomenclatures.normalize_work_mode(arrangement_raw, NOMENCLATURES)
        countries, country_codes, remote_scope, romania_eligible = normalize_job_geography(job, remote)
        codes = set(country_codes)
        posted = job.get("date_posted") or job.get("posted_at")
        posted_dt = parse_posted_datetime(posted)
        origin = job.get("_collection_source")
        employment_statuses = list_values(job.get("employment_statuses"))
        if not employment_statuses:
            employment_statuses = list_values(job.get("employment_type") or job.get("employment_status") or job.get("job_type"))
        contract_type = canonical_nomenclatures.normalize_contract_type(employment_statuses, NOMENCLATURES)
        employment_raw = ", ".join(employment_statuses) or None
        key = (origin, job.get("id")) if job.get("id") else (
            re.sub(r"\W+", " ", title.lower()).strip(),
            company.lower(),
            str(location).lower(),
        )
        reason: str | None = None

        if key in seen:
            reason = "duplicate"
        elif str(origin).startswith("web:") and not posted_dt:
            reason = "web publication date unavailable"
        else:
            role_filter_audit["role_gate_evaluated"] += 1
            title_match = target_title.search(title)
            if not title_match:
                role_filter_audit["role_rejected_total"] += 1
                near_miss_signals = [
                    signal for signal, pattern in ROLE_NEAR_MISS_PATTERNS.items()
                    if pattern.search(title)
                ]
                if near_miss_signals:
                    role_filter_audit["rejected_near_miss_total"] += 1
                    for signal in near_miss_signals:
                        counts = role_filter_audit["rejected_near_miss_by_signal"]
                        counts[signal] = counts.get(signal, 0) + 1
                        append_role_audit_example(
                            role_filter_audit["rejected_near_miss_examples"],
                            signal,
                            title,
                            company,
                        )
                reason = "title outside target"
            else:
                role_filter_audit["accepted_title_gate_total"] += 1
                if title_contains_role_phrase(title, configured_phrases):
                    role_filter_audit["explicit_role_match_count"] += 1
                else:
                    role_filter_audit["generic_keyword_only_count"] += 1
                    generic_matches = sorted({
                        match.group(1).casefold()
                        for match in target_title.finditer(title)
                    })
                    for keyword in generic_matches:
                        counts = role_filter_audit["generic_keyword_only_by_keyword"]
                        counts[keyword] = counts.get(keyword, 0) + 1
                        append_role_audit_example(
                            role_filter_audit["generic_keyword_only_examples"],
                            keyword,
                            title,
                            company,
                        )

        if reason is None and excluded_company and excluded_company.search(company):
            reason = "excluded company"
        if reason is None and excluded_role and excluded_role.search(title):
            reason = "non-IT role"
        if reason is None and deep_erp and deep_erp.search(text) and re.search(r"implement|consultant|specialist|functional", text, re.I):
            reason = "deep ERP/SAP implementation"
        if reason is None and arrangement_code == "remote" and not work_modes.get("remote", True):
            reason = "remote disabled by configuration"
        if reason is None and arrangement_code == "hybrid" and not work_modes.get("hybrid", True):
            reason = "hybrid disabled by configuration"
        if reason is None and arrangement_code == "onsite" and not work_modes.get("onsite", False):
            reason = "onsite disabled by configuration"
        if reason is None and contract_type != "unknown" and selected_contract_types and contract_type not in selected_contract_types:
            reason = "contract type disabled by configuration"
        if reason is None and remote and not romania_eligible:
            reason = "remote not eligible from Romania"
        if reason is None and not geography_matches(codes, remote_scope, config, remote):
            reason = "outside target or excluded geography"
        if reason is None and not keep_reposts and bool(job.get("reposted")):
            reason = "repost disabled by configuration"
        if reason is None and posted_dt and (now - posted_dt).total_seconds() > collection_freshness_hours * 3600:
            reason = f"older than {collection_freshness_hours} hours"

        if reason:
            excluded.append({"title": title, "company": company, "reason": reason})
            record_exclusion(reason)
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

        arrangement = {
            "remote": "Remote",
            "hybrid": "Hybrid",
            "onsite": "Onsite",
        }.get(arrangement_code, "N/A")
        employment_label = canonical_nomenclatures.contract_type_label(contract_type, NOMENCLATURES)
        employment = employment_label or (employment_raw.replace("_", " ").title() if employment_raw else "Nespecificat")
        age = max(0, int((now - posted_dt).total_seconds() // 3600)) if posted_dt else 0
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
        if contract_type not in {"contract", "freelance"} and not re.search(r"contract|freelance|b2b", text, re.I):
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
            "type": employment,
            "contract_type": contract_type,
            "employment_type_raw": employment_raw,
            "age": age,
            "remote": remote,
            "b2b": contract_type in {"contract", "freelance"} or any(value.lower() in {"contract", "contractor", "freelance"} for value in employment_statuses),
            "repost": bool(job.get("reposted")),
            "status": "new" if score >= fit_threshold else "review",
            "pros": pros[:2],
            "risks": risks[:2],
            "url": url,
            "description": description.strip(),
            "date_posted": posted,
            "source": provider or origin,
            "verified_at": job.get("verified_at"),
        })

    unique = deduplicate(selected)
    cross_source_duplicates = len(selected) - len(unique)
    if cross_source_duplicates:
        excluded.extend({"reason": "cross-source duplicate"} for _ in range(cross_source_duplicates))
        record_exclusion("cross-source duplicate", cross_source_duplicates)
    selected = unique
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
            "contract_types": sorted(selected_contract_types),
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
        "excluded_by_reason": sorted_counts(excluded_by_reason),
        "excluded_by_category": sorted_counts(excluded_by_category),
        "role_filter_audit": {
            **role_filter_audit,
            "rejected_near_miss_by_signal": sorted_counts(role_filter_audit["rejected_near_miss_by_signal"]),
            "generic_keyword_only_by_keyword": sorted_counts(role_filter_audit["generic_keyword_only_by_keyword"]),
        },
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

    run_id = "github-" + now.strftime("%Y%m%dT%H%M%SZ")
    sources = sorted({canonical_source_name(result.connector) for result in collection})
    source_results = []
    for index, result in enumerate(collection):
        records = len(result.records)
        outcome = ("success" if records else "success_empty") if result.ok else "failed"
        source_results.append({
            "source": canonical_source_name(result.connector),
            "connector": result.connector,
            "query": result.query,
            "status": "completed" if result.ok else "failed",
            "outcome": outcome,
            "source_execution_id": f"{run_id}:{index:04d}",
            "records": records,
            "total_available": result.total_available,
            "error": diagnostics.sanitize_text(result.error) if result.error else None,
            "error_code": None if result.ok else (result.error_code or "CONNECTOR_ERROR"),
            "failure_stage": None if result.ok else (result.failure_stage or "fetch"),
            "http_status": result.http_status,
        })
    status = {
        "schema_version": SCHEMA_VERSION,
        "run_id": run_id,
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
    validate_geography_config(config)
    assert not (configured_contract_types(config) - ACTIVE_CONTRACT_TYPES)
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
        if "contract_type" in job:
            assert job["contract_type"] in ACTIVE_CONTRACT_TYPES | {"unknown"}


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