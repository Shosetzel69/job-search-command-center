"""Public, unauthenticated job API adapters using the canonical CollectionResult contract."""

from __future__ import annotations

import json
import re
from datetime import datetime, timedelta, timezone
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode, urlsplit
from urllib.request import Request, urlopen

import job_search as engine
from job_search_jobicy import plain_text

MAX_BYTES = 10 * 1024 * 1024
TIMEOUT_SECONDS = 30
USER_AGENT = "job-search-command-center/1.0"
MULTI_BOARD_CONNECTORS = {"smartrecruiters", "greenhouse", "ashby"}


def fetch_json(url: str):
    request = Request(url, headers={"Accept": "application/json", "User-Agent": USER_AGENT})
    try:
        with urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            body = response.read(MAX_BYTES + 1)
    except HTTPError as exc:
        detail = exc.read(500).decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code}: {detail}") from exc
    except URLError as exc:
        raise RuntimeError(f"network error: {exc.reason}") from exc
    if len(body) > MAX_BYTES:
        raise ValueError("public API response exceeds size limit")
    try:
        return json.loads(body)
    except json.JSONDecodeError as exc:
        raise ValueError("public API response is not valid JSON") from exc


def _iso_datetime(value):
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        seconds = float(value) / 1000 if float(value) > 10_000_000_000 else float(value)
        return datetime.fromtimestamp(seconds, tz=timezone.utc).isoformat()
    text = str(value).strip()
    if re.fullmatch(r"\d{10,13}", text):
        number = int(text)
        seconds = number / 1000 if number > 10_000_000_000 else number
        return datetime.fromtimestamp(seconds, tz=timezone.utc).isoformat()
    return text


def _cutoff(config: dict, now: datetime) -> datetime:
    hours = int(config.get("collection_freshness_hours", config.get("freshness_hours", 24)))
    return now - timedelta(hours=hours)


def _query_terms(config: dict) -> list[str]:
    terms: list[str] = []
    for group in (config.get("role_groups") or {}).values():
        if not group.get("enabled"):
            continue
        titles = [str(value).strip() for value in (group.get("titles") or []) if str(value).strip()]
        if titles:
            terms.append(titles[0])
        for title in titles[1:]:
            if "PMO" in title.upper():
                terms.append(title)
    return list(dict.fromkeys(terms))


def _codes_from_text(value) -> list[str]:
    text = str(value or "")
    output: list[str] = []
    for country, code in sorted(engine.COUNTRY_NAME_TO_CODE.items(), key=lambda item: len(item[0]), reverse=True):
        if re.search(r"(?<!\w)" + re.escape(country) + r"(?!\w)", text, re.I) and code not in output:
            output.append(code)
    return output


def _country_names(codes: list[str]) -> list[str]:
    return [engine.COUNTRY_NAMES.get(code, code) for code in codes]


def _base_record(source: dict, *, local_id, title, company, description, location, date_posted,
                 source_url, remote=False, hybrid=False, employment=None, country_codes=None):
    if not local_id or not title or not company or not source_url or not date_posted:
        raise ValueError(f"Malformed {source.get('name', 'public API')} listing: required field missing")
    codes = [str(code).strip().upper() for code in (country_codes or []) if len(str(code).strip()) == 2]
    codes = list(dict.fromkeys(codes))
    if not codes:
        codes = _codes_from_text(location)
    if hybrid:
        arrangement = "hybrid"
        remote = False
    elif remote:
        arrangement = "remote"
    else:
        arrangement = "onsite" if str(location or "").strip() else ""
    return {
        "id": f"{source.get('name', 'api').lower().replace(' ', '-')}:" + str(local_id),
        "job_title": str(title).strip(),
        "company": str(company).strip(),
        "description": plain_text(description),
        "location": str(location or "").strip(),
        "country_codes": codes,
        "countries": _country_names(codes),
        "remote": bool(remote),
        "hybrid": bool(hybrid),
        "work_arrangement": arrangement,
        "employment_statuses": engine.list_values(employment),
        "date_posted": _iso_datetime(date_posted),
        "source_url": str(source_url),
        "sources": [{"provider": source.get("name") or "Public API"}],
    }


def _normalize_jobgether(item: dict, source: dict) -> dict:
    mode = str(item.get("remote") or "").lower()
    location = item.get("location") or ""
    return _base_record(
        source,
        local_id=item.get("id"),
        title=item.get("title"),
        company=item.get("company"),
        description=" ".join(engine.list_values(item.get("jobFunctions"))),
        location=location,
        date_posted=item.get("postedAt"),
        source_url=item.get("url"),
        remote="remote" in mode and "hybrid" not in mode,
        hybrid="hybrid" in mode,
        employment=item.get("contractType"),
    )


def _collect_jobgether(source: dict, config: dict, now: datetime) -> list[dict]:
    records: dict[str, dict] = {}
    cutoff = _cutoff(config, now)
    for term in _query_terms(config) or [""]:
        for page in range(1, 4):
            params = {"sort": "date", "limit": 25, "page": page, "includeHybrid": "true"}
            if term:
                params["keyword"] = term
            payload = fetch_json("https://jobgether.com/api/v1/jobs?" + urlencode(params))
            if not isinstance(payload, dict) or not isinstance(payload.get("jobs"), list):
                raise ValueError("Jobgether response must contain jobs array")
            page_records = [_normalize_jobgether(item, source) for item in payload["jobs"]]
            for record in page_records:
                records[record["id"]] = record
            dates = [engine.parse_posted_datetime(record["date_posted"]) for record in page_records]
            dates = [value for value in dates if value]
            has_more = bool((payload.get("pagination") or {}).get("hasMore"))
            if not has_more or (dates and min(dates) < cutoff):
                break
    return list(records.values())


def _normalize_himalayas(item: dict, source: dict) -> dict:
    restrictions = item.get("locationRestrictions") or []
    codes: list[str] = []
    names: list[str] = []
    for restriction in restrictions:
        if isinstance(restriction, dict):
            code = str(restriction.get("alpha2") or "").upper()
            name = str(restriction.get("name") or "").strip()
            if len(code) == 2 and code not in codes:
                codes.append(code)
            if name:
                names.append(name)
        else:
            names.append(str(restriction))
    location = ", ".join(names) if names else "Worldwide"
    record = _base_record(
        source,
        local_id=item.get("guid"),
        title=item.get("title"),
        company=item.get("companyName"),
        description=item.get("description") or item.get("excerpt"),
        location=location,
        date_posted=item.get("pubDate"),
        source_url=item.get("applicationLink"),
        remote=True,
        employment=item.get("employmentType"),
        country_codes=codes,
    )
    if not codes:
        record["location"] = "Worldwide"
    return record


def _collect_himalayas(source: dict, config: dict, now: datetime) -> list[dict]:
    records: dict[str, dict] = {}
    for term in _query_terms(config) or [""]:
        params = {"sort": "recent"}
        if term:
            params["q"] = term
        payload = fetch_json("https://himalayas.app/jobs/api/search?" + urlencode(params))
        if not isinstance(payload, dict) or not isinstance(payload.get("jobs"), list):
            raise ValueError("Himalayas response must contain jobs array")
        for item in payload["jobs"]:
            record = _normalize_himalayas(item, source)
            records[record["id"]] = record
    return list(records.values())


def _normalize_workingnomads(item: dict, source: dict) -> dict:
    return _base_record(
        source,
        local_id=item.get("url"),
        title=item.get("title"),
        company=item.get("company_name"),
        description=item.get("description"),
        location=item.get("location") or "Worldwide",
        date_posted=item.get("pub_date"),
        source_url=item.get("url"),
        remote=True,
    )


def _collect_workingnomads(source: dict) -> list[dict]:
    payload = fetch_json("https://www.workingnomads.com/api/exposed_jobs/")
    if not isinstance(payload, list):
        raise ValueError("Working Nomads response must be an array")
    return [_normalize_workingnomads(item, source) for item in payload]


def _normalize_remoteok(item: dict, source: dict) -> dict:
    return _base_record(
        source,
        local_id=item.get("id"),
        title=item.get("position"),
        company=item.get("company"),
        description=item.get("description"),
        location=item.get("location") or "Worldwide",
        date_posted=item.get("date"),
        source_url=item.get("url"),
        remote=True,
        employment=item.get("tags"),
    )


def _collect_remoteok(source: dict) -> list[dict]:
    payload = fetch_json("https://remoteok.com/api")
    if not isinstance(payload, list):
        raise ValueError("Remote OK response must be an array")
    jobs = [item for item in payload if isinstance(item, dict) and item.get("id") and item.get("position")]
    return [_normalize_remoteok(item, source) for item in jobs]


def _normalize_remotive(item: dict, source: dict) -> dict:
    return _base_record(
        source,
        local_id=item.get("id"),
        title=item.get("title"),
        company=item.get("company_name"),
        description=item.get("description"),
        location=item.get("candidate_required_location") or "Worldwide",
        date_posted=item.get("publication_date"),
        source_url=item.get("url"),
        remote=True,
        employment=item.get("job_type"),
    )


def _collect_remotive(source: dict, config: dict) -> list[dict]:
    records: dict[str, dict] = {}
    for term in _query_terms(config) or [""]:
        params = {"limit": 50}
        if term:
            params["search"] = term
        payload = fetch_json("https://remotive.com/api/remote-jobs?" + urlencode(params))
        if not isinstance(payload, dict) or not isinstance(payload.get("jobs"), list):
            raise ValueError("Remotive response must contain jobs array")
        for item in payload["jobs"]:
            record = _normalize_remotive(item, source)
            records[record["id"]] = record
    return list(records.values())


def _board_id(source: dict) -> str:
    parts = [part for part in urlsplit(str(source.get("url") or "")).path.split("/") if part]
    if not parts or not re.fullmatch(r"[A-Za-z0-9._-]+", parts[0]):
        raise ValueError(f"Cannot derive board identifier from {source.get('url')}")
    return parts[0]


def _smartrecruiters_description(detail: dict) -> str:
    sections = ((detail.get("jobAd") or {}).get("sections") or {})
    selected = []
    for key in ("jobDescription", "qualifications", "additionalInformation"):
        value = sections.get(key) or {}
        if value.get("text"):
            selected.append(str(value["text"]))
    return " ".join(selected)


def _normalize_smartrecruiters(item: dict, detail: dict, source: dict) -> dict:
    location = detail.get("location") or item.get("location") or {}
    full_location = location.get("fullLocation") or ", ".join(
        str(location.get(key) or "").strip() for key in ("city", "region", "country") if str(location.get(key) or "").strip()
    )
    hybrid = bool(location.get("hybrid"))
    remote = bool(location.get("remote")) and not hybrid
    company = detail.get("company") or item.get("company") or {}
    employment = detail.get("typeOfEmployment") or item.get("typeOfEmployment") or {}
    return _base_record(
        source,
        local_id=detail.get("id") or item.get("id"),
        title=detail.get("name") or item.get("name"),
        company=company.get("name") or source.get("name"),
        description=_smartrecruiters_description(detail),
        location=full_location,
        date_posted=detail.get("releasedDate") or item.get("releasedDate"),
        source_url=detail.get("postingUrl") or item.get("postingUrl") or detail.get("applyUrl") or item.get("applyUrl"),
        remote=remote,
        hybrid=hybrid,
        employment=employment.get("label") if isinstance(employment, dict) else employment,
        country_codes=[location.get("country")] if location.get("country") else [],
    )


def _collect_smartrecruiters(source: dict, config: dict, now: datetime) -> list[dict]:
    company = _board_id(source)
    released_after = _cutoff(config, now).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    records: list[dict] = []
    offset = 0
    while True:
        params = {"limit": 100, "offset": offset, "destination": "PUBLIC", "releasedAfter": released_after}
        payload = fetch_json(
            f"https://api.smartrecruiters.com/v1/companies/{quote(company)}/postings?" + urlencode(params)
        )
        if not isinstance(payload, dict) or not isinstance(payload.get("content"), list):
            raise ValueError("SmartRecruiters response must contain content array")
        for item in payload["content"]:
            posting_id = item.get("id") or item.get("uuid")
            if not posting_id:
                raise ValueError("SmartRecruiters posting id missing")
            detail = fetch_json(
                f"https://api.smartrecruiters.com/v1/companies/{quote(company)}/postings/{quote(str(posting_id))}"
            )
            if not isinstance(detail, dict):
                raise ValueError("SmartRecruiters posting detail must be an object")
            records.append(_normalize_smartrecruiters(item, detail, source))
        offset += len(payload["content"])
        if offset >= int(payload.get("totalFound") or offset) or not payload["content"]:
            break
    return records


def _normalize_greenhouse(detail: dict, source: dict) -> dict:
    location = (detail.get("location") or {}).get("name") or ""
    mode = location.lower()
    return _base_record(
        source,
        local_id=detail.get("id"),
        title=detail.get("title"),
        company=detail.get("company_name") or source.get("name"),
        description=detail.get("content"),
        location=location,
        date_posted=detail.get("first_published"),
        source_url=detail.get("absolute_url"),
        remote="remote" in mode and "hybrid" not in mode,
        hybrid="hybrid" in mode,
    )


def _collect_greenhouse(source: dict, config: dict, now: datetime) -> list[dict]:
    board = _board_id(source)
    payload = fetch_json(f"https://boards-api.greenhouse.io/v1/boards/{quote(board)}/jobs")
    if not isinstance(payload, dict) or not isinstance(payload.get("jobs"), list):
        raise ValueError("Greenhouse response must contain jobs array")
    cutoff = _cutoff(config, now)
    records: list[dict] = []
    for item in payload["jobs"]:
        updated = engine.parse_posted_datetime(item.get("updated_at"))
        if updated and updated < cutoff:
            continue
        job_id = item.get("id")
        if not job_id:
            raise ValueError("Greenhouse job id missing")
        detail = fetch_json(f"https://boards-api.greenhouse.io/v1/boards/{quote(board)}/jobs/{job_id}")
        if not isinstance(detail, dict):
            raise ValueError("Greenhouse job detail must be an object")
        records.append(_normalize_greenhouse(detail, source))
    return records


def _normalize_ashby(item: dict, source: dict) -> dict:
    workplace = str(item.get("workplaceType") or "")
    location = item.get("location") or ""
    codes: list[str] = []
    postal = ((item.get("address") or {}).get("postalAddress") or {})
    if postal.get("addressCountry"):
        codes.extend(_codes_from_text(postal.get("addressCountry")))
    for secondary in item.get("secondaryLocations") or []:
        if isinstance(secondary, dict):
            address = secondary.get("address") or {}
            codes.extend(_codes_from_text(address.get("addressCountry")))
    return _base_record(
        source,
        local_id=item.get("jobUrl") or item.get("applyUrl"),
        title=item.get("title"),
        company=source.get("name"),
        description=item.get("descriptionPlain") or item.get("descriptionHtml"),
        location=location,
        date_posted=item.get("publishedAt"),
        source_url=item.get("jobUrl") or item.get("applyUrl"),
        remote=workplace.lower() == "remote" or bool(item.get("isRemote")),
        hybrid=workplace.lower() == "hybrid",
        employment=item.get("employmentType"),
        country_codes=list(dict.fromkeys(codes)),
    )


def _collect_ashby(source: dict) -> list[dict]:
    board = _board_id(source)
    payload = fetch_json(
        f"https://api.ashbyhq.com/posting-api/job-board/{quote(board)}?includeCompensation=true"
    )
    if not isinstance(payload, dict) or not isinstance(payload.get("jobs"), list):
        raise ValueError("Ashby response must contain jobs array")
    jobs = [item for item in payload["jobs"] if item.get("isListed") is not False]
    return [_normalize_ashby(item, source) for item in jobs]


def collect(connector: str, source: dict, config: dict, now: datetime) -> list[engine.CollectionResult]:
    if connector == "jobgether":
        records = _collect_jobgether(source, config, now)
    elif connector == "himalayas":
        records = _collect_himalayas(source, config, now)
    elif connector == "workingnomads":
        records = _collect_workingnomads(source)
    elif connector == "remoteok":
        records = _collect_remoteok(source)
    elif connector == "remotive":
        records = _collect_remotive(source, config)
    elif connector == "smartrecruiters":
        records = _collect_smartrecruiters(source, config, now)
    elif connector == "greenhouse":
        records = _collect_greenhouse(source, config, now)
    elif connector == "ashby":
        records = _collect_ashby(source)
    else:
        raise ValueError(f"Unsupported public API connector: {connector}")
    return [engine.CollectionResult(connector, source.get("name") or "public", True, records, len(records))]
